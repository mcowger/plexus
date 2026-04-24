import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { WisdomGateQuotaChecker } from '../wisdomgate-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (session = 'test_session_token'): QuotaCheckerConfig => ({
  id: 'wisdomgate-test',
  provider: 'wisdomgate',
  type: 'wisdomgate',
  enabled: true,
  intervalMinutes: 30,
  options: {
    session,
  },
});

describe('WisdomGateQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under wisdomgate', () => {
    expect(QuotaCheckerFactory.isRegistered('wisdomgate')).toBe(true);
  });

  it('queries balance with session cookie and returns subscription quota with dollars', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;

      return new Response(
        JSON.stringify({
          object: 'usage_details',
          total_usage: 148.49091,
          total_available: 0.067706,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new WisdomGateQuotaChecker(makeConfig('my-session-token'));
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://wisgate.ai/api/dashboard/billing/usage/details');
    expect(capturedCookie).toBe('session=my-session-token');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('subscription');
    expect(window?.unit).toBe('dollars');
    expect(window?.used).toBeCloseTo(148.49091, 6);
    expect(window?.remaining).toBeCloseTo(0.067706, 6);
    expect(window?.limit).toBeCloseTo(148.558616, 6);
    expect(window?.description).toBe('Wisdom Gate subscription');
    expect(window?.resetsAt).toBeUndefined();
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new WisdomGateQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          object: 'usage_details',
          total_usage: 10,
          total_available: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new WisdomGateQuotaChecker({
      id: 'wisdomgate-test',
      provider: 'wisdomgate',
      type: 'wisdomgate',
      enabled: true,
      intervalMinutes: 30,
      options: {
        session: 'test-session',
        endpoint: 'https://custom.endpoint.example.com/api/dashboard/billing/usage/details',
      },
    });

    await checker.checkQuota();
    expect(capturedUrl).toBe(
      'https://custom.endpoint.example.com/api/dashboard/billing/usage/details'
    );
  });

  it('has category balance', () => {
    const checker = new WisdomGateQuotaChecker(makeConfig());
    expect(checker.category).toBe('balance');
  });

  it('throws error when session option is missing', async () => {
    const checker = new WisdomGateQuotaChecker({
      id: 'wisdomgate-test',
      provider: 'wisdomgate',
      type: 'wisdomgate',
      enabled: true,
      intervalMinutes: 30,
      options: {},
    });

    await expect(checker.checkQuota()).rejects.toThrow();
  });
});
