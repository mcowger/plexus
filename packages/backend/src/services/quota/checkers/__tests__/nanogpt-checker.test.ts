import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../nanogpt-checker';

const makeCtx = (apiKey = 'nanogpt_test_key') =>
  createMeterContext('nanogpt-test', 'nanogpt', { apiKey });

describe('nanogpt checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under nanogpt', () => {
    expect(isCheckerRegistered('nanogpt')).toBe(true);
  });

  it('returns daily and weekly allowance meters', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            active: true,
            state: 'active',
            limits: { weeklyInputTokens: null, dailyInputTokens: 5000, dailyImages: null },
            dailyInputTokens: { used: 5, remaining: 4995, resetAt: 1738540800000 },
            weeklyInputTokens: { used: 45, remaining: 59955, resetAt: 1739404800000 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);

    const weekly = meters.find((m) => m.key === 'weekly_tokens')!;
    const daily = meters.find((m) => m.key === 'daily_tokens')!;

    expect(weekly).toBeDefined();
    expect(weekly.kind).toBe('allowance');
    expect(weekly.unit).toBe('tokens');
    expect(weekly.used).toBe(45);
    expect(weekly.remaining).toBe(59955);
    expect(weekly.resetsAt).toBe('2025-02-13T00:00:00.000Z');

    expect(daily).toBeDefined();
    expect(daily.limit).toBe(5000);
    expect(daily.used).toBe(5);
    expect(daily.remaining).toBe(4995);
    expect(daily.status).toBe('ok');
    expect(daily.resetsAt).toBe('2025-02-03T00:00:00.000Z');
  });

  it('throws when response has no daily/weekly windows', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({ active: true, state: 'unknown', limits: { dailyInputTokens: 5000 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('usage windows');
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('trims and normalizes bearer-style API keys', async () => {
    let capturedAuthHeader: string | undefined;
    let capturedXApiKeyHeader: string | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      capturedAuthHeader = headers.get('Authorization') ?? undefined;
      capturedXApiKeyHeader = headers.get('x-api-key') ?? undefined;

      return new Response(
        JSON.stringify({
          state: 'active',
          active: true,
          limits: { dailyInputTokens: 10 },
          dailyInputTokens: { used: 1, remaining: 9, resetAt: 1738540800000 },
          weeklyInputTokens: { used: 3, remaining: 97, resetAt: 1739404800000 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await checkerDef.check(makeCtx('  Bearer test_token_123  '));

    expect(capturedAuthHeader).toBe('Bearer test_token_123');
    expect(capturedXApiKeyHeader).toBeUndefined();
  });

  it('retries auth strategies when first attempt is unauthorized', async () => {
    let callCount = 0;

    setFetchMock(async (_input: unknown, init: unknown) => {
      callCount += 1;
      const headers = new Headers((init as RequestInit | undefined)?.headers);

      if (callCount === 1) {
        expect(headers.get('Authorization')).toBe('Bearer nanogpt_test_key');
        expect(headers.get('x-api-key')).toBeNull();
        return new Response('unauthorized', { status: 401, statusText: 'Unauthorized' });
      }

      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('x-api-key')).toBe('nanogpt_test_key');
      return new Response(
        JSON.stringify({
          state: 'active',
          active: true,
          limits: { dailyInputTokens: 100, weeklyInputTokens: null },
          dailyInputTokens: { used: 10, remaining: 90, resetAt: 1738540800000 },
          weeklyInputTokens: { used: 100, remaining: 900, resetAt: 1739404800000 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const meters = await checkerDef.check(makeCtx());

    expect(callCount).toBe(2);
    expect(meters).toHaveLength(2);
  });
});
