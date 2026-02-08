import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { OpenAICodexQuotaChecker } from '../openai-codex-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';
import { OAuthAuthManager } from '../../../oauth-auth-manager';

const makeConfig = (apiKey?: string): QuotaCheckerConfig => ({
  id: 'codex-test',
  provider: 'openai',
  type: 'openai-codex',
  enabled: true,
  intervalMinutes: 30,
  options: apiKey ? { apiKey } : {},
});

const base64UrlEncode = (value: string): string => {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const makeToken = (payload: unknown): string => {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
};

describe('OpenAICodexQuotaChecker', () => {
  const setFetchMock = (impl: () => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
    OAuthAuthManager.resetForTesting();
  });

  it('is registered under openai-codex', () => {
    expect(QuotaCheckerFactory.isRegistered('openai-codex')).toBe(true);
  });

  it('returns success with warning window and preserves raw response', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          plan_type: 'plus',
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 80,
              reset_at: 1735689600,
            },
          },
          code_review_rate_limit: {
            allowed: true,
            limit_reached: false,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.status).toBe('warning');
    expect(result.windows?.[0]?.windowType).toBe('five_hour');
    expect(result.windows?.[0]?.limit).toBe(100);
    expect(result.windows?.[0]?.used).toBe(80);
    expect(result.windows?.[0]?.remaining).toBe(20);
    expect(result.windows?.[0]?.resetsAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result.rawResponse).toEqual({
      plan_type: 'plus',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 80,
          reset_at: 1735689600,
        },
      },
      code_review_rate_limit: {
        allowed: true,
        limit_reached: false,
      },
    });
  });

  it('accepts apiKey as OAuth JSON blob with access_token', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => new Response(JSON.stringify({ rate_limit: {} }), { status: 200 }));

    const checker = new OpenAICodexQuotaChecker(makeConfig(JSON.stringify({ access_token: token })));
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.status).toBe('ok');
  });

  it('returns exhausted when limit reached', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          rate_limit: {
            allowed: false,
            limit_reached: true,
            primary_window: {
              used_percent: 12,
            },
          },
        }),
        { status: 200 }
      );
    });

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows?.[0]?.used).toBe(100);
    expect(result.windows?.[0]?.remaining).toBe(0);
    expect(result.windows?.[0]?.status).toBe('exhausted');
  });

  it('returns error for invalid OAuth JSON blob', async () => {
    const checker = new OpenAICodexQuotaChecker(makeConfig('{bad-json'));
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('failed to parse OAuth credentials JSON');
  });

  it('continues without account claim when token payload lacks chatgpt_account_id', async () => {
    const token = makeToken({ sub: 'no-claim' });

    setFetchMock(async () => new Response(JSON.stringify({ rate_limit: { allowed: true, limit_reached: false } }), { status: 200 }));

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(1);
  });

  it('returns error for non-200 response', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => new Response('bad request', { status: 401, statusText: 'Unauthorized' }));

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('quota request failed with status 401: bad request');
  });

  it('returns error for malformed response JSON', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => new Response('not-json', { status: 200 }));

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('failed to parse codex usage response');
  });

  it('returns error when usage response is missing rate_limit', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    setFetchMock(async () => new Response(JSON.stringify({ plan_type: 'plus' }), { status: 200 }));

    const checker = new OpenAICodexQuotaChecker(makeConfig(token));
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('codex usage response missing rate_limit');
  });

  it('falls back to OAuthAuthManager when apiKey is not provided', async () => {
    const token = makeToken({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_from_auth_manager',
      },
    });

    const authManager = OAuthAuthManager.getInstance();
    spyOn(authManager, 'getApiKey').mockResolvedValue(token);

    setFetchMock(async () => new Response(JSON.stringify({ rate_limit: { allowed: true, limit_reached: false } }), { status: 200 }));

    const checker = new OpenAICodexQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(authManager.getApiKey).toHaveBeenCalledWith('openai-codex');
  });
});
