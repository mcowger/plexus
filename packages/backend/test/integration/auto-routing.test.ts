import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AutoRoutingConfigSchema, AutoTargetProfileSchema } from '@plexus/shared';
import { registerInferenceRoutes } from '../../src/routes/inference/index';
import { Dispatcher } from '../../src/services/dispatch/dispatcher';
import type { UsageStorageService } from '../../src/services/observability/usage-storage';
import { DebugManager } from '../../src/services/observability/debug-manager';
import { SelectorFactory } from '../../src/services/routing/selectors/factory';
import { getConfig, setConfigForTesting } from '../../src/config';
import { CooldownManager } from '../../src/services/runtime/cooldown-manager';
import { ConcurrencyTracker } from '../../src/services/runtime/concurrency-tracker';
import { AutoStateStore, buildAutoStateScope } from '../../src/services/routing/auto-state';
import {
  configureAutoClassifier,
  drainAutoClassifierAccountingForTesting,
  resetAutoClassifierForTesting,
} from '../../src/services/routing/auto-classifier';
import { registerSpy } from '../test-utils';

/**
 * End-to-end auto-routing regression: the Fastify inference router plus a real
 * `Dispatcher` run the actual `classifyAutoRequest` lifecycle through the
 * Decisions child alias, then generate on the freshly ranked normal candidates.
 * Only the upstream provider HTTP endpoint is mocked (global `fetch`); every
 * routing, schema, classifier, and failover decision is exercised for real.
 */

const KEY_NAME = 'test-key';
const KEY_SECRET = 'sk-valid-key';

interface FetchCall {
  url: string;
  body: any;
}

let fetchCalls: FetchCall[];
let decisionsResponder: (signal?: AbortSignal) => Response | Promise<Response>;
let generationResponses: Array<Response | ((body: any) => Response)>;

function parseBody(init: any): any {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
  } catch {
    return undefined;
  }
}

function installFetchMock(): void {
  const spy = registerSpy(globalThis as any, 'fetch');
  spy.mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    const body = parseBody(init);
    fetchCalls.push({ url, body });
    if (url.includes('judge.example')) {
      return decisionsResponder(init?.signal ?? undefined);
    }
    const next = generationResponses.shift();
    if (typeof next === 'function') return next(body);
    if (next) return next;
    return chatSuccess(body?.model ?? 'unknown');
  });
}

function decisionsSuccess(): Response {
  return new Response(
    JSON.stringify({
      model: 'judge-model',
      answers: {
        // capability_required 2 composes to demand 2.0 -> "high" tier with the
        // default boundaries, so an economy target is excluded and a high
        // target is selected.
        task_kind: { type: 'choice', choice: 'implement' },
        complexity: { type: 'score', score: 2 },
        capability_required: { type: 'score', score: 2 },
        // Below the reasoning threshold, so demand stays 2.0 -> "high" tier.
        deep_reasoning: { type: 'noul', noul: 0.1, confidence: 0.95 },
      },
      usage: { input_tokens: 41, output_tokens: 5, cost: 0.002 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function decisionsPremium(): Response {
  return new Response(
    JSON.stringify({
      model: 'judge-model',
      answers: {
        // capability_required 3 -> premium; nothing in the fixture qualifies,
        // exercising the explicit first-eligible fallback.
        task_kind: { type: 'choice', choice: 'implement' },
        complexity: { type: 'score', score: 3 },
        capability_required: { type: 'score', score: 3 },
        deep_reasoning: { type: 'noul', noul: 0.9, confidence: 0.95 },
      },
      usage: { input_tokens: 41, output_tokens: 5, cost: 0.003 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function chatSuccess(model: string, cachedTokens = 0): Response {
  const usage: Record<string, unknown> = {
    prompt_tokens: 20,
    completion_tokens: 2,
    total_tokens: 22,
  };
  if (cachedTokens > 0) usage.prompt_tokens_details = { cached_tokens: cachedTokens };
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function chatError(status: number): Response {
  return new Response(JSON.stringify({ error: { message: `upstream ${status}` } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatStream(model: string, cachedTokens: number): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: 'streamed ok' }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 2,
        total_tokens: 22,
        prompt_tokens_details: { cached_tokens: cachedTokens },
      },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(chunks, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function autoProfile(capability: 'economy' | 'standard' | 'high' | 'premium') {
  return AutoTargetProfileSchema.parse({ capability, specialties: [] });
}

interface AutoConfigOptions {
  targets: Array<{ provider: string; model: string; capability: string }>;
  deadlineMs?: number;
  uncertaintyMinimumTier?: 'economy' | 'standard' | 'high' | 'premium';
  failoverEnabled?: boolean;
}

function makeConfig(options: AutoConfigOptions) {
  const policy = AutoRoutingConfigSchema.parse({
    mode: 'active',
    classifier_alias: 'judge',
    classifier_deadline_ms: options.deadlineMs ?? 500,
    uncertainty_minimum_tier: options.uncertaintyMinimumTier ?? 'high',
  });

  return {
    providers: {
      'gen-a': {
        type: 'chat',
        api_base_url: 'https://gen-a.example/v1',
        api_key: 'gen-a-key',
        models: { cheap: {}, high: {} },
      },
      'gen-b': {
        type: 'chat',
        api_base_url: 'https://gen-b.example/v1',
        api_key: 'gen-b-key',
        models: { high: {} },
      },
      judge: {
        api_base_url: 'https://judge.example/v1',
        api_key: 'judge-key',
        models: { 'judge-model': { access_via: ['systemone'] } },
      },
    },
    models: {
      auto: {
        type: 'text',
        sticky_session: false,
        auto_routing: policy,
        target_groups: [
          {
            name: 'auto',
            selector: 'auto',
            targets: options.targets.map((target) => ({
              provider: target.provider,
              model: target.model,
              auto_profile: autoProfile(target.capability as any),
            })),
          },
        ],
      },
      judge: {
        type: 'decisions',
        target_groups: [
          {
            name: 'main',
            selector: 'in_order',
            targets: [{ provider: 'judge', model: 'judge-model' }],
          },
        ],
      },
    },
    keys: { [KEY_NAME]: { secret: KEY_SECRET, comment: 'Auto routing test key' } },
    failover: {
      enabled: options.failoverEnabled ?? false,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function makeStorage() {
  return {
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
    saveRequest: vi.fn(),
    saveError: vi.fn(),
    saveDebugLog: vi.fn(),
    updatePerformanceMetrics: vi.fn(),
    recordSuccessfulAttempt: vi.fn(),
    recordFailedAttempt: vi.fn(),
    registerInFlight: vi.fn(),
    deregisterInFlight: vi.fn(),
    unregisterInFlight: vi.fn(),
  } as unknown as UsageStorageService;
}

function makeUsageRecorder() {
  return { saveRequest: vi.fn() };
}

async function startServer(dispatcher = new Dispatcher()): Promise<FastifyInstance> {
  const fastify = Fastify();
  const storage = makeStorage();
  DebugManager.getInstance().setStorage(storage);
  SelectorFactory.setUsageStorage(storage);
  await registerInferenceRoutes(fastify, dispatcher, storage);
  await fastify.ready();
  return fastify;
}

function generationCalls(): FetchCall[] {
  return fetchCalls.filter((call) => !call.url.includes('judge.example'));
}

function decisionCalls(): FetchCall[] {
  return fetchCalls.filter((call) => call.url.includes('judge.example'));
}

describe('auto routing integration', () => {
  let fastify: FastifyInstance | undefined;
  let usageRecorder: { saveRequest: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    resetAutoClassifierForTesting();
    AutoStateStore.resetInstanceForTesting();
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();

    fetchCalls = [];
    decisionsResponder = () => decisionsSuccess();
    generationResponses = [];
    usageRecorder = makeUsageRecorder();

    configureAutoClassifier({
      getModels: () => getConfig().models as any,
      createDispatcher: async () => new Dispatcher(),
      getUsageRecorder: () => usageRecorder as any,
      getQuotaRecorder: () => undefined,
      now: () => Date.now(),
    });

    installFetchMock();
  });

  afterEach(async () => {
    await drainAutoClassifierAccountingForTesting();
    if (fastify) {
      await fastify.close();
      fastify = undefined;
    }
    AutoStateStore.resetInstanceForTesting();
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
  });

  async function postChat(payload: Record<string, unknown>) {
    return fastify!.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${KEY_SECRET}`, 'content-type': 'application/json' },
      payload,
    });
  }

  it('fresh classification upgrades the declared-cheap first target to the high target', async () => {
    setConfigForTesting(
      makeConfig({
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();

    const response = await postChat({
      model: 'auto',
      messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).choices[0].message.content).toBe('ok');

    const generation = generationCalls();
    expect(generation).toHaveLength(1);
    expect(generation[0]!.body.model).toBe('high');
    expect(generation[0]!.url).toContain('gen-a.example');

    // Exactly one Decisions child call, with the server-owned rubric, and the
    // shared-schema answer (including the noul deep_reasoning field) accepted.
    const decisions = decisionCalls();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.body.state.task).toBe('classify_request');
    expect(Object.keys(decisions[0]!.body.questions).sort()).toEqual([
      'capability_required',
      'complexity',
      'deep_reasoning',
      'task_kind',
    ]);

    // Child usage is accounted from the actual upstream usage block.
    expect(usageRecorder.saveRequest).toHaveBeenCalledTimes(1);
    expect(usageRecorder.saveRequest.mock.calls[0]![0]).toMatchObject({
      incomingApiType: 'decisions',
      apiKey: KEY_NAME,
      provider: 'judge',
      selectedModelName: 'judge-model',
      tokensInput: 41,
      tokensOutput: 5,
      responseStatus: 'success',
    });
  });

  it('classifies exactly once per request across a failover hop', async () => {
    setConfigForTesting(
      makeConfig({
        failoverEnabled: true,
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
          { provider: 'gen-b', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();
    // First high target fails with a retryable 500; the next suitable target serves.
    generationResponses = [chatError(500), (body) => chatSuccess(body.model)];

    const response = await postChat({
      model: 'auto',
      messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).choices[0].message.content).toBe('ok');

    const generation = generationCalls();
    expect(generation.map((call) => call.body.model)).toEqual(['high', 'high']);
    expect(generation.map((call) => call.url)).toEqual([
      expect.stringContaining('gen-a.example'),
      expect.stringContaining('gen-b.example'),
    ]);
    // The classifier was not re-run for the failover attempt.
    expect(decisionCalls()).toHaveLength(1);
  });

  it('falls back to the first eligible target when none is suitable', async () => {
    setConfigForTesting(
      makeConfig({
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();
    decisionsResponder = () => decisionsPremium();

    const response = await postChat({
      model: 'auto',
      messages: [{ role: 'user', content: 'Handle a huge ambiguous high-stakes migration' }],
    });

    expect(response.statusCode).toBe(200);
    const generation = generationCalls();
    expect(generation).toHaveLength(1);
    expect(generation[0]!.body.model).toBe('cheap');
    expect(decisionCalls()).toHaveLength(1);
  });

  it('falls back to the deterministic baseline when the classifier deadline expires', async () => {
    setConfigForTesting(
      makeConfig({
        deadlineMs: 5,
        uncertaintyMinimumTier: 'economy',
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();
    // Respond only after the classifier deadline, so classification times out
    // and routing uses the baseline (declared order) instead of the high target.
    decisionsResponder = () =>
      new Promise((resolve) => setTimeout(() => resolve(decisionsSuccess()), 75));

    const response = await postChat({
      model: 'auto',
      messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    });

    expect(response.statusCode).toBe(200);
    const generation = generationCalls();
    expect(generation).toHaveLength(1);
    expect(generation[0]!.body.model).toBe('cheap');
    expect(decisionCalls()).toHaveLength(1);
  });

  it('routes a Responses request without throwing', async () => {
    setConfigForTesting(
      makeConfig({
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: `Bearer ${KEY_SECRET}`, 'content-type': 'application/json' },
      payload: {
        model: 'auto',
        input: 'Implement a complex multi-step feature',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.error).toBeUndefined();
    expect(body.object).toBe('response');

    const generation = generationCalls();
    expect(generation).toHaveLength(1);
    expect(generation[0]!.body.model).toBe('high');
  });

  it('records streamed cache usage through the plexus autoRoutingUsageRecorder fallback', async () => {
    setConfigForTesting(
      makeConfig({
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();
    generationResponses = [(body) => chatStream(body.model, 9)];

    const response = await postChat({
      model: 'auto',
      stream: true,
      prompt_cache_key: 'stream-branch-1',
      messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('streamed ok');
    expect(response.body).toContain('[DONE]');

    const generation = generationCalls();
    expect(generation).toHaveLength(1);
    expect(generation[0]!.body.model).toBe('high');

    const scope = buildAutoStateScope({
      keyId: KEY_NAME,
      alias: 'auto',
      apiType: 'chat',
      branch: 'stream-branch-1',
    });
    const warmth = AutoStateStore.getInstance().getWarmth(scope, 'gen-a/high');
    expect(warmth).not.toBeNull();
    expect(warmth!.cachedInputTokens).toBe(9);
  });

  it('keeps a successful streaming response when outcome accounting throws', async () => {
    setConfigForTesting(
      makeConfig({
        targets: [
          { provider: 'gen-a', model: 'cheap', capability: 'economy' },
          { provider: 'gen-a', model: 'high', capability: 'high' },
        ],
      })
    );
    fastify = await startServer();
    generationResponses = [(body) => chatStream(body.model, 4)];
    registerSpy(AutoStateStore.prototype, 'recordIncumbent').mockImplementation(() => {
      throw new Error('accounting boom');
    });

    const response = await postChat({
      model: 'auto',
      stream: true,
      prompt_cache_key: 'accounting-throw-branch',
      messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('streamed ok');
    expect(response.body).toContain('[DONE]');
  });
});
