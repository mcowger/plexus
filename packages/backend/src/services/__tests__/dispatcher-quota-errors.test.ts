import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../cooldown-manager';
import { QUOTA_ERROR_PATTERNS } from '../../utils/constants';
import { Router } from '../router';
import { TransformerFactory } from '../transformer-factory';

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeConfig(options?: { targetCount?: number }) {
  const targetCount = options?.targetCount ?? 2;

  const providers: Record<string, any> = {
    p1: {
      type: 'chat',
      api_base_url: 'https://p1.example.com/v1',
      api_key: 'test-key-p1',
      models: { 'model-1': {} },
    },
    p2: {
      type: 'chat',
      api_base_url: 'https://p2.example.com/v1',
      api_key: 'test-key-p2',
      models: { 'model-2': {} },
    },
  };

  const orderedTargets = [
    { provider: 'p1', model: 'model-1' },
    { provider: 'p2', model: 'model-2' },
  ].slice(0, targetCount);

  return {
    providers,
    models: {
      'test-alias': {
        selector: 'in_order',
        targets: orderedTargets,
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [400, 402, 500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function makeChatRequest(stream = false): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream,
  };
}

function successChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Dispatcher Quota Error Detection', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('400 with "insufficient_quota" triggers cooldown and failover', async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, JSON.stringify({ type: 'insufficient_quota' }))
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with "credit balance is too low" triggers cooldown (POE pattern)', async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, 'Your credit balance is too low. Visit https://poe.com to add credits.')
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with "used up your points" triggers cooldown', async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, "You've used up your points! Visit the site to get more.")
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest());

    // Verify cooldown was set for p1
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with "quota exceeded" triggers cooldown', async () => {
    fetchMock
      .mockImplementationOnce(async () => errorResponse(400, 'API quota exceeded for this period'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest());

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with "out of credits" triggers cooldown', async () => {
    fetchMock
      .mockImplementationOnce(async () => errorResponse(400, 'Account is out of credits'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest());

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with "insufficient balance" triggers cooldown', async () => {
    fetchMock
      .mockImplementationOnce(async () => errorResponse(400, 'Insufficient balance to proceed'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest());

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('400 with generic error does NOT trigger cooldown (e.g., validation)', async () => {
    fetchMock.mockImplementation(async () => errorResponse(400, 'Invalid request format'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      // Since 400 is retryable, it will attempt both providers
      expect(error.routingContext?.attemptCount).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }

    // Verify NO cooldown was set for either provider (it's a validation error, not quota)
    const isP1Healthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    const isP2Healthy = await CooldownManager.getInstance().isProviderHealthy('p2', 'model-2');
    expect(isP1Healthy).toBe(true);
    expect(isP2Healthy).toBe(true);
  });

  test('402 Payment Required triggers cooldown', async () => {
    fetchMock
      .mockImplementationOnce(async () => errorResponse(402, 'Payment required'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('case-insensitive pattern matching', async () => {
    // Test with uppercase error message
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, 'INSUFFICIENT_QUOTA - Account has no credits remaining')
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest());

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('quota error prevents retry on same provider in single request', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));

    fetchMock.mockImplementation(async () => errorResponse(400, 'Your credit balance is too low'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }

    const isP1Healthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isP1Healthy).toBe(false);

    // Cooldown should be set
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);

    // Second request should skip p1 due to cooldown
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => successChatResponse('model-2'));

    const response2 = await dispatcher.dispatch(makeChatRequest());
    const meta2 = (response2 as any).plexus;

    // Should only call p2, not p1 (which is on cooldown)
    expect(meta2?.attemptCount).toBe(1);
    expect(meta2?.finalAttemptProvider).toBe('p2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain('p2.example.com');
  });

  test('wrapOAuthError classifies pi-ai codex usage limit errors and preserves cooldown duration', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));

    const dispatcher = new Dispatcher();
    const route = {
      provider: 'p1',
      model: 'model-1',
      config: {
        api_base_url: 'oauth://openai-codex',
        oauth_provider: 'openai-codex',
      },
    } as any;

    const piAiResponse = {
      type: 'error',
      reason: 'error',
      error: {
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        errorMessage: 'You have hit your ChatGPT usage limit (free plan). Try again in ~9725 min.',
      },
    };

    const upstreamError = new Error(piAiResponse.error.errorMessage) as Error & {
      piAiResponse?: unknown;
    };
    upstreamError.piAiResponse = piAiResponse;

    const wrapped = (dispatcher as any).wrapOAuthError(upstreamError, route, 'oauth');

    expect(wrapped.routingContext.statusCode).toBe(429);
    expect(wrapped.routingContext.cooldownTriggered).toBe(true);
    expect(wrapped.routingContext.cooldownDuration).toBe(9725 * 60 * 1000);
    expect(wrapped.routingContext.providerResponse).toContain('Try again in ~9725 min');

    await (dispatcher as any).markOAuthProviderFailure(route, wrapped);

    const cooldowns = CooldownManager.getInstance().getCooldowns();
    expect(cooldowns).toHaveLength(1);
    expect(cooldowns[0]?.provider).toBe('p1');
    expect(cooldowns[0]?.model).toBe('model-1');
    expect(cooldowns[0]?.timeRemainingMs).toBeGreaterThan(9724 * 60 * 1000);
    expect(cooldowns[0]?.lastError).toContain('You have hit your ChatGPT usage limit');
    expect(cooldowns[0]?.lastError).not.toContain('"retryHistory"');
  });

  test('streaming oauth codex usage limit triggers cooldown and failover', async () => {
    const piAiStreamError = {
      type: 'error',
      reason: 'error',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: 'error',
        timestamp: Date.now(),
        errorMessage: 'You have hit your ChatGPT usage limit (team plan). Try again in ~45 min.',
      },
    };

    const oauthTransformer = {
      name: 'oauth',
      transformRequest: async () => ({ context: {}, options: {} }),
      transformResponse: async () => {
        throw new Error('not used');
      },
      executeRequest: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(piAiStreamError);
            controller.close();
          },
        }),
    };

    const originalGetTransformer = TransformerFactory.getTransformer;
    const originalResolveCandidates = Router.resolveCandidates;
    const originalResolve = Router.resolve;

    TransformerFactory.getTransformer = ((type: string) => {
      if (type === 'oauth') {
        return oauthTransformer as any;
      }

      return {
        name: 'chat',
        transformRequest: async (request: any) =>
          request.originalBody || { messages: request.messages },
        transformResponse: async (response: any) => ({
          id: response.id,
          model: response.model,
          content: response.choices?.[0]?.message?.content || null,
          usage: {
            prompt_tokens: response.usage?.prompt_tokens || 0,
            completion_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0,
          },
        }),
        defaultEndpoint: '/chat/completions',
      } as any;
    }) as any;

    Router.resolveCandidates = (async () => [
      {
        provider: 'p1',
        model: 'gpt-5.4',
        config: {
          api_base_url: 'oauth://openai-codex',
          oauth_provider: 'openai-codex',
          oauth_account: 'acct-1',
        },
        modelConfig: {},
        canonicalModel: 'test-alias',
      },
      {
        provider: 'p2',
        model: 'model-2',
        config: {
          api_base_url: 'https://p2.example.com/v1',
          api_key: 'test-key-p2',
        },
        modelConfig: {},
        canonicalModel: 'test-alias',
      },
    ]) as any;

    Router.resolve = (async () => ({
      provider: 'p1',
      model: 'gpt-5.4',
      config: {
        api_base_url: 'oauth://openai-codex',
        oauth_provider: 'openai-codex',
        oauth_account: 'acct-1',
      },
      modelConfig: {},
      canonicalModel: 'test-alias',
    })) as any;

    fetchMock.mockImplementationOnce(async () => successChatResponse('model-2'));

    try {
      const dispatcher = new Dispatcher();
      const response = await dispatcher.dispatch(makeChatRequest(true));
      const meta = (response as any).plexus;

      expect(meta?.attemptCount).toBe(2);
      expect(meta?.finalAttemptProvider).toBe('p2');

      const cooldowns = CooldownManager.getInstance().getCooldowns();
      expect(cooldowns).toHaveLength(1);
      expect(cooldowns[0]?.lastError).toContain('You have hit your ChatGPT usage limit');
      expect(cooldowns[0]?.lastError).toContain('Try again in ~45 min');
      expect(cooldowns[0]?.lastError).not.toContain('JSON Parse error');

      const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'gpt-5.4');
      expect(isHealthy).toBe(false);
    } finally {
      TransformerFactory.getTransformer = originalGetTransformer;
      Router.resolveCandidates = originalResolveCandidates;
      Router.resolve = originalResolve;
    }
  });

  test('all quota error patterns are correctly detected', () => {
    // This test verifies that the QUOTA_ERROR_PATTERNS constant is properly used
    // by checking we have at least the main patterns documented
    expect(QUOTA_ERROR_PATTERNS).toContain('insufficient_quota');
    expect(QUOTA_ERROR_PATTERNS).toContain('credit balance is too low');
    expect(QUOTA_ERROR_PATTERNS).toContain('used up your points');
    expect(QUOTA_ERROR_PATTERNS).toContain('quota exceeded');
    expect(QUOTA_ERROR_PATTERNS).toContain('out of credits');
    expect(QUOTA_ERROR_PATTERNS).toContain('insufficient balance');
  });
});
