/**
 * Muse Code subscription OAuth.
 *
 * What must hold:
 *   - device authorization posts form-encoded `client_id` with the Meta
 *     headers and maps the response (https verification URIs only);
 *   - token polling retries `authorization_pending` / `slow_down` and fails
 *     terminally on `access_denied` / `expired_token` / unknown errors;
 *   - the key mint sends the device token as Bearer + `dca_token` body with
 *     `x-api-version`, and fails closed on inactive subscription or payment
 *     required (surfacing the action URL);
 *   - an already-minted key is reused without another key call;
 *   - `toAuth` derives the minted apiKey; `refresh` is a pass-through
 *     (Meta rejects refresh_token grants; fresh quota state is the quota
 *     checker's job).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ProviderAuthInteraction } from '@earendil-works/pi-ai';
import {
  attachMuseCodeApiKey,
  encodeMuseCodeCredential,
  museCodeOAuth,
  parseMuseCodeCredential,
  pollMuseDeviceToken,
  requestMuseCodeKey,
  requestMuseDeviceCode,
} from '../muse-code';

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEVICE_BODY = {
  device_code: 'dev-123',
  user_code: 'ABCD-1234',
  verification_uri: 'https://auth.meta.com/activate',
  verification_uri_complete: 'https://auth.meta.com/activate?code=ABCD-1234',
  interval: 5,
  expires_in: 900,
};

const KEY_BODY = {
  api_key: 'mk_live_abc',
  user_email: 'User@Example.com',
  user_id: 'user-42',
  is_subs_active: true,
  subs_tier_id: 'high',
  subs_tier_name: 'High Usage',
  subs_usage: {
    window: { used_percent: 12, resets_at: '2026-09-19T12:00:00Z', window_duration_mins: 300 },
    weekly: { used_percent: 31, resets_at: '2026-09-21T00:00:00Z' },
  },
};

function fakeInteraction(): ProviderAuthInteraction & { notified: unknown[] } {
  const notified: unknown[] = [];
  return {
    signal: new AbortController().signal,
    notify: (event) => {
      notified.push(event);
    },
    prompt: () => Promise.reject(new Error('unexpected prompt')),
    notified,
  };
}

describe('parse/encode Muse credential', () => {
  it('round-trips the oauth token and minted key', () => {
    const encoded = encodeMuseCodeCredential('oauth-tok', 'mk_live');
    expect(parseMuseCodeCredential(encoded)).toEqual({
      oauthAccessToken: 'oauth-tok',
      apiKey: 'mk_live',
    });
  });

  it('rejects malformed credentials', () => {
    expect(() => parseMuseCodeCredential('not-json')).toThrow(/sign in again/);
    expect(() => parseMuseCodeCredential(JSON.stringify({}))).toThrow(/sign in again/);
    expect(() =>
      parseMuseCodeCredential(JSON.stringify({ oauthAccessToken: 'a', apiKey: '  ' }))
    ).toThrow(/sign in again/);
  });
});

describe('requestMuseDeviceCode', () => {
  it('posts form-encoded client_id and maps the response', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchMock = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, DEVICE_BODY);
    };
    const device = await requestMuseDeviceCode({ fetchImpl });
    expect(calls).toHaveLength(1);
    const first = calls[0]!;
    expect(first.url).toContain('/oidc/device/authorization/');
    const headers = first.init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['x-api-version']).toBe('1.0.0');
    const body = new URLSearchParams(String(first.init.body));
    expect(body.get('client_id')).toBe('1031625952748946');
    expect(device).toMatchObject({
      deviceCode: 'dev-123',
      userCode: 'ABCD-1234',
      intervalMs: 5000,
      expiresInMs: 900000,
    });
  });

  it('rejects non-https verification URIs', async () => {
    const fetchImpl: FetchMock = async () =>
      jsonResponse(200, { ...DEVICE_BODY, verification_uri: 'http://evil.example/x' });
    await expect(requestMuseDeviceCode({ fetchImpl })).rejects.toThrow(/Untrusted/);
  });

  it('throws on non-2xx', async () => {
    const fetchImpl: FetchMock = async () => jsonResponse(400, { error: 'invalid_client' });
    await expect(requestMuseDeviceCode({ fetchImpl })).rejects.toThrow(/HTTP 400/);
  });
});

describe('pollMuseDeviceToken', () => {
  it('retries authorization_pending then returns the token', async () => {
    let polls = 0;
    const fetchImpl: FetchMock = async () => {
      polls += 1;
      if (polls === 1) return jsonResponse(400, { error: 'authorization_pending' });
      return jsonResponse(200, { access_token: 'dca_tok', expires_in: 3600 });
    };
    const token = await pollMuseDeviceToken('dev-123', {
      fetchImpl,
      intervalMs: 1,
      expiresInMs: 30_000,
    });
    expect(token).toEqual({ accessToken: 'dca_tok', expiresInSeconds: 3600 });
    expect(polls).toBe(2);
  });

  it('fails terminally on access_denied and expired_token', async () => {
    const denied: FetchMock = async () => jsonResponse(400, { error: 'access_denied' });
    await expect(
      pollMuseDeviceToken('dev-123', { fetchImpl: denied, intervalMs: 1 })
    ).rejects.toThrow(/denied/);

    const expired: FetchMock = async () => jsonResponse(400, { error: 'expired_token' });
    await expect(
      pollMuseDeviceToken('dev-123', { fetchImpl: expired, intervalMs: 1 })
    ).rejects.toThrow(/expired/);
  });
});

describe('requestMuseCodeKey', () => {
  it('sends Bearer + dca_token with the Meta headers', async () => {
    const calls: { init: RequestInit }[] = [];
    const fetchImpl: FetchMock = async (_url, init = {}) => {
      calls.push({ init });
      return jsonResponse(200, KEY_BODY);
    };
    const payload = await requestMuseCodeKey('dca_tok', { fetchImpl, onboard: true });
    expect(payload.api_key).toBe('mk_live_abc');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dca_tok');
    expect(headers['x-api-version']).toBe('1.0.0');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ onboard: true, dca_token: 'dca_tok' });
  });

  it('throws on non-2xx', async () => {
    const fetchImpl: FetchMock = async () => jsonResponse(403, { error: 'forbidden' });
    await expect(requestMuseCodeKey('dca_tok', { fetchImpl })).rejects.toThrow(/HTTP 403/);
  });
});

describe('attachMuseCodeApiKey', () => {
  it('mints once and derives identity from user_id', async () => {
    const fetchImpl: FetchMock = async () => jsonResponse(200, KEY_BODY);
    const result = await attachMuseCodeApiKey('dca_tok', { fetchImpl, onboard: true });
    expect(result.accountId).toBe('user-42');
    expect(result.email).toBe('user@example.com');
    expect(parseMuseCodeCredential(result.credentialAccess)).toEqual({
      oauthAccessToken: 'dca_tok',
      apiKey: 'mk_live_abc',
    });
  });

  it('falls back to email identity when user_id is absent', async () => {
    const fetchImpl: FetchMock = async () => jsonResponse(200, { ...KEY_BODY, user_id: undefined });
    const result = await attachMuseCodeApiKey('dca_tok', { fetchImpl });
    expect(result.accountId).toBe('user@example.com');
  });

  it('reuses an already-minted key without another key call', async () => {
    const fetchImpl: FetchMock = async () => {
      throw new Error('must not fetch');
    };
    const existingAccess = encodeMuseCodeCredential('dca_tok', 'mk_cached');
    const result = await attachMuseCodeApiKey('dca_tok', { fetchImpl, existingAccess });
    expect(result.credentialAccess).toBe(existingAccess);
  });

  it('fails closed on inactive subscription', async () => {
    const fetchImpl: FetchMock = async () =>
      jsonResponse(200, { ...KEY_BODY, is_subs_active: false });
    await expect(attachMuseCodeApiKey('dca_tok', { fetchImpl })).rejects.toThrow(/inactive/);
  });

  it('fails closed with the payment action URL when payment is required', async () => {
    const fetchImpl: FetchMock = async () =>
      jsonResponse(200, {
        ...KEY_BODY,
        api_key: undefined,
        require_payment: true,
        action_url: 'https://example.com/pay',
      });
    await expect(attachMuseCodeApiKey('dca_tok', { fetchImpl })).rejects.toThrow(
      /https:\/\/example\.com\/pay/
    );
  });

  it('fails when api_key and identity are missing', async () => {
    const noKey: FetchMock = async () => jsonResponse(200, { is_subs_active: true });
    await expect(attachMuseCodeApiKey('dca_tok', { fetchImpl: noKey })).rejects.toThrow(
      /missing api_key/
    );

    const noIdentity: FetchMock = async () =>
      jsonResponse(200, { api_key: 'mk_x', is_subs_active: true });
    await expect(attachMuseCodeApiKey('dca_tok', { fetchImpl: noIdentity })).rejects.toThrow(
      /account identity/
    );
  });
});

describe('museCodeOAuth', () => {
  it('runs device flow then mints, emitting a device_code notification', async () => {
    let polls = 0;
    const realFetch = globalThis.fetch;
    const stub = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const target = String(url);
      // interval: 1 keeps the test fast; production waits the real interval.
      if (target.includes('/oidc/device/authorization/'))
        return jsonResponse(200, { ...DEVICE_BODY, interval: 1 });
      if (target.includes('/oidc/device/token/')) {
        polls += 1;
        if (polls === 1) return jsonResponse(400, { error: 'authorization_pending' });
        return jsonResponse(200, { access_token: 'dca_tok' });
      }
      return jsonResponse(200, KEY_BODY);
    });
    vi.stubGlobal('fetch', stub);
    try {
      const interaction = fakeInteraction();
      const credentials = await museCodeOAuth.login(interaction);
      expect(credentials.type).toBe('oauth');
      expect(parseMuseCodeCredential(credentials.access)).toEqual({
        oauthAccessToken: 'dca_tok',
        apiKey: 'mk_live_abc',
      });
      expect(Number.isFinite(credentials.expires)).toBe(true);
      expect(interaction.notified).toHaveLength(1);
      expect(interaction.notified[0]).toMatchObject({
        type: 'device_code',
        userCode: 'ABCD-1234',
      });
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
  });

  it('is marked as a subscription flow with a login label', () => {
    expect(museCodeOAuth.isSubscription).toBe(true);
    expect(museCodeOAuth.name).toContain('Muse');
    expect(museCodeOAuth.loginLabel).toContain('Meta');
  });

  it('toAuth derives the minted apiKey', async () => {
    const auth = await museCodeOAuth.toAuth({
      type: 'oauth',
      access: encodeMuseCodeCredential('dca_tok', 'mk_live_abc'),
      refresh: '',
      expires: Date.now() + 1000,
    });
    expect(auth).toEqual({ apiKey: 'mk_live_abc' });
  });

  it('refresh passes the credential through (Meta rejects refresh grants)', async () => {
    const credential = {
      type: 'oauth' as const,
      access: encodeMuseCodeCredential('dca_tok', 'mk_live_abc'),
      refresh: '',
      expires: Date.now() + 1000,
    };
    await expect(museCodeOAuth.refresh(credential, new AbortController().signal)).resolves.toEqual(
      credential
    );
  });
});
