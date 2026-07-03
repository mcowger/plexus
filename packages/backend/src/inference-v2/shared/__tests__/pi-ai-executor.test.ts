import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as piAi from '@earendil-works/pi-ai/compat';
import { setConfigForTesting } from '../../../config';
import { DebugManager } from '../../../services/debug-manager';
import { enterRequestContext } from '../../../services/request-context';
import { runPiAiExecutor, alignAssistantProvenance } from '../pi-ai-executor';
import type { UsageStorageService } from '../../../services/usage-storage';
import type { Context } from '@earendil-works/pi-ai';
import type { QuotaContext, QuotaCheckSnapshot } from '../../../services/quota/quota-enforcer';
import { registerSpy } from '../../../../test/test-utils';
import { OAuthAuthManager } from '../../../services/oauth-auth-manager';

// Isolates the executor-wiring regression test below from the real
// tool-rename-clustering pipeline (already covered by
// tool-fingerprint/__tests__/apply-masking.test.ts) — we only care that
// whatever rename pairs onPayload computes actually reach the SSE reverse
// step.
vi.mock('../tool-fingerprint/apply-masking', () => ({
  applyClaudeCodeMasking: vi.fn((payloadStr: string) => ({
    payload: JSON.parse(payloadStr),
    toolRenamePairs: [['search_web', 'mcp__search__web']],
  })),
}));

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

async function* errorStream() {
  yield {
    type: 'error',
    error: {
      errorMessage:
        'OpenAI API error (400): 400 One of "input" or "previous_response_id" or \'prompt\' or \'conversation_id\' must be provided.',
    },
  } as any;
}

async function* successStream() {
  const partial = {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    api: 'google-generative-ai',
    provider: 'google',
    model: 'gemini-3.5-flash',
    usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  yield { type: 'text_delta', delta: 'hello', partial } as any;
  yield { type: 'done', message: partial, reason: 'stop' } as any;
}

describe('runPiAiExecutor streaming errors', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'openai-s': {
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
        'gpt-5.4': {
          priority: 'selector',
          targets: [{ provider: 'openai-s', model: 'gpt-5.4' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('saves terminal usage and error records for streamed error events', async () => {
    vi.mocked(piAi.stream).mockResolvedValue(errorStream() as any);
    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    DebugManager.getInstance().enableForKey('beta-key');
    enterRequestContext({ keyName: 'beta-key' });

    const result = await runPiAiExecutor({
      requestId: 'req-stream-error',
      incomingApiType: 'responses',
      modelAlias: 'gpt-5.4',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: true,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => ['event: response.completed\ndata: {}\n\n'],
    });

    const frames: string[] = [];
    for await (const frame of result.stream!) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(1);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-stream-error',
        apiKey: 'beta-key',
        incomingApiType: 'responses',
        incomingModelAlias: 'gpt-5.4',
        provider: 'openai-s',
        responseStatus: 'error',
        finishReason: 'error',
      })
    );
    expect(usageStorage.saveError).toHaveBeenCalledWith(
      'req-stream-error',
      expect.any(Error),
      expect.objectContaining({
        apiType: 'responses',
        provider: 'openai-s',
        targetModel: 'gpt-5.4',
      })
    );
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-stream-error' })
    );
  });

  it('saves serialized stream frames as the transformed response snapshot', async () => {
    vi.mocked(piAi.stream).mockResolvedValue(successStream() as any);
    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);
    DebugManager.getInstance().enableForKey('beta-key');
    enterRequestContext({ keyName: 'beta-key' });

    const result = await runPiAiExecutor({
      requestId: 'req-stream-success',
      incomingApiType: 'gemini',
      modelAlias: 'gpt-5.4',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: true,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: (event) => {
        if (event.type === 'text_delta') {
          return [
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: event.delta }] } }] })}\n\n`,
          ];
        }
        if (event.type === 'done') {
          return [`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\n\n`];
        }
        return [];
      },
    });

    const frames: string[] = [];
    for await (const frame of result.stream!) {
      frames.push(frame);
    }

    const expectedSnapshot = frames.join('');
    expect(expectedSnapshot).toMatch(/^data: /);
    expect(expectedSnapshot).toMatch(/\n\n$/);
    expect(expectedSnapshot).toContain('"candidates"');
    expect(expectedSnapshot).not.toContain('"role":"assistant"');
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-stream-success',
        transformedResponse: expectedSnapshot,
        transformedResponseSnapshot: expectedSnapshot,
      })
    );
  });
});

describe('runPiAiExecutor vision fallthrough', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'text-only': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'text-model': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'text-model',
            },
          },
        },
        descriptor: {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-4o': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-4o',
            },
          },
        },
      },
      models: {
        'text-model': {
          priority: 'selector',
          use_image_fallthrough: true,
          targets: [{ provider: 'text-only', model: 'text-model' }],
        },
        'gpt-4o': {
          priority: 'selector',
          targets: [{ provider: 'descriptor', model: 'gpt-4o' }],
        },
      },
      vision_fallthrough: { descriptor_model: 'gpt-4o' },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('describes images before dispatching to an alias with use_image_fallthrough', async () => {
    vi.mocked(piAi.complete)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'A blue circle.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-4o',
        usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'That is a blue circle.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'text-model',
        usage: { input: 15, output: 6, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    const result = await runPiAiExecutor({
      requestId: 'req-vision-fallthrough',
      incomingApiType: 'chat',
      modelAlias: 'text-model',
      context: context as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    // First call describes the image (descriptor model), second call is the
    // actual text-only target dispatch — never receiving image content.
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(2);
    const [, targetContext] = vi.mocked(piAi.complete).mock.calls[1]!;
    const targetMessage = (targetContext as any).messages[0];
    expect(targetMessage.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'text', text: '[Image Description: A blue circle.]' },
    ]);

    expect(result.response).toEqual(
      expect.objectContaining({ content: [{ type: 'text', text: 'That is a blue circle.' }] })
    );

    // Target dispatch usage record reflects the fallthrough having occurred.
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-vision-fallthrough',
        provider: 'text-only',
        isVisionFallthrough: true,
        visionFallthroughModel: 'gpt-4o',
      })
    );
    // Descriptor sub-call gets its own usage record.
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({ isDescriptorRequest: true, isVisionFallthrough: false })
    );
  });

  it('does not trigger fallthrough for aliases without use_image_fallthrough', async () => {
    setConfigForTesting({
      providers: {
        'text-only': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'text-model': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'text-model',
            },
          },
        },
      },
      models: {
        'text-model': {
          priority: 'selector',
          targets: [{ provider: 'text-only', model: 'text-model' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'response' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'text-model',
      usage: { input: 15, output: 6, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const context = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    await runPiAiExecutor({
      requestId: 'req-no-fallthrough',
      incomingApiType: 'chat',
      modelAlias: 'text-model',
      context: context as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: { body: {}, keyName: 'beta-key', attribution: 'opencode', ip: '127.0.0.1' } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    // Only one call — the target dispatch — image content was forwarded verbatim.
    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    const [, sentContext] = vi.mocked(piAi.complete).mock.calls[0]!;
    expect((sentContext as any).messages[0].content[0].type).toBe('image');
  });
});

describe('alignAssistantProvenance', () => {
  const dispatchModel = { provider: 'google', id: 'gemini-3-flash', api: 'google-generative-ai' };

  function ctxWithAssistant(overrides: Record<string, unknown>): Context {
    return {
      messages: [
        { role: 'user', content: 'hi', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'list_files',
              name: 'list_files',
              arguments: {},
              thoughtSignature: 'ENCRYPTED_SIG',
            },
          ],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'toolUse',
          timestamp: 2,
          ...overrides,
        } as any,
      ],
    } as Context;
  }

  it('re-stamps client-alias provenance to the dispatch model so pi-ai replays the signature', () => {
    // Inbound Gemini parser stamps the CLIENT alias, which never matches the
    // resolved egress pi-ai model → pi-ai would strip thoughtSignature.
    const ctx = ctxWithAssistant({
      provider: 'google',
      model: 'gemini-3.5-flash', // client alias, not the pi-ai model id
      api: 'google-generative-ai',
    });

    const aligned = alignAssistantProvenance(ctx, dispatchModel);

    const asst = aligned.messages[1] as any;
    expect(asst.provider).toBe('google');
    expect(asst.model).toBe('gemini-3-flash');
    expect(asst.api).toBe('google-generative-ai');
    // The tool call (and its signature) is preserved verbatim.
    expect(asst.content[0].thoughtSignature).toBe('ENCRYPTED_SIG');
    // Input context is never mutated.
    expect((ctx.messages[1] as any).model).toBe('gemini-3.5-flash');
  });

  it('returns the same reference when provenance already matches (no needless copy)', () => {
    const ctx = ctxWithAssistant({
      provider: 'google',
      model: 'gemini-3-flash',
      api: 'google-generative-ai',
    });

    const aligned = alignAssistantProvenance(ctx, dispatchModel);
    expect(aligned).toBe(ctx);
  });

  it('leaves non-assistant messages untouched', () => {
    const ctx = ctxWithAssistant({
      provider: 'google',
      model: 'gemini-3.5-flash',
      api: 'google-generative-ai',
    });

    const aligned = alignAssistantProvenance(ctx, dispatchModel);
    expect(aligned.messages[0]).toBe(ctx.messages[0]);
  });
});

describe('runPiAiExecutor quota filter + headers', () => {
  function makeSnapshot(overrides: Partial<QuotaCheckSnapshot> = {}): QuotaCheckSnapshot {
    return {
      quotaName: 'test-quota',
      limitType: 'requests',
      limit: 10,
      currentUsage: 10,
      remaining: 0,
      allowed: false,
      resetsAtMs: Date.now() + 60_000,
      scope: {},
      global: false,
      shared: false,
      source: 'assigned',
      ...overrides,
    };
  }

  function makeQuotaContext(checks: QuotaCheckSnapshot[]): QuotaContext {
    return {
      keyName: 'beta-key',
      checks,
      blockedGlobal: checks.find((c) => c.global && !c.allowed) ?? null,
    };
  }

  function successMessage(provider: string, model: string) {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      api: 'openai-codex-responses',
      provider,
      model,
      usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
  }

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
        'prov-b': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-5.5': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-5.5',
            },
          },
        },
      },
      models: {
        'test-alias': {
          selector: 'in_order',
          targets: [
            { provider: 'prov-a', model: 'gpt-5.4' },
            { provider: 'prov-b', model: 'gpt-5.5' },
          ],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('routes around a candidate blocked by a scoped exhausted quota', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce(successMessage('prov-b', 'gpt-5.5') as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const blockedForProvA = makeSnapshot({
      quotaName: 'prov-a-only',
      scope: { allowedProviders: ['prov-a'] },
    });

    const result = await runPiAiExecutor({
      requestId: 'req-quota-narrow',
      incomingApiType: 'chat',
      modelAlias: 'test-alias',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: null,
        ip: '127.0.0.1',
        quotaContext: makeQuotaContext([blockedForProvA]),
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    const [dispatchModel] = vi.mocked(piAi.complete).mock.calls[0]!;
    expect((dispatchModel as any).id).toBe('gpt-5.5');
    expect(result.response).toEqual(expect.objectContaining({ provider: 'prov-b' }));

    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'prov-b',
        retryHistory: expect.stringContaining('quota_exceeded:prov-a-only'),
      })
    );
  });

  it('throws a terminal quota_exceeded error when every candidate is blocked', async () => {
    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const blockedForProvA = makeSnapshot({
      quotaName: 'prov-a-quota',
      scope: { allowedProviders: ['prov-a'] },
    });
    const blockedForProvB = makeSnapshot({
      quotaName: 'prov-b-quota',
      scope: { allowedProviders: ['prov-b'] },
    });

    let thrown: any = null;
    try {
      await runPiAiExecutor({
        requestId: 'req-quota-all-blocked',
        incomingApiType: 'chat',
        modelAlias: 'test-alias',
        context: { messages: [] } as any,
        generationIntent: { reasoning: { source: 'client' } } as any,
        streaming: false,
        request: {
          body: {},
          keyName: 'beta-key',
          attribution: null,
          ip: '127.0.0.1',
          quotaContext: makeQuotaContext([blockedForProvA, blockedForProvB]),
        } as any,
        usageStorage,
        serializeMessage: (msg) => msg as any,
        serializeChunks: () => [],
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.routingContext).toEqual(
      expect.objectContaining({ statusCode: 429, code: 'quota_exceeded' })
    );

    // Terminal 429 carries the quota-skip breadcrumbs so the saved usage
    // record's retryHistory isn't null when everything was blocked.
    const retryHistory = JSON.parse(thrown.routingContext.retryHistory ?? 'null');
    expect(retryHistory).toHaveLength(2);
    expect(retryHistory.map((r: any) => r.status)).toEqual(['skipped', 'skipped']);
    expect(retryHistory.map((r: any) => r.reason).sort()).toEqual([
      'quota_exceeded:prov-a-quota',
      'quota_exceeded:prov-b-quota',
    ]);

    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
  });

  it('is inert when no quotaContext is attached to the request', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce(successMessage('prov-a', 'gpt-5.4') as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const result = await runPiAiExecutor({
      requestId: 'req-quota-inert',
      incomingApiType: 'chat',
      modelAlias: 'test-alias',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: { body: {}, keyName: 'beta-key', attribution: null, ip: '127.0.0.1' } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    expect(vi.mocked(piAi.complete)).toHaveBeenCalledTimes(1);
    expect(result.response).toEqual(expect.objectContaining({ provider: 'prov-a' }));
    expect(result.quotaHeaders).toEqual({});
  });

  it('sets x-plexus-quota* headers on the result for the winning route', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce(successMessage('prov-a', 'gpt-5.4') as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const notExhausted = makeSnapshot({
      quotaName: 'informational-quota',
      allowed: true,
      limit: 100,
      currentUsage: 40,
      remaining: 60,
      scope: { allowedProviders: ['prov-a'] },
    });

    const result = await runPiAiExecutor({
      requestId: 'req-quota-headers',
      incomingApiType: 'chat',
      modelAlias: 'test-alias',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: null,
        ip: '127.0.0.1',
        quotaContext: makeQuotaContext([notExhausted]),
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    expect(result.quotaHeaders).toEqual({
      'x-plexus-quota': 'informational-quota',
      'x-plexus-quota-limit': '100',
      'x-plexus-quota-remaining': '60',
      'x-plexus-quota-reset': new Date(notExhausted.resetsAtMs).toISOString(),
    });
  });
});

describe('runPiAiExecutor with OAuth and Claude Masking', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'anthropic-oauth': {
          api_base_url: 'oauth://anthropic',
          oauth_provider: 'anthropic',
          oauth_account: 'test-account',
          models: {
            'claude-3-5-sonnet-20241022': {
              pricing: { source: 'simple', input: 0, output: 0 },
            },
          },
        },
      },
      models: {
        'claude-3-5-sonnet-20241022': {
          priority: 'selector',
          targets: [{ provider: 'anthropic-oauth', model: 'claude-3-5-sonnet-20241022' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('runs successfully with an OAuth route using resolved credentials', async () => {
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue('mock-oauth-key');

    vi.mocked(piAi.complete).mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello oauth' }],
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const usageStorage = createUsageStorage();
    const result = await runPiAiExecutor({
      requestId: 'req-oauth',
      incomingApiType: 'chat',
      modelAlias: 'claude-3-5-sonnet-20241022',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: false,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'opencode',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: () => [],
    });

    expect(result.response).toBeDefined();
    expect((result.response as any).content[0].text).toBe('hello oauth');
  });
});

describe('runPiAiExecutor Claude-masking streaming tool-rename reversal (regression)', () => {
  // Regression for trace 0aa9f550-2234-4e8f-8220-a6f7e50835b6: a client's
  // `search_web` tool got fingerprint-renamed to `mcp__search__web` on the
  // outgoing request, but the renamed name leaked back into the streamed
  // tool_use block unreversed, so the client never recognized its own call.
  //
  // Root cause: pi-ai's `piAiModels.stream()` returns its event stream
  // synchronously via `lazyStream()` (see @earendil-works/pi-ai's
  // dist/api/lazy.js) — the async setup that actually calls `onPayload`
  // (and, through it, computes `toolRenamePairs`) only runs once the
  // returned stream is iterated. `buildSSEGenerator()` used to snapshot
  // `toolRenamePairs` into its params BEFORE that iteration started, so it
  // was permanently bound to the pre-onPayload `[]`. This test reproduces
  // that exact ordering with a fake stream whose generator body — like the
  // real pi-ai driver — calls `onPayload` only once iteration begins.
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
    setConfigForTesting({
      providers: {
        'anthropic-masked': {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'sk-ant-oat01-test-masking-key',
          useClaudeMasking: true,
          models: {
            'claude-3-5-sonnet-20241022': {
              pricing: { source: 'simple', input: 0, output: 0 },
            },
          },
        },
      },
      models: {
        'claude-3-5-sonnet-20241022': {
          priority: 'selector',
          targets: [{ provider: 'anthropic-masked', model: 'claude-3-5-sonnet-20241022' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('reverses a fingerprint-renamed tool name in streamed SSE frames even though onPayload resolves after piAiModels.stream() returns', async () => {
    vi.mocked(piAi.stream).mockImplementation((async (_model: any, _context: any, options: any) => {
      // Returning the un-started async generator here — before its body
      // (and thus onPayload) has run — mirrors pi-ai's real lazyStream
      // timing exactly.
      return (async function* () {
        await options.onPayload?.(JSON.stringify({ tools: [{ name: 'search_web' }] }));
        const partial = {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'mcp__search__web', arguments: {} }],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          stopReason: 'toolUse',
          timestamp: Date.now(),
        };
        yield { type: 'toolcall_start', partial } as any;
        yield { type: 'done', message: partial, reason: 'toolUse' } as any;
      })();
    }) as any);

    const usageStorage = createUsageStorage();
    DebugManager.getInstance().setStorage(usageStorage);

    const result = await runPiAiExecutor({
      requestId: 'req-claude-masking-tool-rename',
      incomingApiType: 'messages',
      modelAlias: 'claude-3-5-sonnet-20241022',
      context: { messages: [] } as any,
      generationIntent: { reasoning: { source: 'client' } } as any,
      streaming: true,
      request: {
        body: {},
        keyName: 'beta-key',
        attribution: 'open-webui',
        ip: '127.0.0.1',
      } as any,
      usageStorage,
      serializeMessage: (msg) => msg as any,
      serializeChunks: (event: any) => {
        if (event.type === 'toolcall_start') {
          const name = event.partial.content[0].name;
          return [
            `event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"call-1","name":"${name}"}}\n\n`,
          ];
        }
        return [];
      },
    });

    const frames: string[] = [];
    for await (const frame of result.stream!) {
      frames.push(frame);
    }
    const snapshot = frames.join('');

    expect(snapshot).toContain('"name":"search_web"');
    expect(snapshot).not.toContain('mcp__search__web');
  });
});
