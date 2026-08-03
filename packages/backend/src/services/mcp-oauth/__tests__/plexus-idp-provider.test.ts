import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
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

function configuredBase() {
  configureOauthKey('sk-oauth-key');
}

function configureOauthKey(secret: string | null) {
  setConfigForTesting({
    providers: {},
    models: {},
    keys: secret ? { 'oauth-key': { secret } } : {},
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
      resource: 'http://localhost/mcp',
    },
  });
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

  async consumeAuthorizationCode(code: string): Promise<void> {
    const record = this.codes.get(code);
    if (record) record.consumedAt = Date.now();
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

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const record = this.tokensByRefresh.get(refreshToken);
    if (record) record.revokedAt = Date.now();
  }
}

describe('PlexusIdpProvider', () => {
  let fastify: FastifyInstance;
  let provider: PlexusIdpProvider;
  let repo: InMemoryMcpOauthRepository;

  beforeEach(async () => {
    configuredBase();
    fastify = Fastify();
    await fastify.register(formbody);
    repo = new InMemoryMcpOauthRepository();
    provider = new PlexusIdpProvider(repo as any);
    fastify.post('/register', (request, reply) => provider.handleRegister(request, reply));
    fastify.get('/oauth/authorize', (request, reply) => provider.handleAuthorize(request, reply));
    fastify.post('/oauth/authorize', (request, reply) => provider.handleAuthorize(request, reply));
    fastify.post('/oauth/token', (request, reply) => provider.handleToken(request, reply));
    fastify.get('/protected', async (request, reply) => {
      const authorization = request.headers.authorization;
      const credential = authorization?.toLowerCase().startsWith('bearer ')
        ? authorization.slice('bearer '.length)
        : authorization;
      const authResult = credential ? await provider.validateToken(credential) : null;
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
  });

  it('registers a dynamic public client with a random client_id', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/register',
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
    expect(body.redirect_uris).toContain('https://claude.ai/api/mcp/auth_callback');
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('deduplicates identical dynamic client registrations', async () => {
    const payload = {
      client_name: 'Claude MCP',
      redirect_uris: ['http://localhost:49231/callback'],
    };
    const firstResponse = await fastify.inject({ method: 'POST', url: '/register', payload });
    const secondResponse = await fastify.inject({ method: 'POST', url: '/register', payload });

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
      url: '/register',
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

  it('exchanges an authorization code and refresh token for opaque bearer tokens', async () => {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const authorizeResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        state: 'abc123',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost/mcp',
        api_key: 'sk-oauth-key',
      }).toString(),
    });

    expect(authorizeResponse.statusCode).toBe(302);
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
        resource: 'http://localhost/mcp',
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
    await expect(provider.validateToken(tokenBody.access_token)).resolves.toEqual({
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
        resource: 'http://localhost/mcp',
      }).toString(),
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshBody = JSON.parse(refreshResponse.body);
    expect(refreshBody.access_token).toMatch(/^pox_/);
    expect(repo.tokensByAccess.get(refreshBody.access_token)?.apiKeySecretHash).toBe(
      hashSecret('sk-oauth-key')
    );
  });

  it('rejects an issued access token with invalid_token after the bound API key is rotated', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey('sk-oauth-key-rotated');

    await expect(provider.validateToken(tokenBody.access_token)).resolves.toBeNull();
    const protectedResponse = await fastify.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });

    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('rejects an issued access token with invalid_token after the bound API key is deleted', async () => {
    const tokenBody = await issueAccessAndRefreshToken();

    configureOauthKey(null);

    await expect(provider.validateToken(tokenBody.access_token)).resolves.toBeNull();
    const protectedResponse = await fastify.inject({
      method: 'GET',
      url: '/protected',
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
        resource: 'http://localhost/mcp',
      }).toString(),
    });

    expect(refreshResponse.statusCode).toBe(400);
    expect(JSON.parse(refreshResponse.body).error).toBe('invalid_grant');
  });

  async function issueAccessAndRefreshToken(): Promise<{
    client_id: string;
    access_token: string;
    refresh_token: string;
  }> {
    const clientResponse = await fastify.inject({
      method: 'POST',
      url: '/register',
      payload: { redirect_uris: ['http://localhost:5555/callback'] },
    });
    const client = JSON.parse(clientResponse.body);
    const pkce = pkcePair();

    const authorizeResponse = await fastify.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: 'http://localhost:5555/callback',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: 'http://localhost/mcp',
        api_key: 'sk-oauth-key',
      }).toString(),
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
        resource: 'http://localhost/mcp',
      }).toString(),
    });
    expect(tokenResponse.statusCode).toBe(200);
    return { client_id: client.client_id, ...JSON.parse(tokenResponse.body) };
  }
});
