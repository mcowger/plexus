import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as piAi from '@earendil-works/pi-ai/compat';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { setConfigForTesting } from '../../config';
import { DebugManager } from '../../services/debug-manager';
import {
  handleBetaChatCompletions,
  handleBetaMessages,
  handleBetaResponses,
  handleBetaGeminiRequest,
} from '../index';
import type { UsageStorageService } from '../../services/usage-storage';
import type { ResponsesStorageService } from '../../services/responses-storage';
import type { QuotaEnforcer, QuotaContext } from '../../services/quota/quota-enforcer';

function createUsageStorage(): UsageStorageService {
  return {
    saveRequest: vi.fn(async () => undefined),
    saveError: vi.fn(async () => undefined),
    saveDebugLog: vi.fn(async () => undefined),
    updatePerformanceMetrics: vi.fn(async () => undefined),
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
  } as unknown as UsageStorageService;
}

function makeReply() {
  const reply = {
    statusCode: 200,
    sentBodies: [] as unknown[],
    code: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
    send: vi.fn(function (this: any, body: unknown) {
      this.sentBodies.push(body);
      return this;
    }),
  };
  return reply as unknown as FastifyReply & typeof reply;
}

function makeRequest(
  body: unknown = { model: 'test-alias', messages: [{ role: 'user', content: 'hi' }] },
  extra: Record<string, unknown> = {}
): FastifyRequest {
  return {
    body,
    headers: {},
    keyName: 'beta-key',
    keyConfig: { beta: true },
    attribution: null,
    ip: '127.0.0.1',
    raw: { on: vi.fn(), off: vi.fn() },
    params: {},
    ...extra,
  } as unknown as FastifyRequest;
}

function createResponsesStorage(): ResponsesStorageService {
  return {
    storeResponse: vi.fn(async () => undefined),
    getResponse: vi.fn(async () => null),
    getConversation: vi.fn(async () => null),
    updateConversation: vi.fn(async () => undefined),
  } as unknown as ResponsesStorageService;
}

/** Shared pi-ai mock config used by every beta-handler quota-gating test:
 * a single openai-codex candidate under alias "test-alias". */
const BETA_QUOTA_TEST_CONFIG = {
  providers: {
    'prov-a': {
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      pi_ai_provider: 'openai-codex',
      models: {
        'gpt-5.4': {
          pricing: { source: 'simple', input: 0, output: 0 },
          pi_ai_model_id: 'gpt-5.4',
        },
      },
    },
  },
  models: {
    'test-alias': {
      selector: 'in_order',
      targets: [{ provider: 'prov-a', model: 'gpt-5.4' }],
    },
  },
  keys: { 'beta-key': { secret: 'sk-beta', beta: true } },
  failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
  quotas: [],
} as any;

const MOCK_ASSISTANT_MESSAGE = {
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
  api: 'openai-codex-responses',
  provider: 'openai-codex',
  model: 'gpt-5.4',
  usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 },
  stopReason: 'stop',
  timestamp: Date.now(),
} as any;

/** An exhausted GLOBAL quota — checkQuotaMiddleware 429s up front and the
 * executor must never run. */
function blockedGlobalQuota() {
  return {
    quotaName: 'global-daily',
    limitType: 'requests' as const,
    limit: 100,
    currentUsage: 100,
    remaining: 0,
    allowed: false,
    resetsAtMs: Date.now() + 60_000,
    scope: {},
    global: true,
    shared: false,
    source: 'assigned' as const,
  };
}

/** A scoped quota exhausted for a provider OUTSIDE the candidate set — must
 * not block the request, since scoped quotas only narrow routing. */
function scopedExhaustedOtherProvider() {
  return {
    quotaName: 'scoped-other-provider',
    limitType: 'requests' as const,
    limit: 100,
    currentUsage: 100,
    remaining: 0,
    allowed: false,
    resetsAtMs: Date.now() + 60_000,
    scope: { allowedProviders: ['some-other-provider'] },
    global: false,
    shared: false,
    source: 'assigned' as const,
  };
}

describe('beta handlers: exhausted GLOBAL quota 429s once, executor never runs', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'prov-a': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-5.4': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-5.4',
            },
          },
        },
      },
      models: {
        'test-alias': {
          selector: 'in_order',
          targets: [{ provider: 'prov-a', model: 'gpt-5.4' }],
        },
      },
      keys: { 'beta-key': { secret: 'sk-beta', beta: true } },
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('handleBetaChatCompletions sends exactly one 429 and never invokes the executor', async () => {
    const blockedGlobal = blockedGlobalQuota();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [blockedGlobal],
      blockedGlobal,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest();
    const reply = makeReply();

    await handleBetaChatCompletions(request, reply, { usageStorage, quotaEnforcer });

    // Exactly ONE response was sent — the middleware's 429. A broken guard
    // (truthy QuotaCheckResult) would fall through into runPiAiExecutor,
    // whose thrown error triggers a second reply.send() in the catch.
    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('global-daily');
    expect(body.error.blocking_quotas).toHaveLength(1);

    // The executor was never invoked.
    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('handleBetaChatCompletions proceeds into the executor when only a scoped quota is exhausted', async () => {
    const scopedExhausted = scopedExhaustedOtherProvider();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'gpt-5.4',
      usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest();
    const reply = makeReply();

    await handleBetaChatCompletions(request, reply, { usageStorage, quotaEnforcer });

    // Middleware allowed the request through (scoped quotas don't 429 up
    // front), the context landed on the raw request for the executor, and
    // the executor dispatched normally.
    expect((request as any).quotaContext).toBe(ctx);
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});

// ─── The other three beta handlers: mirror the chat-completions cases above ──
//
// checkQuotaMiddleware sends the SAME generic quota-exceeded body regardless
// of protocol (buildQuotaExceededBody in quota-middleware.ts) — only the
// catch-block error shape is protocol-specific. So the 429-body assertions
// below are identical to the chat-completions case; what differs per handler
// is the inbound body shape and (for Gemini) the extra `streaming` param.

/** A scoped quota exhausted for BETA_QUOTA_TEST_CONFIG's single candidate
 * (provider "prov-a", model "gpt-5.4") — filterCandidates blocks every
 * candidate, so runPiAiExecutor throws the terminal buildQuotaExceededError
 * instead of falling through to piAi.complete/stream. */
function scopedExhaustedForSoleCandidate() {
  return {
    quotaName: 'scoped-prov-a',
    limitType: 'requests' as const,
    limit: 50,
    currentUsage: 50,
    remaining: 0,
    allowed: false,
    resetsAtMs: Date.now() + 60_000,
    scope: { allowedProviders: ['prov-a'] },
    global: false,
    shared: false,
    source: 'assigned' as const,
  };
}

describe('handleBetaMessages: quota gating', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting(BETA_QUOTA_TEST_CONFIG);
  });

  it('sends exactly one 429 and never invokes the executor when a GLOBAL quota is exhausted', async () => {
    const blockedGlobal = blockedGlobalQuota();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [blockedGlobal],
      blockedGlobal,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({
      model: 'test-alias',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const reply = makeReply();

    await handleBetaMessages(request, reply, { usageStorage, quotaEnforcer });

    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('global-daily');
    expect(body.error.blocking_quotas).toHaveLength(1);

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('proceeds into the executor when only a scoped quota is exhausted', async () => {
    const scopedExhausted = scopedExhaustedOtherProvider();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    vi.mocked(piAi.complete).mockResolvedValueOnce(MOCK_ASSISTANT_MESSAGE);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({
      model: 'test-alias',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const reply = makeReply();

    await handleBetaMessages(request, reply, { usageStorage, quotaEnforcer });

    expect((request as any).quotaContext).toBe(ctx);
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});

describe('handleBetaResponses: quota gating', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting(BETA_QUOTA_TEST_CONFIG);
  });

  it('sends exactly one 429 and never invokes the executor when a GLOBAL quota is exhausted', async () => {
    const blockedGlobal = blockedGlobalQuota();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [blockedGlobal],
      blockedGlobal,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({ model: 'test-alias', input: 'hi' });
    const reply = makeReply();
    const responsesStorage = createResponsesStorage();

    await handleBetaResponses(request, reply, { usageStorage, quotaEnforcer, responsesStorage });

    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('global-daily');
    expect(body.error.blocking_quotas).toHaveLength(1);

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
    expect(responsesStorage.getResponse).not.toHaveBeenCalled();
    expect(responsesStorage.storeResponse).not.toHaveBeenCalled();
  });

  it('proceeds into the executor when only a scoped quota is exhausted', async () => {
    const scopedExhausted = scopedExhaustedOtherProvider();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    vi.mocked(piAi.complete).mockResolvedValueOnce(MOCK_ASSISTANT_MESSAGE);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({ model: 'test-alias', input: 'hi' });
    const reply = makeReply();
    const responsesStorage = createResponsesStorage();

    await handleBetaResponses(request, reply, { usageStorage, quotaEnforcer, responsesStorage });

    expect((request as any).quotaContext).toBe(ctx);
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});

describe('handleBetaGeminiRequest: quota gating', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting(BETA_QUOTA_TEST_CONFIG);
  });

  it('sends exactly one 429 and never invokes the executor when a GLOBAL quota is exhausted', async () => {
    const blockedGlobal = blockedGlobalQuota();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [blockedGlobal],
      blockedGlobal,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest(
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { params: { model: 'test-alias' } }
    );
    const reply = makeReply();

    await handleBetaGeminiRequest(request, reply, false, { usageStorage, quotaEnforcer });

    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('global-daily');
    expect(body.error.blocking_quotas).toHaveLength(1);

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('proceeds into the executor when only a scoped quota is exhausted', async () => {
    const scopedExhausted = scopedExhaustedOtherProvider();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    vi.mocked(piAi.complete).mockResolvedValueOnce(MOCK_ASSISTANT_MESSAGE);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest(
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { params: { model: 'test-alias' } }
    );
    const reply = makeReply();

    await handleBetaGeminiRequest(request, reply, false, { usageStorage, quotaEnforcer });

    expect((request as any).quotaContext).toBe(ctx);
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});

// ─── Terminal scoped-exhaustion: every candidate quota-blocked ──────────────
//
// Unlike a blocked GLOBAL quota (which 429s from checkQuotaMiddleware before
// the executor ever runs), a scoped quota that blocks EVERY remaining
// candidate makes runPiAiExecutor itself throw buildQuotaExceededError. Each
// handler's catch block must carry the blocking_quotas detail into its
// protocol-specific 429 body — this is what plan/finding coverage calls the
// "terminal scoped-exhaustion" case, replacing the old generic
// {code:'quota_exceeded'}-only body.
describe('beta handlers: terminal scoped-exhaustion carries blocking_quotas into the 429', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting(BETA_QUOTA_TEST_CONFIG);
  });

  it('handleBetaChatCompletions responds 429 with the v1-parity body (blocking_quotas included)', async () => {
    const scopedExhausted = scopedExhaustedForSoleCandidate();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest();
    const reply = makeReply();

    await handleBetaChatCompletions(request, reply, { usageStorage, quotaEnforcer });

    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('scoped-prov-a');
    expect(body.error.blocking_quotas).toHaveLength(1);
    expect(body.error.blocking_quotas[0].quotaName).toBe('scoped-prov-a');

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('handleBetaResponses responds 429 with the v1-parity body (blocking_quotas included)', async () => {
    const scopedExhausted = scopedExhaustedForSoleCandidate();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({ model: 'test-alias', input: 'hi' });
    const reply = makeReply();
    const responsesStorage = createResponsesStorage();

    await handleBetaResponses(request, reply, { usageStorage, quotaEnforcer, responsesStorage });

    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('scoped-prov-a');
    expect(body.error.blocking_quotas).toHaveLength(1);
    expect(body.error.blocking_quotas[0].quotaName).toBe('scoped-prov-a');

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('handleBetaMessages responds 429 with a rate_limit_error naming the blocking quota', async () => {
    const scopedExhausted = scopedExhaustedForSoleCandidate();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest({
      model: 'test-alias',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const reply = makeReply();

    await handleBetaMessages(request, reply, { usageStorage, quotaEnforcer });

    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('rate_limit_error');
    expect(body.error.message).toContain('scoped-prov-a');
    // No non-Anthropic top-level fields invented for the wire shape.
    expect(body.error.blocking_quotas).toBeUndefined();
    expect(body.blocking_quotas).toBeUndefined();

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });

  it('handleBetaGeminiRequest responds 429 RESOURCE_EXHAUSTED naming the blocking quota', async () => {
    const scopedExhausted = scopedExhaustedForSoleCandidate();
    const ctx: QuotaContext = {
      keyName: 'beta-key',
      checks: [scopedExhausted],
      blockedGlobal: null,
    };
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
      recordUsage: vi.fn(async () => undefined),
    } as unknown as QuotaEnforcer;

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    const request = makeRequest(
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { params: { model: 'test-alias' } }
    );
    const reply = makeReply();

    await handleBetaGeminiRequest(request, reply, false, { usageStorage, quotaEnforcer });

    expect(reply.code).toHaveBeenCalledWith(429);
    const body: any = reply.sentBodies[0];
    expect(body.error.status).toBe('RESOURCE_EXHAUSTED');
    expect(body.error.message).toContain('scoped-prov-a');

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(vi.mocked(piAi.stream)).not.toHaveBeenCalled();
  });
});
