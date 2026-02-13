import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { MiniMaxQuotaChecker } from '../minimax-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (
  groupid = '1234567890',
  hertzSession = 'test_hertz_session_cookie_value'
): QuotaCheckerConfig => ({
  id: 'minimax-test',
  provider: 'minimax',
  type: 'minimax',
  enabled: true,
  intervalMinutes: 30,
  options: {
    groupid,
    hertzSession,
  },
});

describe('MiniMaxQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under minimax', () => {
    expect(QuotaCheckerFactory.isRegistered('minimax')).toBe(true);
  });

  it('queries balance with GroupId and HERTZ-SESSION cookie, using available_amount as remaining dollars', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;

      return new Response(
        JSON.stringify({
          available_amount: '22.91',
          cash_balance: '22.91',
          voucher_balance: '0.00',
          credit_balance: '0.00',
          owed_amount: '0.00',
          balance_alert_switch: false,
          balance_alert_threshold: '',
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new MiniMaxQuotaChecker(makeConfig('group-abc', 'cookie-secret-value'));
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://platform.minimax.io/account/query_balance?GroupId=group-abc');
    expect(capturedCookie).toBe('HERTZ-SESSION=cookie-secret-value');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.windowType).toBe('subscription');
    expect(result.windows?.[0]?.unit).toBe('dollars');
    expect(result.windows?.[0]?.remaining).toBe(22.91);
    expect(result.windows?.[0]?.description).toBe('MiniMax account balance');
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }));

    const checker = new MiniMaxQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when MiniMax API reports failure in base_resp', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          available_amount: '22.91',
          cash_balance: '22.91',
          voucher_balance: '0.00',
          credit_balance: '0.00',
          owed_amount: '0.00',
          balance_alert_switch: false,
          balance_alert_threshold: '',
          base_resp: {
            status_code: 1001,
            status_msg: 'invalid session',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new MiniMaxQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('MiniMax API error: invalid session');
  });

  it('returns error when available_amount is not numeric', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          available_amount: 'not-a-number',
          cash_balance: '22.91',
          voucher_balance: '0.00',
          credit_balance: '0.00',
          owed_amount: '0.00',
          balance_alert_switch: false,
          balance_alert_threshold: '',
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new MiniMaxQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid available_amount received: not-a-number');
  });
});
