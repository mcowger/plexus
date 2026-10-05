import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerDecisionsRoute } from '../../src/routes/inference/decisions';
import { registerInferenceRoutes } from '../../src/routes/inference/index';
import { buildQuotaExceededError } from '../../src/services/quota/quota-middleware';
import { Dispatcher } from '../../src/services/dispatch/dispatcher';
import { setConfigForTesting } from '../../src/config';
import { CooldownManager } from '../../src/services/runtime/cooldown-manager';
import { ConcurrencyTracker } from '../../src/services/runtime/concurrency-tracker';

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

function decisionsConfig() {
  return {
    providers: {
      openrouter: {
        api_base_url: { systemone: 'https://openrouter.ai/api/v1' },
        api_key: 'openrouter-key',
        models: {
          'typesafe/jev-1.13': { access_via: ['systemone'] },
        },
      },
      typesafe: {
        api_base_url: 'https://api.typesafe.ai/v1',
        api_key: 'typesafe-key',
        models: {
          'jev-latest': { access_via: ['systemone'] },
        },
      },
    },
    models: {
      decisions_alias: {
        selector: 'in_order',
        type: 'decisions',
        targets: [
          { provider: 'openrouter', model: 'typesafe/jev-1.13' },
          { provider: 'typesafe', model: 'jev-latest' },
        ],
      },
      direct_alias: {
        selector: 'in_order',
        type: 'decisions',
        targets: [{ provider: 'typesafe', model: 'jev-latest' }],
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

const questions = {
  is_bug: {
    type: 'noul',
    instructions: 'Is the customer reporting a software defect?',
    criteria: { true: 'Broken behavior', false: 'Question or feature request' },
  },
  team: {
    type: 'choice',
    instructions: 'Which team should own this ticket?',
    criteria: { payments: 'Checkout, billing', frontend: 'Rendering issues' },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this ticket?',
    criteria: ['Can wait', 'This week', 'Blocking revenue'],
  },
};

function upstreamBody() {
  return {
    model: 'typesafe/jev-1.13-20260917',
    answers: {
      is_bug: { type: 'noul', noul: 0.96 },
      team: {
        type: 'choice',
        choice: 'payments',
        probabilities: { payments: 0.84, frontend: 0.16 },
        confidence: 0.75,
      },
      urgency: {
        type: 'score',
        score: 1.99,
        legend: { 0: 'Can wait', 1: 'This week', 2: 'Blocking revenue' },
        probabilities: { 0: 0, 1: 0.01, 2: 0.99 },
        confidence: 0.99,
      },
    },
    id: 'gen-dec-1789738314-X5e5eKGQdvR9rblyX250',
    provider: 'TypeSafe',
    usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
  };
}

describe('POST /v1/decisions', () => {
  let savedRequests: any[];
  let savedErrors: any[];
  let storage: any;

  beforeEach(async () => {
    fetchMock.mockReset();
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
    setConfigForTesting(decisionsConfig());
    savedRequests = [];
    savedErrors = [];
    storage = {
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
      saveRequest: vi.fn((record: any) => savedRequests.push(record)),
      saveError: vi.fn((...args: any[]) => savedErrors.push(args)),
    };
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
  });

  async function post(body: Record<string, any>, url = '/v1/decisions') {
    const fastify = Fastify();
    await registerDecisionsRoute(fastify, new Dispatcher(), storage);
    const response = await fastify.inject({
      method: 'POST',
      url,
      payload: body,
    });
    await fastify.close();
    return response;
  }

  test('serves a System One request end to end', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(upstreamBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await post({
      model: 'decisions_alias',
      state: { customer_tier: 'enterprise', ticket: 'My checkout shows a blank screen.' },
      questions,
    });

    expect(response.statusCode).toBe(200);
    const client = response.json();
    // Client shape mirrors upstream; internal metadata never leaks.
    expect(client).toEqual(upstreamBody());
    expect(client.plexus).toBeUndefined();

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(options.headers.Authorization).toBe('Bearer openrouter-key');
    const sent = JSON.parse(options.body);
    expect(sent).toEqual({
      model: 'typesafe/jev-1.13',
      state: { customer_tier: 'enterprise', ticket: 'My checkout shows a blank screen.' },
      questions,
    });

    expect(savedRequests).toHaveLength(1);
    const record = savedRequests[0]!;
    expect(record).toMatchObject({
      incomingApiType: 'decisions',
      incomingModelAlias: 'decisions_alias',
      provider: 'openrouter',
      selectedModelName: 'typesafe/jev-1.13',
      outgoingApiType: 'systemone',
      tokensInput: 476,
      tokensOutput: 70,
      providerReportedCost: 0.000019992,
      responseStatus: 'success',
      isPassthrough: false,
    });
  });

  test('serves the same request on the /v1/systemone alias', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(upstreamBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await post(
      { model: 'decisions_alias', state: { ticket: 'Blank checkout screen.' }, questions },
      '/v1/systemone'
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(upstreamBody());
    expect(fetchMock.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/systemone');
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0]).toMatchObject({
      incomingApiType: 'decisions',
      responseStatus: 'success',
    });
  });

  test('serves a TypeSafe direct request with the core payload only', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { is_bug: { type: 'noul', noul: 0.2 } },
          usage: { input_tokens: 296, output_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await post({
      model: 'direct_alias',
      state: 'Just asking about pricing.',
      questions: { is_bug: questions.is_bug },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      model: 'jev-1.13.0',
      answers: { is_bug: { type: 'noul', noul: 0.2 } },
      usage: { input_tokens: 296, output_tokens: 20 },
    });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(options.body)).toEqual({
      model: 'jev-latest',
      state: 'Just asking about pricing.',
      questions: { is_bug: questions.is_bug },
    });
  });

  test('rejects invalid requests with a 400 and records the error', async () => {
    const response = await post({
      model: 'decisions_alias',
      state: 'x',
      questions: { q: questions.is_bug },
      stream: true,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('invalid_request_error');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0].responseStatus).toBe('error');
    expect(savedErrors).toHaveLength(1);
  });

  test('rejects unknown models without touching any upstream', async () => {
    const response = await post({
      model: 'no_such_alias',
      state: 'x',
      questions: { q: questions.is_bug },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('propagates upstream rate limiting without retrying past the policy', async () => {
    fetchMock.mockResolvedValue(new Response('Rate limit exceeded', { status: 429 }));

    const response = await post({
      model: 'direct_alias',
      state: 'x',
      questions: { q: questions.is_bug },
    });

    // Single target: 429 is retryable but there is nothing left to try.
    expect(response.statusCode).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(savedRequests[0].responseStatus).toBe('error');
  });
});

describe('POST /v1/decisions policy hardening', () => {
  let savedRequests: any[];
  let savedErrors: any[];
  let storage: any;

  beforeEach(async () => {
    fetchMock.mockReset();
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
    setConfigForTesting(decisionsConfig());
    savedRequests = [];
    savedErrors = [];
    storage = {
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
      saveRequest: vi.fn((record: any) => savedRequests.push(record)),
      saveError: vi.fn((...args: any[]) => savedErrors.push(args)),
    };
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
  });

  const validBody = () => ({
    model: 'decisions_alias',
    state: { customer_tier: 'enterprise', ticket: 'My checkout shows a blank screen.' },
    questions: { is_bug: questions.is_bug },
  });

  function okUpstream() {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'typesafe/jev-1.13-20260917',
          answers: { is_bug: { type: 'noul', noul: 0.96 } },
          usage: { input_tokens: 476, output_tokens: 70 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  }

  test('operator extraBody cannot overwrite state, questions, or the routed model', async () => {
    setConfigForTesting({
      ...decisionsConfig(),
      providers: {
        openrouter: {
          api_base_url: { systemone: 'https://openrouter.ai/api/v1' },
          api_key: 'openrouter-key',
          extraBody: {
            model: 'attacker-model',
            state: 'attacker-state',
            questions: { evil: { type: 'noul', instructions: 'evil' } },
            provider: { only: ['Evil'] },
            session_id: 'attacker-session',
          },
          models: {
            'typesafe/jev-1.13': { access_via: ['systemone'] },
          },
        },
      },
    });
    okUpstream();

    const fastify = Fastify();
    await registerDecisionsRoute(fastify, new Dispatcher(), storage);
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      payload: validBody(),
    });
    await fastify.close();

    expect(response.statusCode).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(sent.model).toBe('typesafe/jev-1.13');
    expect(sent.state).toEqual(validBody().state);
    expect(sent.questions).toEqual({ is_bug: questions.is_bug });
    expect(sent.provider).toBeUndefined();
    expect(sent.session_id).toBeUndefined();
  });

  test('legacy operator extras carrying removed fields are stripped', async () => {
    setConfigForTesting({
      ...decisionsConfig(),
      providers: {
        typesafe: {
          api_base_url: 'https://api.typesafe.ai/v1',
          api_key: 'typesafe-key',
          extraBody: { session_id: 'operator-session', trace: { a: 1 } },
          models: {
            'jev-latest': { access_via: ['systemone'] },
          },
        },
      },
      models: {
        direct_alias: {
          selector: 'in_order',
          type: 'decisions',
          targets: [{ provider: 'typesafe', model: 'jev-latest' }],
        },
      },
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { is_bug: { type: 'noul', noul: 0.2 } },
          usage: { input_tokens: 296, output_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const fastify = Fastify();
    await registerDecisionsRoute(fastify, new Dispatcher(), storage);
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      payload: {
        model: 'direct_alias',
        state: 'Just asking about pricing.',
        questions: { is_bug: questions.is_bug },
      },
    });
    await fastify.close();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      model: 'jev-latest',
      state: 'Just asking about pricing.',
      questions: { is_bug: questions.is_bug },
    });
  });

  test('a blocked global quota rejects before any upstream dispatch', async () => {
    okUpstream();
    const quotaEnforcer = {
      loadQuotaContext: async () => ({
        keyName: 'test-key',
        checks: [],
        blockedGlobal: {
          quotaName: 'daily-cost',
          limitType: 'cost',
          limit: 1,
          currentUsage: 2,
          remaining: 0,
          resetsAtMs: Date.now() + 60000,
        },
      }),
      recordUsage: vi.fn(),
    };

    const fastify = Fastify();
    fastify.addHook('onRequest', async (request: any) => {
      request.keyName = 'test-key';
    });
    await registerDecisionsRoute(fastify, new Dispatcher(), storage, quotaEnforcer as any);
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      payload: validBody(),
    });
    await fastify.close();

    expect(response.statusCode).toBe(429);
    expect(response.json().error.type).toBe('quota_exceeded');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0].responseStatus).toBe('quota_exceeded');
    expect(quotaEnforcer.recordUsage).not.toHaveBeenCalled();
  });

  test('a successful request records quota usage and emits quota headers for the serving target', async () => {
    okUpstream();
    const resetsAtMs = Date.parse('2026-09-22T00:00:00.000Z');
    const quotaEnforcer = {
      loadQuotaContext: async () => ({
        keyName: 'test-key',
        checks: [
          {
            quotaName: 'jev-tokens',
            limitType: 'tokens',
            limit: 1000,
            currentUsage: 800,
            remaining: 200,
            allowed: true,
            resetsAtMs,
            scope: { allowedProviders: ['openrouter'] },
            global: false,
            shared: false,
            warnAt: 0.8,
            source: 'assigned',
          },
        ],
        blockedGlobal: null,
      }),
      recordUsage: vi.fn(),
    };

    const fastify = Fastify();
    fastify.addHook('onRequest', async (request: any) => {
      request.keyName = 'test-key';
    });
    await registerDecisionsRoute(fastify, new Dispatcher(), storage, quotaEnforcer as any);
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      payload: validBody(),
    });
    await fastify.close();

    expect(response.statusCode).toBe(200);
    expect(quotaEnforcer.recordUsage).toHaveBeenCalledWith(
      'test-key',
      'openrouter',
      'typesafe/jev-1.13',
      expect.objectContaining({ tokensInput: 476, tokensOutput: 70 })
    );
    expect(response.headers['x-plexus-quota']).toBe('jev-tokens');
    expect(response.headers['x-plexus-quota-limit']).toBe('1000');
    expect(response.headers['x-plexus-quota-remaining']).toBe('200');
    expect(response.headers['x-plexus-quota-reset']).toBe(new Date(resetsAtMs).toISOString());
    expect(response.headers['x-plexus-quota-warning']).toBe('jev-tokens');
  });

  test('a quota_exceeded routing error returns the quota body', async () => {
    const snapshot = {
      quotaName: 'daily-cost',
      limitType: 'cost',
      limit: 1,
      currentUsage: 2,
      remaining: 0,
      resetsAtMs: Date.now() + 60000,
    };
    const failingDispatcher = {
      dispatchDecisions: async () => {
        throw buildQuotaExceededError([snapshot] as any);
      },
    };

    const fastify = Fastify();
    await registerDecisionsRoute(fastify, failingDispatcher as any, storage);
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      payload: validBody(),
    });
    await fastify.close();

    expect(response.statusCode).toBe(429);
    expect(response.json().error.type).toBe('quota_exceeded');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0].responseStatus).toBe('quota_exceeded');
    expect(savedErrors).toHaveLength(1);
  });

  test('the protected inference routes require a valid Bearer key', async () => {
    setConfigForTesting({
      ...decisionsConfig(),
      keys: { e2e: { secret: 's3cret' } },
    });
    okUpstream();

    const fastify = Fastify();
    await registerInferenceRoutes(fastify, new Dispatcher(), storage);

    const authed = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      headers: { authorization: 'Bearer s3cret' },
      payload: validBody(),
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.json().answers).toBeDefined();

    const denied = await fastify.inject({
      method: 'POST',
      url: '/v1/decisions',
      headers: { authorization: 'Bearer wrong' },
      payload: validBody(),
    });
    expect(denied.statusCode).toBe(401);

    const deniedAlias = await fastify.inject({
      method: 'POST',
      url: '/v1/systemone',
      headers: { authorization: 'Bearer wrong' },
      payload: validBody(),
    });
    expect(deniedAlias.statusCode).toBe(401);
    // Only the authenticated request reached the upstream.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fastify.close();
  });
});
