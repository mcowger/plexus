/**
 * Muse Code subscription quota checker.
 *
 * What must hold:
 *   - the rolling `window` and `weekly` windows map to percentage allowance
 *     meters with reset times (rolling label derived from
 *     `window_duration_mins`);
 *   - the request re-POSTs the key endpoint with the account OAuth token as
 *     Bearer plus `x-api-version` — resolving that token from the stored
 *     `{oauthAccessToken, apiKey}` login credential, or from an explicitly
 *     configured raw token;
 *   - inactive subscriptions, auth failures, and unusable payloads throw
 *     (the scheduler keeps the last good snapshot) instead of publishing
 *     zeroed meters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import { encodeMuseCodeCredential } from '../../oauth/muse-code';
import { createMeterContext } from '../checker-registry';
import checker from '../checkers/muse-code-checker';

const CHECKER_ID = 'muse-quota-test';

const QUOTA_BODY = {
  api_key: 'mk_live_abc',
  user_email: 'user@example.com',
  user_id: 'user-42',
  is_subs_active: true,
  subs_tier_name: 'High Usage',
  subs_usage: {
    window: {
      used_percent: 12,
      resets_at: '2026-09-19T12:00:00.000Z',
      window_duration_mins: 300,
    },
    weekly: { used_percent: 31, resets_at: '2026-09-21T00:00:00.000Z' },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init))
  );
}

async function seedLogin(): Promise<void> {
  const manager = OAuthAuthManager.getInstance();
  // initialize() must settle first: the constructor's async DB load rebuilds
  // authData when it lands and would otherwise wipe an earlier seed.
  await manager.initialize();
  await manager.setCredentials('muse-code', 'default', {
    type: 'oauth',
    access: encodeMuseCodeCredential('dca_tok', 'mk_live_abc'),
    refresh: '',
    expires: Date.now() + 3600_000,
  } as never);
}

describe('muse-code quota checker', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  it('maps rolling + weekly windows to percentage meters', async () => {
    stubFetch(async () => jsonResponse(200, QUOTA_BODY));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'muse-code' });
    await seedLogin();

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(2);
    const rolling = meters.find((m) => m.key === 'rolling')!;
    expect(rolling.label).toBe('Rolling (5 hours)');
    expect(rolling.used).toBe(12);
    expect(rolling.limit).toBe(100);
    expect(rolling.remaining).toBe(88);
    expect(rolling.periodValue).toBe(5);
    expect(rolling.periodUnit).toBe('hour');
    expect(rolling.periodCycle).toBe('rolling');
    expect(rolling.resetsAt).toBe('2026-09-19T12:00:00.000Z');
    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.label).toBe('Weekly');
    expect(weekly.used).toBe(31);
    expect(weekly.periodUnit).toBe('week');
  });

  it('sends the OAuth token as Bearer with the Meta headers', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    stubFetch(async (url, init) => {
      seen.push({ url, init });
      return jsonResponse(200, QUOTA_BODY);
    });
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'muse-code' });
    await seedLogin();

    await checker.check(ctx);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.meta.ai/muse-code/key');
    const headers = seen[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dca_tok');
    expect(headers['x-api-version']).toBe('1.0.0');
  });

  it('uses an explicitly configured raw token without a stored login', async () => {
    stubFetch(async () => jsonResponse(200, QUOTA_BODY));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'raw-dca-token' });

    const meters = await checker.check(ctx);
    expect(meters).toHaveLength(2);
  });

  it('throws a sign-in error on 401/403', async () => {
    stubFetch(async () => jsonResponse(401, { error: 'unauthorized' }));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'stale-token' });
    await expect(checker.check(ctx)).rejects.toThrow(/sign in again/);
  });

  it('fails closed on inactive subscription', async () => {
    stubFetch(async () => jsonResponse(200, { ...QUOTA_BODY, is_subs_active: false }));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });
    await expect(checker.check(ctx)).rejects.toThrow(/inactive/);
  });

  it('throws when quota windows are missing or unusable', async () => {
    const ctx = createMeterContext(CHECKER_ID, 'meta', { apiKey: 'dca_tok' });

    stubFetch(async () => jsonResponse(200, { is_subs_active: true }));
    await expect(checker.check(ctx)).rejects.toThrow(/subs_usage/);

    stubFetch(async () =>
      jsonResponse(200, {
        is_subs_active: true,
        subs_usage: { window: { resets_at: '2026-09-19T12:00:00.000Z' }, weekly: null },
      })
    );
    await expect(checker.check(ctx)).rejects.toThrow(/no usable windows/);
  });

  it('throws a login error with no stored credential', async () => {
    stubFetch(async () => jsonResponse(200, QUOTA_BODY));
    const ctx = createMeterContext(CHECKER_ID, 'meta', { oauthProvider: 'muse-code' });
    await expect(checker.check(ctx)).rejects.toThrow(/no stored login/);
  });
});
