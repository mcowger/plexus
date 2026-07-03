import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../cooldown-manager';
import type { QuotaContext, QuotaCheckSnapshot } from '../quota/quota-enforcer';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeConfig() {
  return {
    providers: {
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
    },
    models: {
      'test-alias': {
        selector: 'in_order',
        targets: [
          { provider: 'p1', model: 'model-1' },
          { provider: 'p2', model: 'model-2' },
        ],
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
    keyName: 'test-key',
    checks,
    blockedGlobal: checks.find((c) => c.global && !c.allowed) ?? null,
  };
}

function makeChatRequest(quotaContext?: QuotaContext): UnifiedChatRequest {
  const base: UnifiedChatRequest = {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream: false,
  };
  if (!quotaContext) return base;
  return {
    ...base,
    metadata: {
      plexus_metadata: {
        plexus_quota_context: quotaContext,
      },
    },
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

describe('Dispatcher.applyQuotaFilter (via dispatch)', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('no quota context attached — inert, both candidates remain in play', async () => {
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.finalAttemptProvider).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('scoped exhausted quota narrows routing — request succeeds on the remaining candidate, skip recorded in retryHistory', async () => {
    const blockedForP1 = makeSnapshot({
      quotaName: 'p1-only-quota',
      scope: { allowedProviders: ['p1'] },
    });
    const ctx = makeQuotaContext([blockedForP1]);

    fetchMock.mockImplementation(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(ctx));
    const meta = (response as any).plexus;

    // Only p2 was ever attempted upstream — p1 was filtered out before the
    // failover loop even started.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.finalAttemptProvider).toBe('p2');

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    const skipped = retryHistory.find((r: any) => r.status === 'skipped');
    expect(skipped).toBeDefined();
    expect(skipped.provider).toBe('p1');
    expect(skipped.reason).toBe('quota_exceeded:p1-only-quota');
  });

  test('every candidate blocked by (different) scoped quotas — throws terminal quota_exceeded with blocking_quotas for both', async () => {
    const blockedForP1 = makeSnapshot({
      quotaName: 'p1-quota',
      scope: { allowedProviders: ['p1'] },
    });
    const blockedForP2 = makeSnapshot({
      quotaName: 'p2-quota',
      scope: { allowedProviders: ['p2'] },
    });
    const ctx = makeQuotaContext([blockedForP1, blockedForP2]);

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest(ctx));
      throw new Error('expected dispatch to throw');
    } catch (error: any) {
      expect(error.routingContext?.statusCode).toBe(429);
      expect(error.routingContext?.code).toBe('quota_exceeded');
      const blockingQuotas = error.routingContext?.body?.error?.blocking_quotas;
      expect(blockingQuotas).toHaveLength(2);
      expect(blockingQuotas.map((q: any) => q.quotaName).sort()).toEqual(['p1-quota', 'p2-quota']);

      // Terminal 429 still carries the quota-skip breadcrumbs (mirrors the
      // failover-exhaustion pattern) so UsageRecord.retryHistory isn't null.
      const retryHistory = JSON.parse(error.routingContext?.retryHistory ?? 'null');
      expect(retryHistory).toHaveLength(2);
      expect(retryHistory.map((r: any) => r.status)).toEqual(['skipped', 'skipped']);
      expect(retryHistory.map((r: any) => r.reason).sort()).toEqual([
        'quota_exceeded:p1-quota',
        'quota_exceeded:p2-quota',
      ]);
    }

    // Neither candidate ever reached the network — the filter runs before
    // the failover loop.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('scoped quota that matches neither candidate is a no-op', async () => {
    const unrelated = makeSnapshot({
      quotaName: 'unrelated-quota',
      scope: { allowedProviders: ['some-other-provider'] },
    });
    const ctx = makeQuotaContext([unrelated]);

    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(ctx));
    const meta = (response as any).plexus;

    expect(meta?.finalAttemptProvider).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory.find((r: any) => r.status === 'skipped')).toBeUndefined();
  });
});
