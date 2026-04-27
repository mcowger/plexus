import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../minimax-checker';

const makeCtx = (groupid = '1234567890', hertzSession = 'test_hertz_session_cookie_value') =>
  createMeterContext('minimax-test', 'minimax', { groupid, hertzSession });

describe('minimax checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under minimax', () => {
    expect(isCheckerRegistered('minimax')).toBe(true);
  });

  it('queries balance with GroupId and HERTZ-SESSION cookie', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedCookie =
        new Headers((init as RequestInit | undefined)?.headers).get('Cookie') ?? undefined;
      return new Response(
        JSON.stringify({
          available_amount: '22.91',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const meters = await checkerDef.check(makeCtx('group-abc', 'cookie-secret-value'));

    expect(capturedUrl).toBe('https://platform.minimax.io/account/query_balance?GroupId=group-abc');
    expect(capturedCookie).toBe('HERTZ-SESSION=cookie-secret-value');
    expect(meters).toHaveLength(1);
    expect(meters[0]?.kind).toBe('balance');
    expect(meters[0]?.unit).toBe('usd');
    expect(meters[0]?.remaining).toBe(22.91);
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when MiniMax API reports failure in base_resp', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            available_amount: '22.91',
            base_resp: { status_code: 1001, status_msg: 'invalid session' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('MiniMax API error: invalid session');
  });

  it('throws when available_amount is not numeric', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            available_amount: 'not-a-number',
            base_resp: { status_code: 0, status_msg: 'success' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Invalid available_amount:');
  });
});
