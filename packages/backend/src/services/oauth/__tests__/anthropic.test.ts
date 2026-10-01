import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthPrompt, OAuthAuth, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { parseAuthorizationInput, withCopyCodeLogin } from '../anthropic';

const neverAbortedSignal = new AbortController().signal;

const upstreamOAuth: OAuthAuth = {
  name: 'Anthropic (Claude Pro/Max)',
  isSubscription: true,
  login: async () => {
    throw new Error('upstream login should not be called');
  },
  refresh: async (credential) => credential,
  toAuth: async (credential) => ({ apiKey: credential.access }),
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Interaction that captures the authorize URL and answers manual_code prompts. */
const makeInteraction = (onPrompt?: (prompt: AuthPrompt) => void) => {
  let authUrl = '';
  const interaction: ProviderAuthInteraction = {
    signal: neverAbortedSignal,
    notify: (event) => {
      if (event.type === 'auth_url') authUrl = event.url;
    },
    prompt: async (prompt) => {
      onPrompt?.(prompt);
      return `copied-code#${new URL(authUrl).searchParams.get('state')}`;
    },
  };
  return { interaction, getAuthUrl: () => authUrl };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Anthropic copy-code login', () => {
  it('uses the copy-code redirect URI and exchanges the pasted code', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://platform.claude.com/v1/oauth/token');
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      const state = new URL(getAuthUrl()).searchParams.get('state');
      expect(body.grant_type).toBe('authorization_code');
      expect(body.redirect_uri).toBe('https://platform.claude.com/oauth/code/callback');
      expect(body.code).toBe('copied-code');
      expect(body.state).toBe(state);
      expect(body.code_verifier).toBe(state);
      return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const prompts: AuthPrompt[] = [];
    const { interaction, getAuthUrl } = makeInteraction((prompt) => prompts.push(prompt));

    const credential = await withCopyCodeLogin(upstreamOAuth).login(interaction);

    const url = new URL(getAuthUrl());
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://platform.claude.com/oauth/code/callback'
    );
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(prompts).toEqual([
      {
        type: 'manual_code',
        message: expect.any(String),
        placeholder: 'code#state',
        signal: neverAbortedSignal,
      },
    ]);
    expect(credential.access).toBe('access');
    expect(credential.refresh).toBe('refresh');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a state that does not match the PKCE verifier', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const interaction: ProviderAuthInteraction = {
      signal: neverAbortedSignal,
      notify: () => {},
      prompt: async () => 'copied-code#unexpected-state',
    };

    await expect(withCopyCodeLogin(upstreamOAuth).login(interaction)).rejects.toThrow(
      'OAuth state mismatch'
    );
  });

  it('rejects when no code is provided', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const interaction: ProviderAuthInteraction = {
      signal: neverAbortedSignal,
      notify: () => {},
      prompt: async () => '',
    };

    await expect(withCopyCodeLogin(upstreamOAuth).login(interaction)).rejects.toThrow(
      'Missing authorization code'
    );
  });

  it('surfaces a token-exchange failure with the response status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400))
    );
    const { interaction } = makeInteraction();

    await expect(withCopyCodeLogin(upstreamOAuth).login(interaction)).rejects.toThrow(/status=400/);
  });

  it('rejects a token response that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>oops</html>', { status: 200 }))
    );
    const { interaction } = makeInteraction();

    await expect(withCopyCodeLogin(upstreamOAuth).login(interaction)).rejects.toThrow(
      /invalid JSON/
    );
  });

  it('rejects a token response missing required fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'only-access' }))
    );
    const { interaction } = makeInteraction();

    await expect(withCopyCodeLogin(upstreamOAuth).login(interaction)).rejects.toThrow(
      /missing fields/
    );
  });

  it('keeps pi-ai refresh/toAuth/metadata and only replaces login', () => {
    const wrapped = withCopyCodeLogin(upstreamOAuth);
    expect(wrapped.refresh).toBe(upstreamOAuth.refresh);
    expect(wrapped.toAuth).toBe(upstreamOAuth.toAuth);
    expect(wrapped.name).toBe(upstreamOAuth.name);
    expect(wrapped.isSubscription).toBe(true);
    expect(wrapped.login).not.toBe(upstreamOAuth.login);
  });
});

describe('parseAuthorizationInput', () => {
  it('parses a full redirect URL', () => {
    expect(
      parseAuthorizationInput('https://platform.claude.com/oauth/code/callback?code=abc&state=xyz')
    ).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('parses the copied code#state form', () => {
    expect(parseAuthorizationInput('abc#xyz')).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('parses a query string and a bare code', () => {
    expect(parseAuthorizationInput('code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseAuthorizationInput('  abc  ')).toEqual({ code: 'abc' });
    expect(parseAuthorizationInput('')).toEqual({});
  });
});
