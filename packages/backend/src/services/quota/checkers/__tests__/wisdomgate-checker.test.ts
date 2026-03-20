import { beforeEach, describe, expect, it, mock } from 'bun:test';
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
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under wisdomgate', () => {
    expect(QuotaCheckerFactory.isRegistered('wisdomgate')).toBe(true);
  });

  it('queries balance with session cookie and returns monthly subscription quota with dollars', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;

      return new Response(
        JSON.stringify({
          object: 'billing_details',
          total_usage: 76.147972,
          total_available: 23.852028,
          regular_amount: 100,
          package_details: [
            {
              package_id: 'pkg_123',
              title: 'Test Package',
              amount: 23.852028,
              total_amount: 100,
              expiry_time: 1735689600,
              expiry_date: '2025-01-01',
              begin_time: 1704067200,
              begin_date: '2024-01-01',
            },
          ],
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
    expect(window?.windowType).toBe('monthly');
    expect(window?.unit).toBe('dollars');
    expect(window?.limit).toBe(100);
    expect(window?.used).toBeCloseTo(76.147972, 6);
    expect(window?.remaining).toBeCloseTo(23.852028, 6);
    expect(window?.description).toBe('Wisdom Gate monthly subscription');
    expect(window?.resetsAt).toBeInstanceOf(Date);
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
          object: 'billing_details',
          total_usage: 0,
          total_available: 10,
          regular_amount: 10,
          package_details: [
            {
              package_id: 'pkg_123',
              title: 'Test Package',
              amount: 10,
              total_amount: 10,
              expiry_time: 1735689600,
              expiry_date: '2025-01-01',
              begin_time: 1704067200,
              begin_date: '2024-01-01',
            },
          ],
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

  it('throws error when session option is missing', async () => {
    const checker = new WisdomGateQuotaChecker({
      id: 'wisdomgate-test',
      provider: 'wisdomgate',
      type: 'wisdomgate',
      enabled: true,
      intervalMinutes: 30,
      options: {},
    });

    // requireOption should throw
    expect(() => checker.checkQuota()).toThrow();
  });
});
