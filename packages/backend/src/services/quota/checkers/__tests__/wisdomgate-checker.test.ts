import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { WisdomGateQuotaChecker } from '../wisdomgate-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (session = 'test_session_cookie_value'): QuotaCheckerConfig => ({
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

  it('queries usage with session cookie and returns monthly quota with dollars', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;

      return new Response(
        JSON.stringify({
          object: 'usage_details',
          total_usage: 44.168262,
          total_available: 23.852028,
          regular_amount: 0.004,
          package_details: [
            {
              package_id: 'ejPMUxNjciFxUYSqAkaiI6xalvEZyj9N',
              title: '',
              amount: 23.848028,
              total_amount: 40,
              expiry_time: 1772868308,
              expiry_date: '',
              begin_time: 1770276308,
              begin_date: ''
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new WisdomGateQuotaChecker(makeConfig('test-session-cookie'));
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://wisdom-gate.juheapi.com/api/dashboard/billing/usage/details');
    expect(capturedCookie).toBe('session=test-session-cookie');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);
    
    const window = result.windows?.[0];
    expect(window?.windowType).toBe('monthly');
    expect(window?.unit).toBe('dollars');
    expect(window?.limit).toBe(40);
    expect(window?.used).toBeCloseTo(40 - 23.848028, 6);
    expect(window?.remaining).toBe(23.848028);
    expect(window?.description).toBe('Wisdom Gate monthly credits');
    expect(window?.resetsAt).toBeInstanceOf(Date);
    // Unix timestamp 1772868308 * 1000 = Date
    expect(window?.resetsAt?.getTime()).toBe(1772868308 * 1000);
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }));

    const checker = new WisdomGateQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when no package_details found', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          object: 'usage_details',
          total_usage: 44.168262,
          total_available: 23.852028,
          regular_amount: 0.004,
          package_details: []
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new WisdomGateQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('No package details found in response');
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
