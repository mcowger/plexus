import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import crypto from 'node:crypto';
import { setConfigForTesting } from '../../../config';
import { hashSecret } from '../../../utils/encryption';
import type {
  McpOauthAuthorizationCodeRecord,
  McpOauthClientRecord,
  McpOauthTokenRecord,
  NewMcpOauthAuthorizationCode,
  NewMcpOauthClient,
  NewMcpOauthToken,
} from '../../../db/mcp-oauth-repository';
import { PlexusIdpProvider } from '../plexus-idp-provider';

function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const TEST_RESOURCE = 'http://localhost/mcp/test-server';
const TEST_ADMIN_KEY = 'admin-test-key';
const ORIGINAL_ADMIN_KEY = process.env.ADMIN_KEY;

function configuredBase() {
  configureOauthKey('sk-oauth-key');
}

function configureKeys(
  entries: Record<string, { secret: string; disabledAt?: number; expiresAt?: number }>
) {
  setConfigForTesting({
    providers: {},
    models: {},
    keys: Object.fromEntries(
      Object.entries(entries).map(([name, config]) => [name, { ...config }])
    ),
    failover: {
      enabled: false,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
    },
    quotas: [],
    mcpOAuth: {
      enabled: true,
      provider: 'plexus-idp',
      issuer: 'http://localhost',
    },
    mcpServers: {
      'test-server': {
        upstream_url: 'http://localhost:3000/mcp',
        enabled: true,
      },
      'other-server': {
        upstream_url: 'http://localhost:3001/mcp',
        enabled: true,
      },
    },
  });
}

function configureOauthKey(secret: string | null, options: { disabledAt?: number } = {}) {
  configureKeys(
    secret
      ? {
          'oauth-key': {
            secret,
            ...(options.disabledAt !== undefined ? { disabledAt: options.disabledAt } : {}),
          },
        }
      : {}
  );
}

class InMemoryMcpOauthRepository {
  clients = new Map<string, McpOauthClientRecord>();
  codes = new Map<string, McpOauthAuthorizationCodeRecord>();
  tokensByAccess = new Map<string, McpOauthTokenRecord>();
  tokensByRefresh = new Map<string, McpOauthTokenRecord>();

  async createClient(input: NewMcpOauthClient): Promise<McpOauthClientRecord> {
    const record: McpOauthClientRecord = {
      clientId: input.clientId,
      clientName: input.clientName ?? null,
      redirectUris: input.redirectUris,
      grantTypes: input.grantTypes ?? [],
      responseTypes: input.responseTypes ?? [],
      scope: input.scope ?? null,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? 'none',
      status: input.status ?? 'active',
      createdAt: Date.now(),
    };
    this.clients.set(record.clientId, record);
    return record;
  }

  async getClient(clientId: string): Promise<McpOauthClientRecord | null> {
    return this.clients.get(clientId) ?? null;
  }

  async findClientByRegistration(input: {
    clientName?: string | null;
    redirectUris: string[];
  }): Promise<McpOauthClientRecord | null> {
    const requested = [...new Set(input.redirectUris)].sort();
    return (
      [...this.clients.values()].find((client) => {
        const existing = [...new Set(client.redirectUris)].sort();
        return (
          client.clientName === (input.clientName ?? null) &&
          existing.length === requested.length &&
          existing.every((value, index) => value === requested[index])
        );
      }) ?? null
    );
  }

  async createAuthorizationCode(
    input: NewMcpOauthAuthorizationCode
  ): Promise<McpOauthAuthorizationCodeRecord> {
    const record: McpOauthAuthorizationCodeRecord = {
      codeHash: `hash:${input.code}`,
      code: input.code,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      resource: input.resource,
      scope: input.scope ?? null,
      keyName: input.keyName,
      apiKeySecretHash: input.apiKeySecretHash,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: Date.now(),
    };
    this.codes.set(record.code, record);
    return record;
  }

  async getAuthorizationCode(code: string): Promise<McpOauthAuthorizationCodeRecord | null> {
    return this.codes.get(code) ?? null;
  }

  async consumeAuthorizationCode(code: string): Promise<boolean> {
    const record = this.codes.get(code);
    if (!record || record.consumedAt !== null) return false;
    record.consumedAt = Date.now();
    return true;
  }

  async createToken(input: NewMcpOauthToken): Promise<McpOauthTokenRecord> {
    const record: McpOauthTokenRecord = {
      accessTokenHash: `hash:${input.accessToken}`,
      accessToken: input.accessToken,
      refreshTokenHash: `hash:${input.refreshToken}`,
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      keyName: input.keyName,
      apiKeySecretHash: input.apiKeySecretHash,
      resource: input.resource,
      scope: input.scope ?? null,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      revokedAt: null,
      createdAt: Date.now(),
    };
    this.tokensByAccess.set(record.accessToken, record);
    this.tokensByRefresh.set(record.refreshToken, record);
    return record;
  }

  async getAccessToken(accessToken: string): Promise<McpOauthTokenRecord | null> {
    return this.tokensByAccess.get(accessToken) ?? null;
  }

  async getRefreshToken(refreshToken: string): Promise<McpOauthTokenRecord | null> {
    return this.tokensByRefresh.get(refreshToken) ?? null;
  }

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    const record = this.tokensByRefresh.get(refreshToken);
    if (!record || record.revokedAt !== null) return false;
    record.revokedAt = Date.now();
    return true;
  }
}

describe('PlexusIdpProvider', () => {
  let fastify: FastifyInstance;
  let provider: PlexusIdpProvider;
  let repo: InMemoryMcpOauthRepository;

  beforeEach(async () => {
    process.env.ADMIN_KEY = TEST_ADMIN_KEY;
    configuredBase();
    fastify = Fastify();
    await fastify.register(formbody);
    repo = new InMemoryMcpOauthRepository();
    provider = new PlexusIdpProvider(repo as any);
    fastify.post('/oauth/register', (request, reply) => provider.handleRegister(request, reply));
    fastify.get('/oauth/authorize', (request, reply) => provider.handleAuthorize(request, reply));
    fastify.post('/oauth/authorize', (request, reply) => provider.handleAuthorize(request, reply));
    fastify.post('/oauth/token', (request, reply) => provider.handleToken(request, reply));
    fastify.get('/mcp/:name', async (request, reply) => {
      const authorization = request.headers.authorization;
      const credential = authorization?.toLowerCase().startsWith('bearer ')
        ? authorization.slice('bearer '.length)
        : authorization;
      const authResult = credential ? await provider.validateToken(credential, request) : null;
      if (!authResult) {
        return reply
          .header('WWW-Authenticate', 'Bearer error="invalid_token"')
          .code(401)
          .send({ error: 'invalid_token' });
      }
      return reply.send(authResult);
    });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    if (ORIGINAL_ADMIN_KEY === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = ORIGINAL_ADMIN_KEY;
  });

  function mcpRequest(name: string): FastifyRequest {
    return {
      headers: { host: 'localhost' },
      protocol: 'http',
      params: { name },
    } as FastifyRequest;
  }

  it('registers a dynamic public client with a random client_id', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Claude MCP',
        redirect_uris: ['http://localhost:49231/callback'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.client_id).toMatch(/^mcp_[a-f0-9]{32}$/);
    expect(body.client_id).not.toBe('plexus-mcp-static');
    expect(body.redirect_uris).toContain('http://localhost:49231/callback');
    expect(body.redirect_uris).toEqual(['http://localhost:49231/callback']);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('rejects client registration with executable or unsafe redirect URIs', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Malicious Client',
        redirect_uris: ['javascript:alert(1)'],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('invalid_client_metadata');
  });

  it('deduplicates identical dynamic client registrations', async () => {
    const payload = {
      client_name: 'Claude MCP',
      redirect_uris: ['http://localhost:49231/callback'],
    };
    const firstResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload,
    });
    const secondResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload,
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(200);
    const first = JSON.parse(firstResponse.body);
    const second = JSON.parse(secondResponse.body);
    expect(second.client_id).toBe(first.client_id);
    expect(repo.clients.size).toBe(1);
  });

  it('requires PKCE and resource on authorize requests', async () => {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);

    const response = await fastify.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent('http://localhost:5555/callback')}`,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('invalid_request');
  });

  it('renders a browser-session consent page without an API-key password field', async () => {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();
    const authorizeUrl = new URL('http://localhost/oauth/authorize');
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://localhost:5555/callback',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      resource: TEST_RESOURCE,
    }).toString();

    const response = await fastify.inject({
      method: 'GET',
      url: `${authorizeUrl.pathname}${authorizeUrl.search}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('plexus_admin_key');
    expect(response.body).toContain('/ui/login?returnTo=');
    expect(response.body).not.toContain('name="api_key"');
    expect(response.body).not.toContain('type="password"');
  });

  it('exchanges an authorization code and refresh token for opaque bearer tokens', async () => {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const authorizeResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-key': TEST_ADMIN_KEY,
      },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        state: 'abc123',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: TEST_RESOURCE,
        key_name: 'oauth-key',
      }).toString(),
    });

    expect(authorizeResponse.statusCode).toBe(302);
    expect(authorizeResponse.headers['cache-control']).toBe('no-store');
    const location = new URL(authorizeResponse.headers.location as string);
    expect(location.searchParams.get('state')).toBe('abc123');
    const code = location.searchParams.get('code');
    expect(code).toMatch(/^poc_/);

    const tokenResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code: code!,
        code_verifier: pkce.verifier,
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(tokenResponse.statusCode).toBe(200);
    const tokenBody = JSON.parse(tokenResponse.body);
    expect(tokenBody.access_token).toMatch(/^pox_/);
    expect(tokenBody.refresh_token).toMatch(/^por_/);
    expect(tokenBody.token_type).toBe('Bearer');
    expect(repo.tokensByAccess.get(tokenBody.access_token)?.apiKeySecretHash).toBe(
      hashSecret('sk-oauth-key')
    );
    await expect(
      provider.validateToken(tokenBody.access_token, mcpRequest('test-server'))
    ).resolves.toEqual({
      keyName: 'oauth-key',
      scopes: ['mcp:read', 'mcp:write'],
    });

    const refreshResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokenBody.refresh_token,
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshBody = JSON.parse(refreshResponse.body);
    expect(refreshBody.access_token).toMatch(/^pox_/);
    expect(repo.tokensByAccess.get(refreshBody.access_token)?.apiKeySecretHash).toBe(
      hashSecret('sk-oauth-key')
    );
  });

  it('does not let refresh requests escalate the original grant scope', async () => {
    const tokenBody = await issueAccessAndRefreshToken({
      clientScope: 'mcp:read mcp:write',
      requestedScope: 'mcp:read',
    });

    const invalidRefreshResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: tokenBody.client_id,
        refresh_token: tokenBody.refresh_token,
        resource: TEST_RESOURCE,
        scope: 'mcp:write',
      }).toString(),
    });

    expect(invalidRefreshResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidRefreshResponse.body).error).toBe('invalid_scope');
    expect(repo.tokensByRefresh.get(tokenBody.refresh_token)?.revokedAt).toBeNull();

    const validRefreshResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: tokenBody.client_id,
        refresh_token: tokenBody.refresh_token,
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(validRefreshResponse.statusCode).toBe(200);
    expect(JSON.parse(validRefreshResponse.body).scope).toBe('mcp:read');
  });

  it('rejects access tokens after their OAuth client is disabled', async () => {
    const tokenBody = await issueAccessAndRefreshToken();
    const client = repo.clients.get(tokenBody.client_id);
    expect(client).toBeDefined();
    client!.status = 'disabled';

    await expect(
      provider.validateToken(tokenBody.access_token, mcpRequest('test-server'))
    ).resolves.toBeNull();
  });

  it('requires an authenticated browser session to submit consent', async () => {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toBe('access_denied');
  });

  it('asks an administrator to choose among multiple active API-key identities', async () => {
    configureKeys({
      'alpha-key': { secret: 'sk-alpha-key' },
      'beta-key': { secret: 'sk-beta-key' },
      'disabled-key': { secret: 'sk-disabled-key', disabledAt: Date.now() },
    });
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-key': TEST_ADMIN_KEY,
      },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('key_selection_required');
    expect(body.principal_role).toBe('admin');
    expect(body.available_keys).toEqual(['alpha-key', 'beta-key']);
    expect(response.body).not.toContain('sk-alpha-key');
    expect(response.body).not.toContain('sk-beta-key');
  });

  it('requires an administrator to choose an identity even with one active API key', async () => {
    configureKeys({ 'only-key': { secret: 'sk-only-key' } });
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-key': TEST_ADMIN_KEY,
      },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost/mcp/test-server',
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'key_selection_required',
      error_description: 'Choose which Plexus API key should authorize this MCP client',
      principal_role: 'admin',
      available_keys: ['only-key'],
    });
  });

  it('binds an administrator approval to the selected API-key identity', async () => {
    configureKeys({
      'alpha-key': { secret: 'sk-alpha-key' },
      'beta-key': { secret: 'sk-beta-key' },
    });
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const response = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-key': TEST_ADMIN_KEY,
      },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: TEST_RESOURCE,
        key_name: 'beta-key',
      }).toString(),
    });

    expect(response.statusCode).toBe(200);
    const redirectTo = JSON.parse(response.body).redirect_to;
    const code = new URL(redirectTo).searchParams.get('code');
    expect(repo.codes.get(code!)?.keyName).toBe('beta-key');
    expect(repo.codes.get(code!)?.apiKeySecretHash).toBe(hashSecret('sk-beta-key'));
  });

  it('limits a non-admin browser session to its own API-key identity', async () => {
    configureKeys({
      'alpha-key': { secret: 'sk-alpha-key' },
      'beta-key': { secret: 'sk-beta-key' },
    });
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const request = (keyName?: string) => {
      const pkce = pkcePair();
      return fastify.inject({
        method: 'POST',
        url: '/oauth/authorize',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-admin-key': 'sk-alpha-key',
        },
        payload: new URLSearchParams({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: 'http://localhost:5555/callback',
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256',
          resource: TEST_RESOURCE,
          ...(keyName ? { key_name: keyName } : {}),
        }).toString(),
      });
    };

    const allowedResponse = await request();
    expect(allowedResponse.statusCode).toBe(302);
    const allowedCode = new URL(allowedResponse.headers.location as string).searchParams.get(
      'code'
    );
    expect(repo.codes.get(allowedCode!)?.keyName).toBe('alpha-key');

    const deniedResponse = await request('beta-key');
    expect(deniedResponse.statusCode).toBe(401);
    expect(JSON.parse(deniedResponse.body).error).toBe('access_denied');
  });

  it('rejects a token when it is presented to a different MCP server', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    const protectedResponse = await fastify.inject({
      method: 'GET',
      url: '/mcp/other-server',
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });

    expect(protectedResponse.statusCode).toBe(401);
  });

  it('rejects an issued access token with invalid_token after the bound API key is rotated', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey('sk-oauth-key-rotated');

    await expect(
      provider.validateToken(tokenBody.access_token, mcpRequest('test-server'))
    ).resolves.toBeNull();
    const protectedResponse = await fastify.inject({
      method: 'GET',
      url: '/mcp/test-server',
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });

    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('rejects an issued access token with invalid_token after the bound API key is deleted', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey(null);

    await expect(
      provider.validateToken(tokenBody.access_token, mcpRequest('test-server'))
    ).resolves.toBeNull();
    const protectedResponse = await fastify.inject({
      method: 'GET',
      url: '/mcp/test-server',
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });

    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('rejects refresh_token grants with invalid_grant after the bound API key is rotated', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey('sk-oauth-key-rotated');

    const refreshResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: tokenBody.client_id,
        refresh_token: tokenBody.refresh_token,
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(refreshResponse.statusCode).toBe(400);
    expect(JSON.parse(refreshResponse.body).error).toBe('invalid_grant');
  });

  it('rejects refresh_token grants when the bound API key is disabled', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey('sk-oauth-key', { disabledAt: Date.now() });

    const refreshResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: tokenBody.client_id,
        refresh_token: tokenBody.refresh_token,
        resource: TEST_RESOURCE,
      }).toString(),
    });

    expect(refreshResponse.statusCode).toBe(400);
    expect(JSON.parse(refreshResponse.body).error).toBe('invalid_grant');
    expect(repo.tokensByRefresh.get(tokenBody.refresh_token)?.revokedAt).toBeNull();
  });

  async function issueAccessAndRefreshToken(
    options: { clientScope?: string; requestedScope?: string } = {}
  ): Promise<{
    client_id: string;
    access_token: string;
    refresh_token: string;
  }> {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        redirect_uris: ['http://localhost:5555/callback'],
        ...(options.clientScope ? { scope: options.clientScope } : {}),
      },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const authorizePayload = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://localhost:5555/callback',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      resource: TEST_RESOURCE,
      key_name: 'oauth-key',
    });
    if (options.requestedScope) {
      authorizePayload.set('scope', options.requestedScope);
    }

    const authorizeResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-admin-key': TEST_ADMIN_KEY,
      },
      payload: authorizePayload.toString(),
    });
    expect(authorizeResponse.statusCode).toBe(302);
    const code = new URL(authorizeResponse.headers.location as string).searchParams.get('code');

    const tokenResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code: code!,
        code_verifier: pkce.verifier,
        resource: TEST_RESOURCE,
      }).toString(),
    });
    expect(tokenResponse.statusCode).toBe(200);
    return { client_id: client.client_id, ...JSON.parse(tokenResponse.body) };
  }
});
