import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { WisdomGateQuotaChecker } from '../wisdomgate-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (apiKey = 'test_api_key'): QuotaCheckerConfig => ({
  id: 'wisdomgate-test',
  provider: 'wisdomgate',
  type: 'wisdomgate',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey,
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

  it('queries balance with Bearer token and returns subscription quota with dollars', async () => {
    let capturedUrl: string | undefined;
    let capturedAuthorization: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuthorization = headers.get('Authorization') ?? undefined;

      return new Response(
        JSON.stringify({
          available_balance: 23.852028,
          package_balance: 23.848028,
          cash_balance: 0.004,
          token_balance: 23.852028,
          is_token_unlimited_quota: false,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new WisdomGateQuotaChecker(makeConfig('my-api-key'));
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://wisdom-gate.juheapi.com/v1/users/me/balance');
    expect(capturedAuthorization).toBe('Bearer my-api-key');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('subscription');
    expect(window?.unit).toBe('dollars');
    expect(window?.remaining).toBeCloseTo(23.852028, 6);
    expect(window?.description).toBe('Wisdom Gate account balance');
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
          available_balance: 10,
          package_balance: 10,
          cash_balance: 0,
          token_balance: 10,
          is_token_unlimited_quota: false,
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
        apiKey: 'test-key',
        endpoint: 'https://custom.endpoint.example.com/v1/users/me/balance',
      },
    });

    await checker.checkQuota();
    expect(capturedUrl).toBe('https://custom.endpoint.example.com/v1/users/me/balance');
  });

  it('throws error when apiKey option is missing', async () => {
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
