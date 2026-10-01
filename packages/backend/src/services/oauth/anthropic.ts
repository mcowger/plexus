import { z } from 'zod';
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';

/**
 * Anthropic (Claude Pro/Max) OAuth with the copy-code login method.
 *
 * pi-ai's built-in Anthropic login runs a loopback callback server on a fixed
 * local port and falls back to "paste the final redirect URL" when the browser
 * cannot reach it. Claude Code's OAuth client also accepts
 * `https://platform.claude.com/oauth/code/callback` as a redirect_uri: that
 * page renders the authorization code for the user to copy. Pointing the
 * browser there removes the callback server entirely, which is the common case
 * for Plexus (the browser is rarely on the same host as the server), and avoids
 * the fixed-port contention the callback server introduces.
 *
 * Only `login` is replaced here; `refresh`/`toAuth` and provider metadata stay
 * with pi-ai (see `oauth-providers.ts`).
 */

// Public Claude Code OAuth client id (same value pi-ai encodes in its module).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const COPY_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';
const TOKEN_TIMEOUT_MS = 30_000;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const generatePKCE = async (): Promise<{ verifier: string; challenge: string }> => {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
};

/**
 * Accepts the `code#state` shape the Anthropic copy page shows, a full redirect
 * URL, a query string, or a bare code. Mirrors pi-ai's parser.
 */
export const parseAuthorizationInput = (input: string): { code?: string; state?: string } => {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // not a URL
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }
  return { code: value };
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number(),
});

async function exchangeAuthorizationCode(
  code: string,
  state: string,
  verifier: string,
  signal: AbortSignal
): Promise<OAuthCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: COPY_CODE_REDIRECT_URI,
      code_verifier: verifier,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic token exchange failed. status=${response.status}; body=${body}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // Do not include the body: a 2xx response can carry token material, and
    // this message reaches session.error (returned by the management API and
    // shown in the UI).
    throw new Error('Anthropic token exchange returned invalid JSON');
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    // Field names only, for the same reason as above.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Anthropic token exchange response missing fields: ${fields}`);
  }
  const data = parsed.data;
  return {
    type: 'oauth',
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
  };
}

async function loginAnthropicCopyCode(
  interaction: ProviderAuthInteraction
): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE();
  const authParams = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: COPY_CODE_REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Deliberate parity with pi-ai's Anthropic flow: the PKCE verifier doubles
    // as the OAuth `state`. Anthropic echoes it back as `code#state`, and the
    // login validates the pasted state against the same verifier below. A bare
    // pasted code therefore falls back to `verifier` as the state, which the
    // token endpoint accepts. Do not split state from verifier here without
    // also changing that fallback and pi-ai's callback-server state check.
    state: verifier,
  });
  interaction.notify({
    type: 'auth_url',
    url: `${AUTHORIZE_URL}?${authParams.toString()}`,
    instructions:
      'Sign in in your browser. Anthropic shows an authorization code — copy it and paste it below.',
  });

  const input = await interaction.prompt({
    type: 'manual_code',
    message: 'Paste the code Anthropic shows after you sign in:',
    placeholder: 'code#state',
    signal: interaction.signal,
  });
  const parsed = parseAuthorizationInput(input);
  if (parsed.state && parsed.state !== verifier) throw new Error('OAuth state mismatch');
  if (!parsed.code) throw new Error('Missing authorization code');

  interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' });
  return exchangeAuthorizationCode(
    parsed.code,
    parsed.state ?? verifier,
    verifier,
    interaction.signal
  );
}

/** Replace pi-ai's Anthropic login with the copy-code flow, keeping the rest. */
export function withCopyCodeLogin(upstream: OAuthAuth): OAuthAuth {
  return { ...upstream, login: loginAnthropicCopyCode };
}
