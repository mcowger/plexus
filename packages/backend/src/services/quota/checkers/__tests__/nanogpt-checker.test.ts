import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { NanoGPTQuotaChecker } from '../nanogpt-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (apiKey = 'nanogpt_test_key'): QuotaCheckerConfig => ({
  id: 'nanogpt-test',
  provider: 'nanogpt',
  type: 'nanogpt',
  enabled: true,
  intervalMinutes: 30,
  options: { apiKey },
});

describe('NanoGPTQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under nanogpt', () => {
    expect(QuotaCheckerFactory.isRegistered('nanogpt')).toBe(true);
  });

  it('returns daily and monthly usage windows', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          active: true,
          state: 'active',
          graceUntil: null,
          limits: {
            weeklyInputTokens: null,
            dailyInputTokens: 5000,
            dailyImages: null,
          },
          dailyInputTokens: {
            used: 5,
            remaining: 4995,
            percentUsed: 0.001,
            resetAt: 1738540800000,
          },
          weeklyInputTokens: {
            used: 45,
            remaining: 59955,
            percentUsed: 0.00075,
            resetAt: 1739404800000,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new NanoGPTQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(2);

    const weeklyWindow = result.windows?.find((w) => w.windowType === 'weekly');
    const dailyWindow = result.windows?.find((w) => w.windowType === 'daily');

    expect(weeklyWindow).toBeDefined();
    expect(weeklyWindow?.used).toBe(45);
    expect(weeklyWindow?.remaining).toBe(59955);
    expect(weeklyWindow?.resetsAt?.toISOString()).toBe('2025-02-13T00:00:00.000Z');

    expect(dailyWindow).toBeDefined();
    expect(dailyWindow?.limit).toBe(5000);
    expect(dailyWindow?.used).toBe(5);
    expect(dailyWindow?.remaining).toBe(4995);
    expect(dailyWindow?.status).toBe('ok');
    expect(dailyWindow?.resetsAt?.toISOString()).toBe('2025-02-03T00:00:00.000Z');
  });

  it('returns error when response has no daily/monthly windows', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({ active: true, state: 'unknown', limits: { dailyInputTokens: 5000 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new NanoGPTQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not include any usage windows');
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new NanoGPTQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('trims and normalizes bearer-style API keys', async () => {
    let capturedAuthHeader: string | undefined;
    let capturedXApiKeyHeader: string | undefined;

    setFetchMock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
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

    const checker = new NanoGPTQuotaChecker(makeConfig('  Bearer test_token_123  '));
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(capturedAuthHeader).toBe('Bearer test_token_123');
    expect(capturedXApiKeyHeader).toBeUndefined();
  });

  it('retries auth strategies when first attempt is unauthorized', async () => {
    let callCount = 0;

    setFetchMock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const headers = new Headers(init?.headers);

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

    const checker = new NanoGPTQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(callCount).toBe(2);
    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(2);
  });
});
