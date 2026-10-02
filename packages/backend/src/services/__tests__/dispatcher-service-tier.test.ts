import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeConfig(aliasExtra: Record<string, unknown> = {}) {
  return {
    providers: {
      p1: {
        type: 'chat',
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'test-key-p1',
        models: { 'model-1': {} },
      },
    },
    models: {
      'test-alias': {
        selector: 'in_order',
        targets: [{ provider: 'p1', model: 'model-1' }],
        ...aliasExtra,
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function chatRequest(model: string, overrides: Partial<UnifiedChatRequest> = {}) {
  return {
    model,
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream: false,
    ...overrides,
  } as UnifiedChatRequest;
}

function withKeyPolicy(
  request: UnifiedChatRequest,
  policy: { allowedModels?: string[]; excludedModels?: string[] }
): UnifiedChatRequest {
  return { ...request, metadata: { plexus_metadata: { plexus_key_policy: policy } } };
}

function successChatResponse() {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'model-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function sentBody() {
  return JSON.parse((fetchMock.mock.calls[0] as any[])[1].body as string);
}

describe('Dispatcher service-tier suffix', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => successChatResponse());
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('<alias>@flex routes to the alias and sends service_tier: flex', async () => {
    await new Dispatcher().dispatch(chatRequest('test-alias@flex'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatchObject({ model: 'model-1', service_tier: 'flex' });
  });

  test('a plain alias sends no service_tier', async () => {
    await new Dispatcher().dispatch(chatRequest('test-alias'));

    expect(sentBody()).not.toHaveProperty('service_tier');
  });

  test('a client service_tier still passes through when no suffix is used', async () => {
    await new Dispatcher().dispatch(
      chatRequest('test-alias', {
        originalBody: {
          model: 'test-alias',
          messages: [{ role: 'user', content: 'hello' }],
          service_tier: 'priority',
        },
      })
    );

    expect(sentBody().service_tier).toBe('priority');
  });

  test('the suffix replaces a client service_tier on a same-format request', async () => {
    await new Dispatcher().dispatch(
      chatRequest('test-alias@priority', {
        originalBody: {
          model: 'test-alias@priority',
          messages: [{ role: 'user', content: 'hello' }],
          service_tier: 'default',
        },
      })
    );

    expect(sentBody().service_tier).toBe('priority');
  });

  test('alias extraBody still wins over the suffix', async () => {
    setConfigForTesting(makeConfig({ extraBody: { service_tier: 'default' } }));

    await new Dispatcher().dispatch(chatRequest('test-alias@flex'));

    expect(sentBody().service_tier).toBe('default');
  });

  test('request.model keeps the name the client sent', async () => {
    const request = chatRequest('test-alias@flex');

    await new Dispatcher().dispatch(request);

    expect(request.model).toBe('test-alias@flex');
    expect(request.serviceTier).toBe('flex');
  });

  test('an unknown alias with a suffix fails as not found under the name sent', async () => {
    await expect(new Dispatcher().dispatch(chatRequest('nope@flex'))).rejects.toThrow(
      "Model 'nope@flex' not found in configuration"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('key model lists', () => {
    const denied = (model: string) => ({
      message: `Key is not allowed to access model '${model}' for chat`,
      routingContext: { statusCode: 403, errorType: 'access_denied' },
    });

    test('excluding the alias also excludes every tier of it', async () => {
      await expect(
        new Dispatcher().dispatch(
          withKeyPolicy(chatRequest('test-alias@flex'), { excludedModels: ['test-alias'] })
        )
      ).rejects.toMatchObject(denied('test-alias@flex'));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('allowing the alias allows its tiers', async () => {
      await new Dispatcher().dispatch(
        withKeyPolicy(chatRequest('test-alias@flex'), { allowedModels: ['test-alias'] })
      );

      expect(sentBody().service_tier).toBe('flex');
    });

    test('one tier can be excluded on its own', async () => {
      const policy = { excludedModels: ['test-alias@priority'] };

      await expect(
        new Dispatcher().dispatch(withKeyPolicy(chatRequest('test-alias@priority'), policy))
      ).rejects.toMatchObject(denied('test-alias@priority'));
      expect(fetchMock).not.toHaveBeenCalled();

      await new Dispatcher().dispatch(withKeyPolicy(chatRequest('test-alias@flex'), policy));
      expect(sentBody().service_tier).toBe('flex');
    });

    test('a key allowed only one tier cannot use the others or the bare alias', async () => {
      const policy = { allowedModels: ['test-alias@flex'] };

      await new Dispatcher().dispatch(withKeyPolicy(chatRequest('test-alias@flex'), policy));
      expect(sentBody().service_tier).toBe('flex');
      fetchMock.mockClear();

      for (const model of ['test-alias@priority', 'test-alias']) {
        await expect(
          new Dispatcher().dispatch(withKeyPolicy(chatRequest(model), policy))
        ).rejects.toMatchObject(denied(model));
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('a tier entry covers the tier however the client capitalises it', async () => {
      await expect(
        new Dispatcher().dispatch(
          withKeyPolicy(chatRequest('test-alias@FLEX'), { excludedModels: ['test-alias@flex'] })
        )
      ).rejects.toMatchObject(denied('test-alias@FLEX'));
      expect(fetchMock).not.toHaveBeenCalled();

      await new Dispatcher().dispatch(
        withKeyPolicy(chatRequest('test-alias@Priority'), {
          allowedModels: ['test-alias@priority'],
        })
      );
      expect(sentBody().service_tier).toBe('priority');
    });

    test('priority and fast are one tier, so an entry for either covers both', async () => {
      for (const [entry, model] of [
        ['test-alias@priority', 'test-alias@fast'],
        ['test-alias@fast', 'test-alias@priority'],
      ] as const) {
        await expect(
          new Dispatcher().dispatch(withKeyPolicy(chatRequest(model), { excludedModels: [entry] }))
        ).rejects.toMatchObject(denied(model));
      }
      expect(fetchMock).not.toHaveBeenCalled();

      // What goes upstream is still the spelling the client chose.
      await new Dispatcher().dispatch(
        withKeyPolicy(chatRequest('test-alias@fast'), { allowedModels: ['test-alias@priority'] })
      );
      expect(sentBody().service_tier).toBe('fast');
      fetchMock.mockClear();

      await expect(
        new Dispatcher().dispatch(
          withKeyPolicy(chatRequest('test-alias@flex'), { allowedModels: ['test-alias@priority'] })
        )
      ).rejects.toMatchObject(denied('test-alias@flex'));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('default and standard are one tier, so an entry for either covers both', async () => {
      for (const [entry, model] of [
        ['test-alias@default', 'test-alias@standard'],
        ['test-alias@standard', 'test-alias@default'],
      ] as const) {
        await expect(
          new Dispatcher().dispatch(withKeyPolicy(chatRequest(model), { excludedModels: [entry] }))
        ).rejects.toMatchObject(denied(model));
      }
      expect(fetchMock).not.toHaveBeenCalled();

      await new Dispatcher().dispatch(
        withKeyPolicy(chatRequest('test-alias@standard'), {
          allowedModels: ['test-alias@default'],
        })
      );
      // The wire value is normalised to OpenAI's `default` spelling.
      expect(sentBody().service_tier).toBe('default');
    });

    test('an ultrafast entry has no alias and does not cover standard', async () => {
      await new Dispatcher().dispatch(chatRequest('test-alias@ultrafast'));
      // OpenAI has no ultrafast capacity tier; it decays to the nearest priority.
      expect(sentBody().service_tier).toBe('priority');
      fetchMock.mockClear();

      await expect(
        new Dispatcher().dispatch(
          withKeyPolicy(chatRequest('test-alias@standard'), {
            allowedModels: ['test-alias@ultrafast'],
          })
        )
      ).rejects.toMatchObject(denied('test-alias@standard'));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
