import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../../test/test-utils';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../openai-codex-checker';
import { OAuthAuthManager } from '../../../oauth/oauth-auth-manager';

const makeCtx = (apiKey?: string) =>
  createMeterContext('codex-test', 'openai', apiKey ? { apiKey } : {});

const base64UrlEncode = (value: string): string =>
  Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const makeToken = (payload: unknown): string => {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
};

describe('openai-codex checker', () => {
  const setFetchMock = (impl: () => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  it('is registered under openai-codex', () => {
    expect(isCheckerRegistered('openai-codex')).toBe(true);
  });

  it('returns allowance meter with warning status for 80% used', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            plan_type: 'plus',
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 80, reset_at: 1735689600 },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx(token));

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('percentage');
    expect(m.status).toBe('warning');
    expect(m.used).toBe(80);
    expect(m.remaining).toBe(20);
    expect(m.resetsAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('records primary as a 5-hour period and secondary as a weekly period', async () => {
    const token = makeToken({});

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 17 },
              secondary_window: { used_percent: 3 },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx(token));

    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      key: 'primary',
      periodValue: 5,
      periodUnit: 'hour',
      periodCycle: 'rolling',
    });
    expect(meters[1]).toMatchObject({
      key: 'secondary',
      periodValue: 1,
      periodUnit: 'week',
      periodCycle: 'rolling',
    });
  });

  it('accepts apiKey as OAuth JSON blob with access_token', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 10 },
            },
          }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx(JSON.stringify({ access_token: token })));

    expect(meters).toHaveLength(1);
    expect(meters[0]?.status).toBe('ok');
  });

  it('returns exhausted meter when limit_reached is true', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: false,
              limit_reached: true,
              primary_window: { used_percent: 12 },
            },
          }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx(token));

    expect(meters[0]?.used).toBe(100);
    expect(meters[0]?.remaining).toBe(0);
    expect(meters[0]?.status).toBe('exhausted');
  });

  it('throws for invalid OAuth JSON blob', async () => {
    await expect(checkerDef.check(makeCtx('{bad-json'))).rejects.toThrow(
      'failed to parse OAuth credentials JSON'
    );
  });

  it('succeeds when token payload lacks chatgpt_account_id', async () => {
    const token = makeToken({ sub: 'no-claim' });

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 5 },
            },
          }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx(token));

    expect(meters).toHaveLength(1);
  });

  it('throws for non-200 response', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(
      async () => new Response('bad request', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx(token))).rejects.toThrow('status 401');
  });

  it('throws for malformed response JSON', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(async () => new Response('not-json', { status: 200 }));

    await expect(checkerDef.check(makeCtx(token))).rejects.toThrow(
      'failed to parse codex usage response'
    );
  });

  it('throws when usage response is missing rate_limit', async () => {
    const token = makeToken({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

    setFetchMock(async () => new Response(JSON.stringify({ plan_type: 'plus' }), { status: 200 }));

    await expect(checkerDef.check(makeCtx(token))).rejects.toThrow(
      'codex usage response missing rate_limit'
    );
  });

  it('falls back to OAuthAuthManager when apiKey is not provided', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_from_auth_manager' },
    });

    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue(token);

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 20 },
            },
          }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(authManager.getApiKey).toHaveBeenCalledWith(
      'openai-codex',
      undefined,
      expect.objectContaining({
        refreshIfExpiringWithinMs: 10 * 60 * 1000,
      })
    );
  });

  it('reactively force-refreshes and retries when upstream returns 401 with OAuth', async () => {
    const initialToken = makeToken({
      'https://api.openai.com/auth': { chatgpt_account_id: 'old_acct' },
    });
    const refreshedToken = makeToken({
      'https://api.openai.com/auth': { chatgpt_account_id: 'new_acct' },
    });

    const authManager = OAuthAuthManager.getInstance();
    const getApiKeySpy = registerSpy(authManager, 'getApiKey');
    getApiKeySpy.mockResolvedValueOnce(initialToken).mockResolvedValueOnce(refreshedToken);

    let fetchCount = 0;
    setFetchMock(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: { message: 'token_expired' } }), {
          status: 401,
          statusText: 'Unauthorized',
        });
      }
      return new Response(
        JSON.stringify({
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 25 },
          },
        }),
        { status: 200 }
      );
    });

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.used).toBe(25);
    expect(fetchCount).toBe(2);
    expect(getApiKeySpy).toHaveBeenCalledTimes(2);
    expect(getApiKeySpy).toHaveBeenLastCalledWith(
      'openai-codex',
      undefined,
      expect.objectContaining({
        forceRefresh: true,
        signal: expect.anything(),
      })
    );
  });
});
