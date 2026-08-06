import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig, isKeyDisabled } from '../../config';
import { McpOauthRepository } from '../../db/mcp-oauth-repository';
import { hashSecret } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { resolvePrincipal } from '../../routes/management/_principal';
import {
  getMcpResourceUrl,
  getMcpServerNameFromRequest,
  getMcpServerNameFromResource,
  getRequestBaseUrl,
  isAllowedRedirectUri,
  resourceMatchesExpected,
} from './url';
import * as mcpProxyService from '../mcp-proxy/mcp-proxy-service';
import type { AuthProvider, OAuthDiscoveryMetadata, ProtectedResourceMetadata } from './types';

/*
 * OAuth implementation note:
 * We intentionally hand-implement this small opaque-token authorization server
 * instead of using @node-oauth/oauth2-server. Plexus needs RFC 7591 dynamic
 * client registration, browser authorization through the existing Plexus UI
 * credential, and mandatory MCP/RFC 8707 resource validation on both authorize
 * and token requests. Those checks sit awkwardly outside the library's model
 * abstraction; the resulting glue would still custom-issue/store codes and
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

const registerSchema = z.object({
  redirect_uris: z
    .array(
      z
        .string()
        .url()
        .refine(isAllowedRedirectUri, { message: 'Unsupported or unsafe redirect URI scheme' })
    )
    .min(1),
  client_name: z.string().min(1).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
});

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z
    .string()
    .url()
    .refine(isAllowedRedirectUri, { message: 'Unsupported or unsafe redirect URI scheme' }),
  state: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().min(43),
  code_challenge_method: z.literal('S256'),
  resource: z.string().url(),
});

const authorizePostSchema = authorizeSchema.extend({
  // An administrator may choose which configured Plexus API-key identity the
  // grant should represent. Limited users are always bound to their own key;
  // this value is never a secret and is ignored for that case.
  key_name: z.string().min(1).optional(),
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

// Constrain a requested scope set to the subset every supplied allow-list
// permits AND that this server actually supports. The refresh-token path
// supplies both the original grant and the current client registration here;
// intersecting those sets prevents a refresh request from escalating the
// scopes stored on the original token.
function constrainScopes(
  requested: string | null | undefined,
  ...allowed: Array<string | null | undefined>
): string[] {
  const known = new Set(DEFAULT_SCOPES);
  let allowedScopes = new Set(DEFAULT_SCOPES);
  for (const allowList of allowed) {
    if (allowList == null) continue;
    allowedScopes = new Set(
      [...allowedScopes].filter((scope) => splitScopes(allowList).includes(scope))
    );
  }
  return splitScopes(requested).filter((scope) => known.has(scope) && allowedScopes.has(scope));
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

type AuthorizationKeyResolution =
  | { kind: 'authorized'; keyName: string }
  | { kind: 'selection_required'; keyNames: string[]; principalRole: 'admin' }
  | { kind: 'denied'; description: string };

export class PlexusIdpProvider implements AuthProvider {
  constructor(private readonly repo = new McpOauthRepository()) {}

  getDiscoveryMetadata(req: FastifyRequest): OAuthDiscoveryMetadata {
    const issuer = getRequestBaseUrl(req);
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
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
    // Only persist redirect URIs the client supplied. Adding global callback
    // URLs to every client would let any registered client redirect an
    // authorization response through another product's callback endpoint.
    const allowedRedirectUris = [...new Set(redirectUris)];
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
    if (client.status === 'disabled') {
      return oauthError(reply, 400, 'invalid_client', 'OAuth client is disabled');
    }
    if (!client.redirectUris.some((uri) => redirectUriMatches(uri, data.redirect_uri))) {
      return oauthError(
        reply,
        400,
        'invalid_request',
        'redirect_uri is not registered for this client'
      );
    }
    if (!this.resourceMatchesMcpServer(data.resource, req)) {
      return oauthError(
        reply,
        400,
        'invalid_target',
        'resource does not match this Plexus MCP resource'
      );
    }

    // C3: constrain the requested scopes to those the client is allowed to have
    // (from dynamic registration) and that Plexus actually supports. Reject if
    // no permitted scope remains.
    const grantedScopes = constrainScopes(data.scope, client.scope);
    if (grantedScopes.length === 0) {
      return oauthError(
        reply,
        400,
        'invalid_scope',
        'None of the requested scopes are permitted for this client'
      );
    }

    if (req.method === 'GET') {
      return this.renderConsent(req, reply, data);
    }

    const keyResolution = await this.resolveAuthorizationKey(
      req,
      (data as z.infer<typeof authorizePostSchema>).key_name
    );
    if (keyResolution.kind === 'selection_required') {
      return reply.code(400).send({
        error: 'key_selection_required',
        error_description: 'Choose which Plexus API key should authorize this MCP client',
        principal_role: keyResolution.principalRole,
        available_keys: keyResolution.keyNames,
      });
    }
    if (keyResolution.kind === 'denied') {
      return oauthError(reply, 401, 'access_denied', keyResolution.description);
    }

    const code = randomToken(AUTH_CODE_PREFIX);
    const apiKeySecretHash = this.getCurrentApiKeySecretHash(keyResolution.keyName);
    if (!apiKeySecretHash) {
      return oauthError(reply, 401, 'access_denied', 'Invalid Plexus API key');
    }
    await this.repo.createAuthorizationCode({
      code,
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      resource: data.resource,
      scope: grantedScopes.join(' '),
      keyName: keyResolution.keyName,
      apiKeySecretHash,
      codeChallenge: data.code_challenge,
      codeChallengeMethod: data.code_challenge_method,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    // The authorization code is present in either the callback URL or the
    // JSON response. Prevent browsers and intermediaries from caching it.
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    const redirectTo = appendQuery(data.redirect_uri, {
      code,
      state: data.state,
    });
    if (this.wantsJsonResponse(req)) {
      return reply.send({ redirect_to: redirectTo });
    }
    return reply.redirect(redirectTo);
  }

  async handleToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = tokenSchema.safeParse(getBodyOrQuery(req));
    if (!parsed.success) {
      return oauthError(reply, 400, 'invalid_request', 'Invalid token request');
    }
    if (!this.resourceMatchesMcpServer(parsed.data.resource, req)) {
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

  async validateToken(
    token: string,
    req: FastifyRequest
  ): Promise<{ keyName: string; scopes: string[] } | null> {
    if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;

    const record = await this.repo.getAccessToken(token);
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.accessTokenExpiresAt <= Date.now()) return null;
    const client = await this.repo.getClient(record.clientId);
    if (!client || client.status === 'disabled') return null;
    if (!this.isTokenBoundToCurrentApiKeySecret(record.keyName, record.apiKeySecretHash))
      return null;
    // The underlying Plexus API key must still be valid (not expired/disabled/revoked).
    if (!this.isApiKeyCurrentlyValid(record.keyName)) return null;
    // RFC 8707: the token is only valid for the route-specific MCP resource
    // on which it was issued.
    if (!this.resourceMatchesMcpServer(record.resource, req)) return null;

    return { keyName: record.keyName, scopes: splitScopes(record.scope) };
  }

  private async handleAuthorizationCodeGrant(
    data: z.infer<typeof tokenSchema> & { grant_type: 'authorization_code' },
    reply: FastifyReply
  ): Promise<void> {
    const client = await this.repo.getClient(data.client_id);
    if (!client) return oauthError(reply, 400, 'invalid_client', 'Unknown OAuth client');
    if (client.status === 'disabled')
      return oauthError(reply, 400, 'invalid_client', 'OAuth client is disabled');

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
    // The code was bound to the API key secret that was current when it was
    // issued. If the API key has since been rotated, the stored hash no longer
    // matches the current secret and the code must not be exchangeable.
    if (!this.isTokenBoundToCurrentApiKeySecret(code.keyName, code.apiKeySecretHash)) {
      return oauthError(
        reply,
        400,
        'invalid_grant',
        'The underlying Plexus API key has been rotated'
      );
    }
    if (!this.isApiKeyCurrentlyValid(code.keyName)) {
      return oauthError(
        reply,
        400,
        'invalid_grant',
        'The underlying Plexus API key is no longer valid'
      );
    }

    // Consume atomically after all grant validation. A read/check followed by
    // a separate update lets two concurrent exchanges both mint tokens from
    // the same one-time authorization code.
    const consumed = await this.repo.consumeAuthorizationCode(data.code);
    if (!consumed) return oauthError(reply, 400, 'invalid_grant', 'Code already used');
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
    const client = await this.repo.getClient(record.clientId);
    if (!client || client.status === 'disabled') {
      return oauthError(reply, 400, 'invalid_grant', 'OAuth client is disabled');
    }
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
    if (!this.isApiKeyCurrentlyValid(record.keyName)) {
      return oauthError(
        reply,
        400,
        'invalid_grant',
        'Underlying Plexus API key is no longer valid'
      );
    }

    // C3: constrain the refreshed scope set to what the client is allowed to
    // have on both the original grant and the current dynamic registration.
    const grantedScopes = constrainScopes(data.scope ?? record.scope, record.scope, client.scope);
    if (grantedScopes.length === 0) {
      return oauthError(
        reply,
        400,
        'invalid_scope',
        'None of the requested scopes are permitted for this client'
      );
    }
    // Rotate atomically after validating the requested scope. This both avoids
    // consuming a token on invalid_scope and prevents concurrent refreshes
    // from reusing the same refresh token.
    const revoked = await this.repo.revokeRefreshToken(data.refresh_token);
    if (!revoked) return oauthError(reply, 400, 'invalid_grant', 'Refresh token revoked');
    return this.issueToken(reply, {
      clientId: record.clientId,
      keyName: record.keyName,
      resource: record.resource,
      scope: grantedScopes.join(' '),
    });
  }

  private async issueToken(
    reply: FastifyReply,
    input: {
      clientId: string;
      keyName: string;
      resource: string;
      scope: string;
    }
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

    // Tokens must never be cached by intermediaries or browsers.
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');

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

  private isApiKeyCurrentlyValid(keyName: string): boolean {
    const keyConfig = getConfig().keys?.[keyName];
    if (!keyConfig) return false;
    return !isKeyDisabled(keyConfig);
  }

  private resourceMatchesMcpServer(resource: string, req: FastifyRequest): boolean {
    const serverName = getMcpServerNameFromResource(resource, req);
    if (!serverName || !mcpProxyService.getMcpServerConfig(serverName)) return false;

    const requestServerName = getMcpServerNameFromRequest(req);
    if (requestServerName && requestServerName !== serverName) return false;

    return resourceMatchesExpected(resource, getMcpResourceUrl(req, serverName));
  }

  private async renderConsent(
    req: FastifyRequest,
    reply: FastifyReply,
    data: z.infer<typeof authorizeSchema>
  ): Promise<void> {
    const hidden = Object.entries(data)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(String(value))}">`
      )
      .join('\n');
    const loginUrl = `/ui/login?returnTo=${encodeURIComponent(req.url)}`;
    const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Plexus MCP</title>
  <style>
    :root {
      color-scheme: dark;
      --bg-deep: #000000;
      --bg-glass: rgba(15, 23, 42, 0.92);
      --bg-input: rgba(15, 23, 42, 0.6);
      --border: #1E293B;
      --border-glass: rgba(255, 255, 255, 0.08);
      --text: #F8FAFC;
      --text-secondary: #94A3B8;
      --text-muted: #64748B;
      --primary: #F59E0B;
      --secondary: #FBBF24;
      --glow: rgba(245, 158, 11, 0.5);
      --focus-ring: rgba(245, 158, 11, 0.18);
      --font-heading: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
      --font-body: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 20%, rgba(245, 158, 11, 0.10), transparent 30%), var(--bg-deep); color: var(--text); font-family: var(--font-body); line-height: 1.5; padding: 1rem; }
    .mesh { position: fixed; inset: 0; pointer-events: none; opacity: 0.5; }
    main { position: relative; width: 100%; max-width: 28rem; }
    .brand { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 2rem; }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .mark { width: 44px; height: 44px; animation: float 6s ease-in-out infinite; }
    .wordmark { font-family: var(--font-heading); font-size: 1.875rem; font-weight: 700; letter-spacing: -0.025em; background: linear-gradient(135deg, #FBBF24 0%, #F59E0B 60%, #D97706 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .version { font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-muted); font-family: var(--font-mono); }
    .card { border: 1px solid var(--border-glass); background: var(--bg-glass); backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%); border-radius: 1rem; padding: 2rem; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
    h1 { font-family: var(--font-heading); font-size: 1.5rem; line-height: 2rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 0.375rem; }
    p { color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 1rem; }
    .client { margin: 1rem 0; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.45); }
    .client p { margin: 0.25rem 0; font-size: 0.75rem; }
    code { color: #FDE68A; font-family: var(--font-mono); overflow-wrap: anywhere; }
    label { display: block; margin: 1rem 0 0.375rem; color: var(--text-secondary); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
    select { width: 100%; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--bg-input); color: var(--text); padding: 0.75rem 0.875rem; font: 0.875rem var(--font-body); outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
    select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--focus-ring); }
    button { width: 100%; margin-top: 1rem; border: 0; border-radius: 0.375rem; background: linear-gradient(135deg, var(--secondary), var(--primary)); color: #1A1006; font: 500 0.875rem var(--font-body); padding: 0.75rem 1rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 1px 0 rgba(255,255,255,0.2) inset, 0 6px 20px -10px var(--glow); transition: filter 150ms ease, transform 150ms ease, box-shadow 150ms ease; }
    button:hover { filter: brightness(1.05); transform: translateY(-1px); box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 12px 28px -10px rgba(245, 158, 11, 0.65); }
    .note { margin-top: 1.5rem; border-top: 1px solid var(--border-glass); padding-top: 1rem; color: var(--text-muted); font-size: 0.75rem; }
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
      <svg class="mark" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="plx-oauth-mark" x1="0" y1="0" x2="44" y2="44">
            <stop offset="0%" stop-color="#FBBF24"/>
            <stop offset="100%" stop-color="#D97706"/>
          </linearGradient>
        </defs>
        <g stroke="url(#plx-oauth-mark)" stroke-width="1.6" fill="none">
          <line x1="22" y1="6" x2="6" y2="16"/>
          <line x1="22" y1="6" x2="38" y2="16"/>
          <line x1="6" y1="16" x2="22" y2="38"/>
          <line x1="38" y1="16" x2="22" y2="38"/>
          <line x1="6" y1="16" x2="38" y2="16"/>
          <line x1="22" y1="6" x2="22" y2="38"/>
        </g>
        <circle cx="22" cy="6" r="3" fill="url(#plx-oauth-mark)"/>
        <circle cx="6" cy="16" r="3" fill="url(#plx-oauth-mark)"/>
        <circle cx="38" cy="16" r="3" fill="url(#plx-oauth-mark)"/>
        <circle cx="22" cy="38" r="3" fill="url(#plx-oauth-mark)"/>
      </svg>
      <div><span class="wordmark">Plexus</span> <span class="version">MCP OAuth</span></div>
    </div>
    <section class="card">
      <h1>Authorize MCP access</h1>
      <p id="session-message">Use your existing Plexus browser session to authorize this client. Your API-key secret is never entered into or sent through this page.</p>
      <div class="client">
        <p>Client <code>${htmlEscape(data.client_id)}</code></p>
        <p>Resource <code>${htmlEscape(data.resource)}</code></p>
      </div>
      <form method="post" action="/oauth/authorize" onsubmit="return false">
        ${hidden}
        <div id="key-picker" hidden>
          <label for="key_name">Administrator: authorize as Plexus API key</label>
          <select id="key_name" name="key_name"></select>
        </div>
        <p id="error-message" role="alert" hidden></p>
        <a id="login-link" href="${htmlEscape(loginUrl)}" hidden>Sign in to Plexus</a>
        <button id="authorize-button" type="submit">Authorize access</button>
      </form>
      <div class="note">Only authorize clients you trust. This page is served directly by your Plexus instance. The grant is bound to the selected Plexus API-key identity and can be revoked from the Admin UI.</div>
    </section>
    <p class="footer">© 2026 Plexus · Unified LLM Gateway</p>
  </main>
  <script>
    (() => {
      const form = document.querySelector('form');
      const button = document.getElementById('authorize-button');
      const message = document.getElementById('session-message');
      const error = document.getElementById('error-message');
      const loginLink = document.getElementById('login-link');
      const picker = document.getElementById('key-picker');
      const keyName = document.getElementById('key_name');
      if (!form || !button || !message || !error || !loginLink || !picker || !keyName) return;

      const showError = (text, showLogin) => {
        error.textContent = text;
        error.hidden = false;
        loginLink.hidden = !showLogin;
      };

      const getCredential = () => {
        try {
          return window.localStorage.getItem('plexus_admin_key');
        } catch (_) {
          return null;
        }
      };

      const credential = getCredential();
      if (!credential) {
        message.textContent = 'Sign in to Plexus first, then return here to authorize this client.';
        loginLink.hidden = false;
        button.disabled = true;
      } else {
        message.textContent = 'You are signed in to Plexus in this browser. Click Authorize access to continue.';
      }

      form.addEventListener('submit', async () => {
        const currentCredential = getCredential();
        if (!currentCredential) {
          showError('Sign in to Plexus before authorizing this client.', true);
          return;
        }

        button.disabled = true;
        error.hidden = true;
        loginLink.hidden = true;
        message.textContent = 'Authorizing…';
        const body = new URLSearchParams(new FormData(form));
        try {
          const response = await fetch(form.action, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-admin-key': currentCredential,
            },
            body,
          });
          const result = await response.json().catch(() => ({}));

          if (response.ok && result.redirect_to) {
            message.textContent = 'Authorization complete. Returning to your MCP client…';
            window.location.assign(result.redirect_to);
            return;
          }

          if (response.status === 400 && result.error === 'key_selection_required' && result.principal_role === 'admin' && Array.isArray(result.available_keys)) {
            keyName.innerHTML = '';
            result.available_keys.forEach((name) => {
              const option = document.createElement('option');
              option.value = name;
              option.textContent = name;
              keyName.appendChild(option);
            });
            picker.hidden = false;
            message.textContent = 'You are signed in as a Plexus administrator. Choose the API-key identity for this MCP grant.';
            button.disabled = false;
            return;
          }

          if (response.status === 401) {
            try { window.localStorage.removeItem('plexus_admin_key'); } catch (_) {}
            showError('Your Plexus session expired. Sign in again to continue.', true);
          } else {
            showError(result.error_description || 'Plexus could not authorize this client.', false);
          }
          button.disabled = false;
        } catch (_) {
          showError('Unable to contact Plexus. Check your connection and try again.', false);
          button.disabled = false;
        }
      });
    })();
    </script>
</body>
</html>`;

    logger.silly('Rendering MCP OAuth consent screen');
    reply
      .header('Cache-Control', 'no-store')
      .header('Pragma', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(body);
  }

  private wantsJsonResponse(req: FastifyRequest): boolean {
    const accept = req.headers.accept;
    return (
      typeof accept === 'string' &&
      accept.split(',').some((value) => {
        const mediaType = value.trim().split(';', 1)[0]?.toLowerCase();
        return mediaType === 'application/json';
      })
    );
  }

  private async resolveAuthorizationKey(
    req: FastifyRequest,
    requestedKeyName: string | undefined
  ): Promise<AuthorizationKeyResolution> {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      return { kind: 'denied', description: 'Sign in to Plexus before authorizing this client' };
    }

    const keys = getConfig().keys ?? {};
    if (principal.role === 'limited') {
      if (requestedKeyName && requestedKeyName !== principal.keyName) {
        return {
          kind: 'denied',
          description: 'You may only authorize with your own Plexus API key',
        };
      }
      const keyConfig = keys[principal.keyName];
      if (!keyConfig || isKeyDisabled(keyConfig)) {
        return { kind: 'denied', description: 'Your Plexus API key is no longer valid' };
      }
      return { kind: 'authorized', keyName: principal.keyName };
    }

    const activeKeyNames = Object.entries(keys)
      .filter(([, keyConfig]) => !isKeyDisabled(keyConfig))
      .map(([keyName]) => keyName)
      .sort();

    if (activeKeyNames.length === 0) {
      return {
        kind: 'denied',
        description: 'Create an active Plexus API key before authorizing an MCP client',
      };
    }

    if (requestedKeyName) {
      if (!activeKeyNames.includes(requestedKeyName)) {
        return { kind: 'denied', description: 'The selected Plexus API key is not active' };
      }
      return { kind: 'authorized', keyName: requestedKeyName };
    }

    // An admin may authorize on behalf of a configured API-key identity, but
    // that is an explicit delegation decision. Do not silently bind the grant
    // to whichever key happens to be active, even when there is only one.
    return { kind: 'selection_required', principalRole: 'admin', keyNames: activeKeyNames };
  }
}

export { ACCESS_TOKEN_PREFIX as MCP_OAUTH_ACCESS_TOKEN_PREFIX };
