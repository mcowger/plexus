import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { MCP_LOOPBACK_HOSTNAMES, parseMcpOAuthUrl } from '@plexus/shared';

import {
  mcpUpstreamOAuthRepository as repo,
  type UpstreamOAuthConnection as Connection,
  type UpstreamOAuthGrant as Grant,
} from '../../db/mcp-upstream-oauth-repository';

type Pending = {
  connection: Connection;
  authorizationServerUrl: string;
  resource: string;
  metadata: AuthorizationServerMetadata;
  clientInformation: OAuthClientInformationMixed;
  clientRevision?: string;
  clientProfileId?: string;
  submittedClient?: { clientId: string; clientSecret?: string };
  verifier: string;
  redirectUri: string;
  browser: string;
  expires: number;
  consumed?: boolean;
};
const pending = new Map<string, Pending>();
const refreshes = new Map<string, Promise<string | null>>();
const TTL = 10 * 60_000;
const REFRESH_SKEW_MS = 30_000;
const googleScopes: Record<string, string[]> = {
  'gmailmcp.googleapis.com': ['https://www.googleapis.com/auth/gmail.readonly'],
  'drivemcp.googleapis.com': ['https://www.googleapis.com/auth/drive.readonly'],
  'docsmcp.googleapis.com': ['https://www.googleapis.com/auth/documents.readonly'],
  'sheetsmcp.googleapis.com': ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  'slidesmcp.googleapis.com': ['https://www.googleapis.com/auth/presentations.readonly'],
  'calendarmcp.googleapis.com': ['https://www.googleapis.com/auth/calendar.events.readonly'],
  'chatmcp.googleapis.com': [
    'https://www.googleapis.com/auth/chat.spaces.readonly',
    'https://www.googleapis.com/auth/chat.messages.readonly',
  ],
  'tasksmcp.googleapis.com': ['https://www.googleapis.com/auth/tasks.readonly'],
};
const random = () => randomBytes(32).toString('base64url');

function validUrl(value: string): URL {
  const url = parseMcpOAuthUrl(value);
  if (!url) throw new Error('Invalid OAuth URL');
  return url;
}
function sameIssuer(a: string, b: string): boolean {
  const x = validUrl(a),
    y = validUrl(b);
  return (
    x.origin === y.origin &&
    x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '') &&
    x.search === y.search
  );
}
function reusableClientId(issuer: string): string {
  const url = validUrl(issuer);
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return `plexus-auto-${createHash('sha256').update(url.href).digest('hex').slice(0, 32)}`;
}

export class UpstreamOAuthClientRegistrationRequired extends Error {
  constructor(public readonly provider: 'google' | 'other') {
    super('Authorization server requires a registered OAuth client');
  }
}
export class UpstreamOAuthUserError extends Error {}
export class UpstreamOAuthClientConflict extends Error {
  constructor() {
    super('A different OAuth client is already saved for this issuer');
  }
}
function sameCredentials(
  saved: { clientId: string; clientSecret?: string | null },
  submitted: { clientId: string; clientSecret?: string | null }
): boolean {
  return (
    saved.clientId === submitted.clientId &&
    (saved.clientSecret || undefined) === (submitted.clientSecret || undefined)
  );
}
function privateAddress(address: string): boolean {
  if (address.includes(':')) {
    const a = address.toLowerCase();
    return (
      a === '::1' ||
      a === '::' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      /^fe[89ab]/.test(a) ||
      a.startsWith('::ffff:') ||
      a.startsWith('64:ff9b:') ||
      a.startsWith('2002:') ||
      /^::[0-9a-f]/.test(a)
    );
  }
  const [a = 0, b = 0] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
function requestHref(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
async function safeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = validUrl(requestHref(input));
  if (!MCP_LOOPBACK_HOSTNAMES.includes(url.hostname)) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => privateAddress(address)))
      throw new Error('OAuth network target is not public');
  }
  return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
}
function fetchForUpstream(upstreamUrl: string) {
  const upstreamHost = validUrl(upstreamUrl).hostname;
  const allowLoopback = MCP_LOOPBACK_HOSTNAMES.includes(upstreamHost);
  return (input: string | URL | Request, init?: RequestInit) => {
    const target = validUrl(requestHref(input));
    if (!allowLoopback && MCP_LOOPBACK_HOSTNAMES.includes(target.hostname))
      throw new Error('OAuth loopback target is not allowed');
    return safeFetch(input, init);
  };
}
function validateMetadata(issuer: string, metadata: AuthorizationServerMetadata): void {
  if (!sameIssuer(issuer, metadata.issuer)) throw new Error('OAuth issuer mismatch');
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
  ]) {
    if (endpoint) validUrl(endpoint);
  }
}
function expiry(tokens: OAuthTokens): number | undefined {
  return tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
}
function grantBody(grant: Grant) {
  const { version: _version, revision: _revision, ...body } = grant;
  return body;
}
async function currentGrant(connection: Connection): Promise<Grant | null> {
  const grant = await repo.getGrant(connection.id);
  if (!grant || grant.revision !== connection.revision) return null;
  const profileId = grant.clientProfileId ?? connection.oauth.client;
  if (profileId) {
    const client = await repo.getClient(profileId);
    if (
      !client ||
      client.revision !== grant.clientRevision ||
      !sameIssuer(client.issuer, grant.authorizationServerUrl)
    )
      return null;
  }
  return grant;
}
export async function getUpstreamMcpOAuthStatus(
  name: string
): Promise<{ status: 'disconnected' | 'connected' | 'reconnect_required'; expiresAt?: number }> {
  const connection = await repo.getConnection(name);
  if (!connection) return { status: 'disconnected' };
  const raw = await repo.getGrant(connection.id);
  const grant = await currentGrant(connection);
  if (!grant) return { status: raw ? 'reconnect_required' : 'disconnected' };
  return {
    status:
      grant.reconnectRequired ||
      (grant.expiresAt !== undefined &&
        grant.expiresAt <= Date.now() &&
        !grant.tokens.refresh_token)
        ? 'reconnect_required'
        : 'connected',
    ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
  };
}
export async function beginUpstreamMcpOAuth(
  name: string,
  redirectUri: string,
  credentials?: { clientId: string; clientSecret?: string }
): Promise<{ authorizationUrl: string; browser: string }> {
  const connection = await repo.getConnection(name);
  if (!connection) throw new Error('OAuth connection not found');
  const upstream = validUrl(connection.upstreamUrl);
  const fetchFn = fetchForUpstream(connection.upstreamUrl);
  let resourceMetadata;
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(upstream, {}, fetchFn);
  } catch (error) {
    // Only a missing metadata document permits legacy issuer discovery.
    if (
      !(error instanceof Error) ||
      error.message !== 'Resource server does not implement OAuth 2.0 Protected Resource Metadata.'
    )
      throw error;
    const response = await fetchFn(upstream, {
      headers: { Accept: 'application/json, text/event-stream' },
    });
    const hint = extractWWWAuthenticateParams(response).resourceMetadataUrl;
    await response.body?.cancel();
    if (hint)
      resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        upstream,
        { resourceMetadataUrl: hint },
        fetchFn
      );
  }
  const resource = resourceMetadata?.resource ?? upstream.href;
  const resourceUrl = validUrl(resource);
  if (
    resourceUrl.origin !== upstream.origin ||
    !(
      upstream.pathname === resourceUrl.pathname ||
      upstream.pathname.startsWith(resourceUrl.pathname.replace(/\/$/, '') + '/')
    )
  )
    throw new Error('Protected resource does not match upstream');
  const configured = connection.oauth.client ? await repo.getClient(connection.oauth.client) : null;
  if (connection.oauth.client && !configured)
    throw new UpstreamOAuthUserError('OAuth client not found');
  const issuers = resourceMetadata?.authorization_servers ?? [];
  const issuer = configured
    ? (issuers.find((item) => sameIssuer(item, configured.issuer)) ??
      (issuers.length ? undefined : configured.issuer))
    : (issuers[0] ?? upstream.origin);
  if (!issuer)
    throw new UpstreamOAuthUserError('OAuth client issuer is not advertised by the resource');
  validUrl(issuer);
  const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn });
  if (!metadata) throw new Error('Authorization server metadata unavailable');
  validateMetadata(issuer, metadata);
  const profileId = connection.oauth.client ?? reusableClientId(metadata.issuer);
  const reusable = !connection.oauth.client ? await repo.getClient(profileId) : null;
  if (reusable && !sameIssuer(reusable.issuer, metadata.issuer))
    throw new Error('OAuth client issuer mismatch');
  if (reusable && credentials && !sameCredentials(reusable, credentials))
    throw new UpstreamOAuthClientConflict();
  const selected = configured ?? (!credentials ? reusable : null);
  const google = sameIssuer(issuer, 'https://accounts.google.com');
  const scope = (
    connection.oauth.scopes ??
    (google && upstream.protocol === 'https:' ? googleScopes[upstream.hostname] : undefined)
  )?.join(' ');
  if (google && !scope) throw new UpstreamOAuthUserError('Google OAuth requires explicit scopes');
  let clientInformation: OAuthClientInformationMixed;
  if (credentials && !connection.oauth.client) {
    clientInformation = {
      client_id: credentials.clientId,
      ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
    };
  } else if (selected) {
    clientInformation = {
      client_id: selected.clientId,
      ...(selected.clientSecret ? { client_secret: selected.clientSecret } : {}),
    };
  } else {
    if (!metadata.registration_endpoint)
      throw new UpstreamOAuthClientRegistrationRequired(google ? 'google' : 'other');
    clientInformation = await registerClient(issuer, {
      metadata,
      clientMetadata: {
        redirect_uris: [redirectUri],
        client_name: 'Plexus',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      scope,
      fetchFn,
    });
  }
  const state = random(),
    browser = random();
  const result = await startAuthorization(issuer, {
    metadata,
    clientInformation,
    redirectUrl: redirectUri,
    scope,
    state,
    resource,
  });
  if (google) {
    result.authorizationUrl.searchParams.set('access_type', 'offline');
    result.authorizationUrl.searchParams.set('prompt', 'consent');
  }
  for (const [key, value] of pending)
    if (value.expires <= Date.now() || value.connection.id === connection.id) pending.delete(key);
  pending.set(state, {
    connection,
    authorizationServerUrl: issuer,
    resource,
    metadata,
    clientInformation,
    clientRevision: selected?.revision,
    clientProfileId:
      selected?.id ?? (credentials && !connection.oauth.client ? profileId : undefined),
    submittedClient: !connection.oauth.client ? credentials : undefined,
    verifier: result.codeVerifier,
    redirectUri,
    browser,
    expires: Date.now() + TTL,
  });
  return { authorizationUrl: result.authorizationUrl.href, browser };
}
export async function finishUpstreamMcpOAuth(
  state: string,
  browser: string,
  code: string
): Promise<boolean> {
  const item = pending.get(state);
  if (!item || item.expires <= Date.now() || item.browser !== browser || item.consumed)
    return false;
  item.consumed = true;
  try {
    const tokens = await exchangeAuthorization(item.authorizationServerUrl, {
      metadata: item.metadata,
      clientInformation: item.clientInformation,
      authorizationCode: code,
      codeVerifier: item.verifier,
      redirectUri: item.redirectUri,
      resource: item.resource,
      fetchFn: fetchForUpstream(item.connection.upstreamUrl),
    });
    if (pending.get(state) !== item || item.expires <= Date.now()) return false;
    if (item.submittedClient && item.clientProfileId) {
      const connection = await repo.getConnection(item.connection.name);
      if (!connection || connection.revision !== item.connection.revision) return false;
      const existing = await repo.getClient(item.clientProfileId);
      if (existing && !sameCredentials(existing, item.submittedClient)) return false;
      await repo.saveClient(item.clientProfileId, {
        issuer: item.metadata.issuer,
        ...item.submittedClient,
        clientSecret: item.submittedClient.clientSecret ?? null,
      });
      const savedClient = await repo.getClient(item.clientProfileId);
      if (
        !savedClient ||
        !sameIssuer(savedClient.issuer, item.metadata.issuer) ||
        savedClient.clientId !== item.submittedClient.clientId ||
        savedClient.clientSecret !== (item.submittedClient.clientSecret || undefined)
      )
        return false;
      item.clientRevision = savedClient.revision;
    }
    return await repo.saveGrant(item.connection, {
      authorizationServerUrl: item.authorizationServerUrl,
      resource: item.resource,
      metadata: item.metadata,
      clientInformation: item.clientInformation,
      clientRevision: item.clientRevision,
      clientProfileId: item.clientProfileId,
      tokens,
      expiresAt: expiry(tokens),
    });
  } finally {
    if (pending.get(state) === item) pending.delete(state);
  }
}
export function cancelUpstreamMcpOAuth(state: string, browser: string): void {
  const item = pending.get(state);
  if (item?.browser === browser) pending.delete(state);
}
export async function disconnectUpstreamMcpOAuth(name: string): Promise<void> {
  const connection = await repo.getConnection(name);
  if (connection) await repo.deleteGrant(connection);
}
export async function getUpstreamMcpAccessToken(
  name: string,
  upstreamUrl: string
): Promise<string | null> {
  const connection = await repo.getConnection(name);
  if (!connection || connection.upstreamUrl !== upstreamUrl) return null;
  const grant = await currentGrant(connection);
  if (!grant || grant.reconnectRequired) return null;
  const now = Date.now();
  if (grant.expiresAt === undefined || grant.expiresAt > now + REFRESH_SKEW_MS) {
    return grant.tokens.access_token;
  }
  if (!grant.tokens.refresh_token) {
    return grant.expiresAt > now ? grant.tokens.access_token : null;
  }
  const key = `${connection.id}:${connection.revision}`;
  let flight = refreshes.get(key);
  if (!flight) {
    flight = refreshGrant(connection);
    refreshes.set(key, flight);
    void flight
      .finally(() => {
        if (refreshes.get(key) === flight) refreshes.delete(key);
      })
      .catch(() => {});
  }
  return flight;
}
async function refreshGrant(connection: Connection): Promise<string | null> {
  const grant = await currentGrant(connection);
  if (!grant || grant.reconnectRequired) return null;
  const now = Date.now();
  if (grant.expiresAt === undefined || grant.expiresAt > now + REFRESH_SKEW_MS) {
    return grant.tokens.access_token;
  }
  const refreshToken = grant.tokens.refresh_token;
  if (!refreshToken) return grant.expiresAt > now ? grant.tokens.access_token : null;
  validateMetadata(grant.authorizationServerUrl, grant.metadata);
  try {
    const tokens = await refreshAuthorization(grant.authorizationServerUrl, {
      metadata: grant.metadata,
      clientInformation: grant.clientInformation,
      refreshToken,
      resource: grant.resource,
      fetchFn: fetchForUpstream(connection.upstreamUrl),
    });
    const saved = await repo.saveGrant(
      connection,
      { ...grantBody(grant), tokens, expiresAt: expiry(tokens), reconnectRequired: false },
      grant.version
    );
    return saved ? tokens.access_token : null;
  } catch (error) {
    if (
      error instanceof InvalidGrantError ||
      error instanceof InvalidClientError ||
      error instanceof UnauthorizedClientError
    ) {
      await repo.saveGrant(
        connection,
        { ...grantBody(grant), reconnectRequired: true },
        grant.version
      );
      return null;
    }
    throw error;
  }
}
export async function markUpstreamMcpTokenRejected(name: string, token: string): Promise<void> {
  const connection = await repo.getConnection(name);
  if (!connection || refreshes.has(`${connection.id}:${connection.revision}`)) return;
  const grant = await currentGrant(connection);
  if (!grant || grant.tokens.access_token !== token) return;
  await repo.saveGrant(
    connection,
    { ...grantBody(grant), expiresAt: 0, reconnectRequired: !grant.tokens.refresh_token },
    grant.version
  );
}
