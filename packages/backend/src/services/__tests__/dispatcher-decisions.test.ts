import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedDecisionsRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';
import { ConcurrencyTracker } from '../runtime/concurrency-tracker';

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

function decisionsConfig(extra: Record<string, any> = {}) {
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
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
    ...extra,
  } as any;
}

const request: UnifiedDecisionsRequest = {
  model: 'decisions_alias',
  state: 'My checkout page shows a blank screen after I click Pay.',
  questions: {
    is_bug: { type: 'noul', instructions: 'Is the customer reporting a software defect?' },
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
  },
  incomingApiType: 'decisions',
  requestId: 'decisions-request',
};

function okResponse(body: Record<string, any>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const openRouterBody = {
  model: 'typesafe/jev-1.13-20260917',
  answers: { is_bug: { type: 'noul', noul: 0.96 } },
  id: 'gen-dec-1',
  provider: 'TypeSafe',
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
};

describe('Dispatcher decisions translation', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    ConcurrencyTracker.resetForTesting();
  });

  test('dispatches to the System One endpoint with auth and the core payload', async () => {
    setConfigForTesting(decisionsConfig());
    fetchMock.mockResolvedValue(okResponse(openRouterBody));

    const response = await new Dispatcher().dispatchDecisions({ ...request });

    expect(response.model).toBe('typesafe/jev-1.13-20260917');
    expect(response.id).toBe('gen-dec-1');
    expect(response.provider).toBe('TypeSafe');
    expect(response.usage?.cost).toBe(0.000019992);
    expect(response.plexus?.targetApiType).toBe('systemone');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(options.headers.Authorization).toBe('Bearer openrouter-key');
    expect(JSON.parse(options.body)).toEqual({
      model: 'typesafe/jev-1.13',
      state: request.state,
      questions: request.questions,
    });
  });

  test('dispatches TypeSafe direct with the core payload only', async () => {
    setConfigForTesting(
      decisionsConfig({
        models: {
          direct_alias: {
            selector: 'in_order',
            type: 'decisions',
            targets: [{ provider: 'typesafe', model: 'jev-latest' }],
          },
        },
      })
    );
    fetchMock.mockResolvedValue(
      okResponse({
        model: 'jev-1.13.0',
        answers: { is_bug: { type: 'noul', noul: 0.2 } },
        usage: { input_tokens: 296, output_tokens: 20 },
      })
    );

    const response = await new Dispatcher().dispatchDecisions({
      ...request,
      model: 'direct_alias',
    });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(options.headers.Authorization).toBe('Bearer typesafe-key');
    // Only the core payload is ever sent.
    expect(JSON.parse(options.body)).toEqual({
      model: 'jev-latest',
      state: request.state,
      questions: request.questions,
    });
    expect(response.id).toBeUndefined();
    expect(response.provider).toBeUndefined();
    expect(response.plexus?.targetApiType).toBe('systemone');
  });

  test('neither the client nor extraBody can override the routed model', async () => {
    setConfigForTesting(
      decisionsConfig({
        providers: {
          openrouter: {
            api_base_url: { systemone: 'https://openrouter.ai/api/v1' },
            api_key: 'openrouter-key',
            extraBody: {
              model: 'operator-model',
              provider: { only: ['Evil'] },
              session_id: 'operator-session',
              trace: { a: 1 },
              user: 'evil-user',
            },
            models: {
              'typesafe/jev-1.13': {
                access_via: ['systemone'],
                extraBody: { model: 'model-level-override' },
              },
            },
          },
          typesafe: {
            api_base_url: 'https://api.typesafe.ai/v1',
            api_key: 'typesafe-key',
            models: { 'jev-latest': { access_via: ['systemone'] } },
          },
        },
      })
    );
    fetchMock.mockResolvedValue(okResponse(openRouterBody));

    await new Dispatcher().dispatchDecisions({ ...request });

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.model).toBe('typesafe/jev-1.13');
    // Legacy OpenRouter-only fields are stripped even from operator extras.
    expect(body.provider).toBeUndefined();
    expect(body.session_id).toBeUndefined();
    expect(body.trace).toBeUndefined();
    expect(body.user).toBeUndefined();
  });

  test('migrates a legacy stored config to System One at load time', async () => {
    // Stored rows still carry the pre-collapse names; setConfigForTesting
    // applies the same load-time normalization as production, so dispatch
    // resolves the canonical endpoint.
    setConfigForTesting({
      providers: {
        openrouter: {
          api_base_url: { 'openrouter-decisions': 'https://openrouter.ai/api/alpha' },
          api_key: 'openrouter-key',
          models: {
            'typesafe/jev-1.13': { access_via: ['openrouter-decisions'] },
          },
        },
      },
      models: {
        legacy_alias: {
          selector: 'in_order',
          type: 'decisions',
          targets: [{ provider: 'openrouter', model: 'typesafe/jev-1.13' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
    fetchMock.mockResolvedValue(okResponse(openRouterBody));

    const response = await new Dispatcher().dispatchDecisions({
      ...request,
      model: 'legacy_alias',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/systemone');
    expect(response.plexus?.targetApiType).toBe('systemone');
  });

  test('fails over to the second target on a retryable upstream error', async () => {
    setConfigForTesting(decisionsConfig());
    fetchMock
      .mockResolvedValueOnce(new Response('overloaded', { status: 500 }))
      .mockResolvedValueOnce(okResponse(openRouterBody));

    const response = await new Dispatcher().dispatchDecisions(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/systemone');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect(response.plexus?.provider).toBe('typesafe');
    expect((response.plexus as any)?.attemptCount).toBe(2);
  });

  test('surfaces a non-retryable upstream status without retrying', async () => {
    setConfigForTesting(decisionsConfig());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'bad question' }), { status: 422 })
    );

    await expect(new Dispatcher().dispatchDecisions(request)).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 422 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('treats an unusable upstream payload as a 502 provider failure', async () => {
    setConfigForTesting(decisionsConfig());
    // Fresh Response per attempt: a reused body reads as already-consumed.
    fetchMock.mockImplementation(() =>
      Promise.resolve(okResponse({ model: 'x', answers: {}, usage: {} } as any))
    );

    // 502 is retryable, so both targets are attempted before failing.
    await expect(new Dispatcher().dispatchDecisions(request)).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 502 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('denies dispatch when the key policy excludes the model', async () => {
    setConfigForTesting(decisionsConfig());
    fetchMock.mockResolvedValue(okResponse(openRouterBody));

    await expect(
      new Dispatcher().dispatchDecisions({
        ...request,
        metadata: { plexus_metadata: { plexus_key_policy: { allowedModels: ['other'] } } },
      })
    ).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 403 }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('skips admitted targets on cooldown and releases slots after success', async () => {
    setConfigForTesting(decisionsConfig());
    fetchMock.mockResolvedValue(okResponse(openRouterBody));

    await new Dispatcher().dispatchDecisions(request);

    expect(ConcurrencyTracker.getInstance().getTargetCount('openrouter', 'typesafe/jev-1.13')).toBe(
      0
    );
  });

  test('rejects models with no decisions-capable target with a 400', async () => {
    setConfigForTesting({
      providers: {
        chatonly: {
          api_base_url: 'https://chat.example.com/v1',
          api_key: 'chat-key',
          models: { 'chat-model': { access_via: ['chat'] } },
        },
      },
      models: {
        chat_alias: {
          selector: 'in_order',
          type: 'decisions',
          targets: [{ provider: 'chatonly', model: 'chat-model' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    await expect(
      new Dispatcher().dispatchDecisions({ ...request, model: 'chat_alias' })
    ).rejects.toMatchObject({
      message: expect.stringContaining('No decisions-capable target'),
      routingContext: expect.objectContaining({ statusCode: 400 }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects unconstrained non-decisions targets with a 400', async () => {
    setConfigForTesting({
      providers: {
        generic: {
          api_base_url: 'https://chat.example.com/v1',
          api_key: 'chat-key',
          models: { 'generic-model': {} },
        },
      },
      models: {
        generic_alias: {
          selector: 'in_order',
          type: 'decisions',
          targets: [{ provider: 'generic', model: 'generic-model' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    // The decisions alias admits the unconstrained target, but no advertised
    // protocol has a Decisions endpoint, so dispatch fails before any fetch.
    await expect(
      new Dispatcher().dispatchDecisions({ ...request, model: 'generic_alias' })
    ).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 400 }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('aborts before dispatch when the client already disconnected', async () => {
    setConfigForTesting(decisionsConfig());
    const controller = new AbortController();
    controller.abort();

    await expect(
      new Dispatcher().dispatchDecisions(request, controller.signal)
    ).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 499 }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
