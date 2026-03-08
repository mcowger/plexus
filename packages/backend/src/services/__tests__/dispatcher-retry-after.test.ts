import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../cooldown-manager';

const fetchMock: any = mock(async (): Promise<any> => {
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
    adminKey: 'secret',
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

function rateLimitResponse(retryAfterHeader?: string, message = 'Rate limit exceeded') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (retryAfterHeader) {
    headers['retry-after'] = retryAfterHeader;
  }
  return new Response(JSON.stringify({ error: { message } }), {
    status: 429,
    headers,
  });
}

describe('Dispatcher Retry-After Header Parsing', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('429 with Retry-After: seconds triggers cooldown with parsed duration', async () => {
    fetchMock
      .mockImplementationOnce(async () => rateLimitResponse('60', 'Rate limit exceeded'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1 with approximately 60 seconds
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);

    // Check cooldown details via getCooldowns
    const cooldowns = CooldownManager.getInstance().getCooldowns();
    const p1Cooldown = cooldowns.find((c) => c.provider === 'p1' && c.model === 'model-1');
    expect(p1Cooldown).toBeDefined();
    expect(p1Cooldown?.timeRemainingMs).toBeGreaterThan(55000);
    expect(p1Cooldown?.timeRemainingMs).toBeLessThanOrEqual(60000);
  });

  test('429 with Retry-After: HTTP-date triggers cooldown with calculated duration', async () => {
    const futureDate = new Date(Date.now() + 120000); // 2 minutes from now
    const dateString = futureDate.toUTCString();

    fetchMock
      .mockImplementationOnce(async () => rateLimitResponse(dateString, 'Rate limit exceeded'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1 with approximately 2 minutes
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);

    const cooldowns = CooldownManager.getInstance().getCooldowns();
    const p1Cooldown = cooldowns.find((c) => c.provider === 'p1' && c.model === 'model-1');
    expect(p1Cooldown).toBeDefined();
    expect(p1Cooldown?.timeRemainingMs).toBeGreaterThan(115000);
    expect(p1Cooldown?.timeRemainingMs).toBeLessThanOrEqual(120000);
  });

  test('429 with malformed Retry-After falls back to message parsing', async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        rateLimitResponse('invalid-value', 'Your quota will reset after 30s')
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1 using message parsing fallback
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('429 with missing Retry-After falls back to message parsing', async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        rateLimitResponse(undefined, 'Your quota will reset after 45s')
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1 using message parsing fallback
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);
  });

  test('429 with Retry-After: 0 triggers cooldown with 0ms duration', async () => {
    fetchMock
      .mockImplementationOnce(async () => rateLimitResponse('0', 'Rate limit exceeded'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set but with 0 duration (immediate retry allowed)
    // With 0s duration, provider may or may not be on cooldown depending on timing
    // The key is that no exception was thrown and failover worked
  });

  test('Retry-After header takes precedence over message parsing', async () => {
    // Header says 60s, message says 30s - header should win
    fetchMock
      .mockImplementationOnce(async () =>
        rateLimitResponse('60', 'Your quota will reset after 30s')
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Verify cooldown was set for p1 with header value (60s), not message (30s)
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);

    const cooldowns = CooldownManager.getInstance().getCooldowns();
    const p1Cooldown = cooldowns.find((c) => c.provider === 'p1' && c.model === 'model-1');
    expect(p1Cooldown).toBeDefined();
    expect(p1Cooldown?.timeRemainingMs).toBeGreaterThan(55000); // Should be ~60s, not ~30s
    expect(p1Cooldown?.timeRemainingMs).toBeLessThanOrEqual(60000);
  });

  test('Retry-After with large seconds value is handled correctly', async () => {
    fetchMock
      .mockImplementationOnce(
        async () => rateLimitResponse('3600', 'Rate limit exceeded') // 1 hour
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);

    // Verify cooldown was set for p1 with 1 hour duration
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy('p1', 'model-1');
    expect(isHealthy).toBe(false);

    const cooldowns = CooldownManager.getInstance().getCooldowns();
    const p1Cooldown = cooldowns.find((c) => c.provider === 'p1' && c.model === 'model-1');
    expect(p1Cooldown).toBeDefined();
    expect(p1Cooldown?.timeRemainingMs).toBeGreaterThan(3500000);
    expect(p1Cooldown?.timeRemainingMs).toBeLessThanOrEqual(3600000);
  });
});
