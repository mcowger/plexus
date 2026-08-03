import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config';
import { McpOauthRepository } from '../../db/mcp-oauth-repository';
import { hashSecret } from '../../utils/encryption';
import { attachPlexusApiKeyAuth, validatePlexusApiKey } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { getMcpResourceUrl, getRequestBaseUrl, resourceMatchesExpected } from './url';
import type { AuthProvider, OAuthDiscoveryMetadata, ProtectedResourceMetadata } from './types';

/*
 * OAuth implementation note:
 * We intentionally hand-implement this small opaque-token authorization server
 * instead of using @node-oauth/oauth2-server. Plexus needs RFC 7591 dynamic
 * client registration, a browser consent POST where an existing Plexus API key
 * is the credential, and mandatory MCP/RFC 8707 resource validation on both
 * authorize and token requests. Those checks sit awkwardly outside the library's
 * model abstraction; the resulting glue would still custom-issue/store codes and
 * tokens. This implementation keeps the OAuth surface narrow while reusing
 * Plexus primitives for hashing, encryption-at-rest, Zod validation, and Drizzle
 * storage. It does not implement OpenID Connect or JWT/ID tokens.
 */

const DEFAULT_SCOPES = ['mcp:read', 'mcp:write'];
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_PREFIX = 'pox_';
const REFRESH_TOKEN_PREFIX = 'por_';
const AUTH_CODE_PREFIX = 'poc_';

const WELL_KNOWN_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'http://localhost/callback',
  'http://127.0.0.1/callback',
];

const registerSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().min(1).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
});

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().min(43),
  code_challenge_method: z.literal('S256'),
  resource: z.string().url(),
});

const authorizePostSchema = authorizeSchema.extend({
  api_key: z.string().min(1),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().min(1),
    code_verifier: z.string().min(43),
    resource: z.string().url(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    resource: z.string().url(),
    scope: z.string().optional(),
  }),
]);

function randomToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function splitScopes(scope: string | null | undefined): string[] {
  const scopes = (scope || DEFAULT_SCOPES.join(' '))
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : DEFAULT_SCOPES;
}

function toScopeString(scope: string | null | undefined): string {
  return splitScopes(scope).join(' ');
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSingleValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function getBodyOrQuery(req: FastifyRequest): Record<string, unknown> {
  const source = req.method === 'GET' ? req.query : req.body;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).map(([key, value]) => [
      key,
      getSingleValue(value),
    ])
  );
}

function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.pathname === '/callback'
    );
  } catch {
    return false;
  }
}

function redirectUriMatches(registeredUri: string, requestedUri: string): boolean {
  if (registeredUri === requestedUri) return true;
  if (!isLoopbackRedirectUri(registeredUri) || !isLoopbackRedirectUri(requestedUri)) return false;

  const registered = new URL(registeredUri);
  const requested = new URL(requestedUri);
  return registered.hostname === requested.hostname && registered.pathname === requested.pathname;
}

function validatePkce(verifier: string, challenge: string): boolean {
  const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
  return digest === challenge;
}

function oauthError(reply: FastifyReply, statusCode: number, error: string, description: string) {
  return reply.code(statusCode).send({ error, error_description: description });
}

function appendQuery(url: string, params: Record<string, string | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export class PlexusIdpProvider implements AuthProvider {
  constructor(private readonly repo = new McpOauthRepository()) {}

  getDiscoveryMetadata(req: FastifyRequest): OAuthDiscoveryMetadata {
    const issuer = getRequestBaseUrl(req);
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: DEFAULT_SCOPES,
      resource_supported: true,
    };
  }

  getProtectedResourceMetadata(req: FastifyRequest): ProtectedResourceMetadata {
    const issuer = getRequestBaseUrl(req);
    return {
      resource: getMcpResourceUrl(req),
      authorization_servers: [issuer],
      scopes_supported: DEFAULT_SCOPES,
      bearer_methods_supported: ['header'],
    };
  }

  async handleRegister(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return oauthError(
        reply,
        400,
        'invalid_client_metadata',
        'Invalid dynamic client registration request'
      );
    }

    const redirectUris = parsed.data.redirect_uris;
    const allowedRedirectUris = [...new Set([...WELL_KNOWN_REDIRECT_URIS, ...redirectUris])];
    const existingClient = await this.repo.findClientByRegistration({
      clientName: parsed.data.client_name ?? null,
      redirectUris: allowedRedirectUris,
    });
    if (existingClient) {
      return reply.code(200).send({
        client_id: existingClient.clientId,
        client_id_issued_at: Math.floor(existingClient.createdAt / 1000),
        client_name: existingClient.clientName ?? undefined,
        redirect_uris: existingClient.redirectUris,
        grant_types:
          existingClient.grantTypes.length > 0
            ? existingClient.grantTypes
            : ['authorization_code', 'refresh_token'],
        response_types:
          existingClient.responseTypes.length > 0 ? existingClient.responseTypes : ['code'],
        scope: existingClient.scope ?? DEFAULT_SCOPES.join(' '),
        token_endpoint_auth_method: existingClient.tokenEndpointAuthMethod,
      });
    }

    const clientId = `mcp_${crypto.randomBytes(16).toString('hex')}`;
    const client = await this.repo.createClient({
      clientId,
      clientName: parsed.data.client_name ?? null,
      redirectUris: allowedRedirectUris,
      grantTypes: parsed.data.grant_types ?? ['authorization_code', 'refresh_token'],
      responseTypes: parsed.data.response_types ?? ['code'],
      scope: parsed.data.scope ?? DEFAULT_SCOPES.join(' '),
      tokenEndpointAuthMethod: parsed.data.token_endpoint_auth_method ?? 'none',
    });

    return reply.code(201).send({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.clientName ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types:
        client.grantTypes.length > 0 ? client.grantTypes : ['authorization_code', 'refresh_token'],
      response_types: client.responseTypes.length > 0 ? client.responseTypes : ['code'],
      scope: client.scope ?? DEFAULT_SCOPES.join(' '),
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    });
  }

  async handleAuthorize(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const raw = getBodyOrQuery(req);
    const parsed = (req.method === 'POST' ? authorizePostSchema : authorizeSchema).safeParse(raw);
    if (!parsed.success) {
      return oauthError(reply, 400, 'invalid_request', 'Invalid authorization request');
    }

    const data = parsed.data;
    const client = await this.repo.getClient(data.client_id);
    if (!client) {
      return oauthError(reply, 400, 'invalid_client', 'Unknown OAuth client');
    }
    if (!client.redirectUris.some((uri) => redirectUriMatches(uri, data.redirect_uri))) {
      return oauthError(
        reply,
        400,
        'invalid_request',
        'redirect_uri is not registered for this client'
      );
    }
    if (!resourceMatchesExpected(data.resource, getMcpResourceUrl(req))) {
      return oauthError(
        reply,
        400,
        'invalid_target',
        'resource does not match this Plexus MCP resource'
      );
    }

    if (req.method === 'GET') {
      return this.renderConsent(reply, data);
    }

    const authResult = validatePlexusApiKey(
      (data as z.infer<typeof authorizePostSchema>).api_key,
      req
    );
    if (!authResult) {
      return oauthError(reply, 401, 'access_denied', 'Invalid Plexus API key');
    }

    const code = randomToken(AUTH_CODE_PREFIX);
    await this.repo.createAuthorizationCode({
      code,
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      resource: data.resource,
      scope: data.scope ?? DEFAULT_SCOPES.join(' '),
      keyName: authResult.keyName,
      codeChallenge: data.code_challenge,
      codeChallengeMethod: data.code_challenge_method,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirectTo = appendQuery(data.redirect_uri, { code, state: data.state });
    return reply.redirect(redirectTo);
  }

  async handleToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = tokenSchema.safeParse(getBodyOrQuery(req));
    if (!parsed.success) {
      return oauthError(reply, 400, 'invalid_request', 'Invalid token request');
    }
    if (!resourceMatchesExpected(parsed.data.resource, getMcpResourceUrl(req))) {
      return oauthError(
        reply,
        400,
        'invalid_target',
        'resource does not match this Plexus MCP resource'
      );
    }

    if (parsed.data.grant_type === 'authorization_code') {
      return this.handleAuthorizationCodeGrant(parsed.data, reply);
    }

    return this.handleRefreshTokenGrant(parsed.data, reply);
  }

  async validateToken(token: string): Promise<{ keyName: string; scopes: string[] } | null> {
    if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;

    const record = await this.repo.getAccessToken(token);
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.accessTokenExpiresAt <= Date.now()) return null;
    if (!this.isTokenBoundToCurrentApiKeySecret(record.keyName, record.apiKeySecretHash))
      return null;

    return { keyName: record.keyName, scopes: splitScopes(record.scope) };
  }

  private async handleAuthorizationCodeGrant(
    data: z.infer<typeof tokenSchema> & { grant_type: 'authorization_code' },
    reply: FastifyReply
  ): Promise<void> {
    const client = await this.repo.getClient(data.client_id);
    if (!client) return oauthError(reply, 400, 'invalid_client', 'Unknown OAuth client');

    const code = await this.repo.getAuthorizationCode(data.code);
    if (!code) return oauthError(reply, 400, 'invalid_grant', 'Invalid authorization code');
    if (code.consumedAt !== null)
      return oauthError(reply, 400, 'invalid_grant', 'Code already used');
    if (code.expiresAt <= Date.now())
      return oauthError(reply, 400, 'invalid_grant', 'Code expired');
    if (code.clientId !== data.client_id)
      return oauthError(reply, 400, 'invalid_grant', 'Client mismatch');
    if (!redirectUriMatches(code.redirectUri, data.redirect_uri)) {
      return oauthError(reply, 400, 'invalid_grant', 'redirect_uri mismatch');
    }
    if (!resourceMatchesExpected(data.resource, code.resource)) {
      return oauthError(reply, 400, 'invalid_target', 'resource mismatch');
    }
    if (!validatePkce(data.code_verifier, code.codeChallenge)) {
      return oauthError(reply, 400, 'invalid_grant', 'PKCE verification failed');
    }

    await this.repo.consumeAuthorizationCode(data.code);
    return this.issueToken(reply, {
      clientId: data.client_id,
      keyName: code.keyName,
      resource: code.resource,
      scope: code.scope ?? DEFAULT_SCOPES.join(' '),
    });
  }

  private async handleRefreshTokenGrant(
    data: z.infer<typeof tokenSchema> & { grant_type: 'refresh_token' },
    reply: FastifyReply
  ): Promise<void> {
    const record = await this.repo.getRefreshToken(data.refresh_token);
    if (!record) return oauthError(reply, 400, 'invalid_grant', 'Invalid refresh token');
    if (record.revokedAt !== null)
      return oauthError(reply, 400, 'invalid_grant', 'Refresh token revoked');
    if (record.refreshTokenExpiresAt <= Date.now()) {
      return oauthError(reply, 400, 'invalid_grant', 'Refresh token expired');
    }
    if (record.clientId !== data.client_id)
      return oauthError(reply, 400, 'invalid_grant', 'Client mismatch');
    if (!resourceMatchesExpected(data.resource, record.resource)) {
      return oauthError(reply, 400, 'invalid_target', 'resource mismatch');
    }
    if (!this.isTokenBoundToCurrentApiKeySecret(record.keyName, record.apiKeySecretHash)) {
      return oauthError(
        reply,
        400,
        'invalid_grant',
        'Underlying Plexus API key is no longer valid'
      );
    }

    await this.repo.revokeRefreshToken(data.refresh_token);
    return this.issueToken(reply, {
      clientId: record.clientId,
      keyName: record.keyName,
      resource: record.resource,
      scope: data.scope ?? record.scope ?? DEFAULT_SCOPES.join(' '),
    });
  }

  private async issueToken(
    reply: FastifyReply,
    input: { clientId: string; keyName: string; resource: string; scope: string }
  ): Promise<void> {
    const apiKeySecretHash = this.getCurrentApiKeySecretHash(input.keyName);
    if (!apiKeySecretHash) {
      return oauthError(
        reply,
        400,
        'invalid_grant',
        'Underlying Plexus API key is no longer valid'
      );
    }

    const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
    const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
    await this.repo.createToken({
      accessToken,
      refreshToken,
      clientId: input.clientId,
      keyName: input.keyName,
      apiKeySecretHash,
      resource: input.resource,
      scope: input.scope,
      accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
      refreshTokenExpiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    });

    return reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: toScopeString(input.scope),
    });
  }

  private getCurrentApiKeySecretHash(keyName: string): string | null {
    const keyConfig = getConfig().keys?.[keyName];
    if (!keyConfig) return null;
    return hashSecret(keyConfig.secret);
  }

  private isTokenBoundToCurrentApiKeySecret(
    keyName: string,
    apiKeySecretHash: string | null
  ): boolean {
    if (!apiKeySecretHash) return false;
    const currentHash = this.getCurrentApiKeySecretHash(keyName);
    return currentHash !== null && currentHash === apiKeySecretHash;
  }

  private async renderConsent(
    reply: FastifyReply,
    data: z.infer<typeof authorizeSchema>
  ): Promise<void> {
    const hidden = Object.entries(data)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(String(value))}">`
      )
      .join('\n');
    const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Plexus MCP</title>
  <style>
    :root { color-scheme: dark; --bg-deep: #020617; --bg-card: rgba(15, 23, 42, 0.92); --bg-input: rgba(15, 23, 42, 0.72); --border: rgba(148, 163, 184, 0.18); --border-strong: rgba(245, 158, 11, 0.5); --text: #f8fafc; --text-secondary: #cbd5e1; --text-muted: #64748b; --primary: #f59e0b; --secondary: #fbbf24; --danger: #fda4af; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 20%, rgba(245, 158, 11, 0.10), transparent 30%), var(--bg-deep); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; padding: 1rem; }
    .mesh { position: fixed; inset: 0; pointer-events: none; opacity: 0.5; }
    main { position: relative; width: 100%; max-width: 28rem; }
    .brand { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 2rem; }
    .mark { width: 44px; height: 44px; border-radius: 999px; background: linear-gradient(135deg, var(--secondary), var(--primary)); box-shadow: 0 0 34px rgba(245, 158, 11, 0.28); display: grid; place-items: center; }
    .mark svg { width: 26px; height: 26px; color: #0f172a; }
    .wordmark { font-size: 1.875rem; font-weight: 800; letter-spacing: -0.025em; background: linear-gradient(135deg, var(--secondary), var(--primary)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .version { font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .card { border: 1px solid var(--border); background: linear-gradient(180deg, rgba(30,41,59,0.82), var(--bg-card)); border-radius: 1rem; padding: 2rem; box-shadow: 0 24px 80px rgba(0,0,0,0.45); backdrop-filter: blur(18px); }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.375rem; }
    p { color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 1rem; }
    .client { margin: 1rem 0; padding: 0.75rem; border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.06); background: rgba(2, 6, 23, 0.36); }
    .client p { margin: 0.25rem 0; font-size: 0.75rem; }
    code { color: #fde68a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; overflow-wrap: anywhere; }
    label { display: block; margin: 1rem 0 0.375rem; color: var(--text-secondary); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
    input[type=password] { width: 100%; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--bg-input); color: var(--text); padding: 0.75rem 0.875rem; font: 0.875rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
    input[type=password]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18); }
    button { width: 100%; margin-top: 1rem; border: 0; border-radius: 0.5rem; background: linear-gradient(135deg, var(--secondary), var(--primary)); color: #0f172a; font: 700 0.875rem Inter, ui-sans-serif, system-ui, sans-serif; padding: 0.75rem 1rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; }
    .note { margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 1rem; color: var(--text-muted); font-size: 0.75rem; }
    .footer { margin-top: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.75rem; }
  </style>
</head>
<body>
  <svg class="mesh" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g stroke="rgba(245,158,11,0.10)" stroke-width="0.5" fill="none"><path d="M0 200 C 200 100, 600 300, 800 180"/><path d="M0 320 C 220 220, 580 420, 800 300"/><path d="M0 440 C 200 340, 600 540, 800 420"/></g>
    <circle cx="160" cy="200" r="3" fill="#F59E0B" opacity="0.7"/><circle cx="380" cy="260" r="3" fill="#FBBF24" opacity="0.7"/><circle cx="640" cy="220" r="3" fill="#F59E0B" opacity="0.7"/><circle cx="240" cy="380" r="3" fill="#FBBF24" opacity="0.5"/><circle cx="560" cy="420" r="3" fill="#F59E0B" opacity="0.5"/>
  </svg>
  <main>
    <div class="brand">
      <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      <div><span class="wordmark">Plexus</span> <span class="version">MCP OAuth</span></div>
    </div>
    <section class="card">
      <h1>Authorize MCP access</h1>
      <p>Paste an existing Plexus API key to bind this OAuth grant to that key. Plexus will not share the raw key with the client.</p>
      <div class="client">
        <p>Client <code>${htmlEscape(data.client_id)}</code></p>
        <p>Resource <code>${htmlEscape(data.resource)}</code></p>
      </div>
      <form method="post" action="/oauth/authorize">
        ${hidden}
        <label for="api_key">Plexus API key</label>
        <input id="api_key" name="api_key" type="password" autocomplete="off" required autofocus>
        <button type="submit">Authorize access</button>
      </form>
      <div class="note">Only authorize clients you trust. This page is served directly by your Plexus instance.</div>
    </section>
    <p class="footer">© 2026 Plexus · Unified LLM Gateway</p>
  </main>
</body>
</html>`;

    logger.silly('Rendering MCP OAuth consent screen');
    reply.type('text/html; charset=utf-8').send(body);
  }
}

export { ACCESS_TOKEN_PREFIX as MCP_OAUTH_ACCESS_TOKEN_PREFIX };
