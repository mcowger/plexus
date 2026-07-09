import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  applyXaiOAuthModelTransport,
  assertXaiOAuthEndpoint,
  credentialsFromTokenPayload,
  ensureXaiProviderSupportsResponses,
  expiresAtFromAccessToken,
  getXaiOAuthExtraModel,
  getXaiOAuthExtraModelIds,
  loginXaiOAuth,
  refreshXaiOAuthToken,
  registerXaiOAuthProvider,
  XAI_INFERENCE_BASE_URL,
  XAI_OAUTH_EXTRA_MODELS,
  XAI_OAUTH_MODEL_API,
  xaiOAuthProvider,
} from '../xai-oauth-provider';
import { getOAuthProvider } from '@earendil-works/pi-ai/oauth';
import { piAiModels } from '../../pi-ai/registry';

function jwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('xai oauth provider helpers', () => {
  test('assertXaiOAuthEndpoint accepts auth.x.ai HTTPS URLs', () => {
    expect(assertXaiOAuthEndpoint('https://auth.x.ai/oauth/token', 'token_endpoint')).toBe(
      'https://auth.x.ai/oauth/token'
    );
  });

  test('assertXaiOAuthEndpoint rejects non-x.ai hosts', () => {
    expect(() => assertXaiOAuthEndpoint('https://evil.example/token', 'token_endpoint')).toThrow(
      /not an x\.ai domain/
    );
  });

  test('assertXaiOAuthEndpoint rejects non-HTTPS', () => {
    expect(() => assertXaiOAuthEndpoint('http://auth.x.ai/token', 'token_endpoint')).toThrow(
      /must use HTTPS/
    );
  });

  test('expiresAtFromAccessToken reads JWT exp', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const expires = expiresAtFromAccessToken(jwtWithExp(exp));
    expect(expires).toBe(exp * 1000);
  });

  test('credentialsFromTokenPayload requires refresh_token', () => {
    expect(() => credentialsFromTokenPayload({ access_token: 'access-only' })).toThrow(
      /missing refresh_token/
    );
  });

  test('credentialsFromTokenPayload reuses previous refresh on rotate-only access', () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const creds = credentialsFromTokenPayload(
      { access_token: jwtWithExp(exp), expires_in: 120 },
      'prev-refresh'
    );
    expect(creds.access).toContain('.');
    expect(creds.refresh).toBe('prev-refresh');
    expect(creds.expires).toBe(exp * 1000);
  });
});

describe('xai oauth login/refresh', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('loginXaiOAuth completes device-code flow', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    let tokenPolls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('openid-configuration')) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: 'https://auth.x.ai/oauth/authorize',
            token_endpoint: 'https://auth.x.ai/oauth/token',
          }),
          { status: 200 }
        );
      }
      if (url.includes('/oauth2/device/code')) {
        return new Response(
          JSON.stringify({
            device_code: 'dev-code',
            user_code: 'ABCD-1234',
            verification_uri: 'https://auth.x.ai/device',
            verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-1234',
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        );
      }
      if (url.includes('/oauth/token') && init?.method === 'POST') {
        tokenPolls += 1;
        if (tokenPolls < 2) {
          return new Response(JSON.stringify({ error: 'authorization_pending' }), {
            status: 400,
          });
        }
        return new Response(
          JSON.stringify({
            access_token: jwtWithExp(exp),
            refresh_token: 'refresh-1',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 }
        );
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    const onDeviceCode = vi.fn();
    const onProgress = vi.fn();

    const loginPromise = loginXaiOAuth({ onDeviceCode, onProgress });
    const creds = await loginPromise;

    expect(onDeviceCode).toHaveBeenCalledWith(
      expect.objectContaining({
        userCode: 'ABCD-1234',
        verificationUri: 'https://auth.x.ai/device?user_code=ABCD-1234',
      })
    );
    expect(creds.refresh).toBe('refresh-1');
    expect(creds.access).toBe(jwtWithExp(exp));
    expect(creds.expires).toBe(exp * 1000);
  });

  test('refreshXaiOAuthToken exchanges refresh_token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('openid-configuration')) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: 'https://auth.x.ai/oauth/authorize',
            token_endpoint: 'https://auth.x.ai/oauth/token',
          }),
          { status: 200 }
        );
      }
      if (url.includes('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: jwtWithExp(exp),
            refresh_token: 'refresh-2',
            expires_in: 7200,
          }),
          { status: 200 }
        );
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    const creds = await refreshXaiOAuthToken('refresh-1');
    expect(creds.refresh).toBe('refresh-2');
    expect(creds.access).toBe(jwtWithExp(exp));
  });
});

describe('xai oauth extra models', () => {
  test('includes SuperGrok-only catalog entries', () => {
    const ids = getXaiOAuthExtraModelIds();
    expect(ids).toEqual(
      expect.arrayContaining(['grok-4.5', 'grok-composer-2.5-fast', 'grok-4.20-multi-agent-0309'])
    );

    const flagship = getXaiOAuthExtraModel('grok-4.5');
    expect(flagship?.contextWindow).toBe(500_000);
    expect(flagship?.reasoning).toBe(true);

    const composer = getXaiOAuthExtraModel('grok-composer-2.5-fast');
    expect(composer?.name).toContain('Composer');
    expect(composer?.contextWindow).toBe(200_000);
    expect(composer?.reasoning).toBe(false);

    const multiAgent = getXaiOAuthExtraModel('grok-4.20-multi-agent-0309');
    expect(multiAgent?.contextWindow).toBe(2_000_000);
    expect(multiAgent?.reasoning).toBe(true);

    expect(XAI_OAUTH_EXTRA_MODELS.every((m) => m.provider === 'xai')).toBe(true);
  });
});

describe('xai oauth responses transport', () => {
  test('applyXaiOAuthModelTransport rewrites api to openai-responses', () => {
    const base = {
      id: 'grok-4.3',
      name: 'Grok 4.3',
      api: 'openai-completions' as const,
      provider: 'xai' as const,
      baseUrl: XAI_INFERENCE_BASE_URL,
      reasoning: true,
      input: ['text'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    const rewritten = applyXaiOAuthModelTransport(base as any);
    expect(rewritten.api).toBe(XAI_OAUTH_MODEL_API);
    expect(rewritten.baseUrl).toBe(XAI_INFERENCE_BASE_URL);
    expect(rewritten.id).toBe('grok-4.3');
  });

  test('applyXaiOAuthModelTransport leaves non-xai models unchanged', () => {
    const base = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      api: 'openai-responses' as const,
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      reasoning: false,
      input: ['text'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    expect(applyXaiOAuthModelTransport(base as any)).toBe(base);
  });
});

describe('xai oauth registration', () => {
  test('registerXaiOAuthProvider exposes provider to pi-ai OAuth registry', () => {
    registerXaiOAuthProvider();
    const provider = getOAuthProvider('xai');
    expect(provider?.id).toBe('xai');
    expect(provider?.name).toContain('SuperGrok');
    expect(xaiOAuthProvider.getApiKey({ access: 'tok', refresh: 'r', expires: 1 })).toBe('tok');
    // Under the global pi-ai vitest mock there is no real xAI provider to rebind.
    // Production uses the real builtinModels() registry (see ensureXaiProviderSupportsResponses).
    expect(typeof ensureXaiProviderSupportsResponses).toBe('function');
    expect(piAiModels.getProvider?.('xai')).toBeUndefined();
  });
});
