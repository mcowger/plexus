import { describe, expect, test, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerMcpRoutes } from '../index';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import * as mcpAuthProviderFactory from '../../../services/mcp-oauth/provider-factory';

const baseConfig = (overrides: Record<string, unknown> = {}) => ({
  providers: {},
  models: {},
  keys: {
    'test-key-1': { secret: 'sk-valid-key', comment: 'Test Key' },
  },
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
  mcpServers: {
    'test-server': {
      upstream_url: 'http://localhost:3000/mcp',
      enabled: true,
      headers: {
        'x-upstream-header': 'value',
      },
    },
    'server-with-auth': {
      upstream_url: 'http://localhost:3001/mcp?auth=token123',
      enabled: true,
      headers: {
        Authorization: 'Bearer upstream-secret',
      },
    },
    'disabled-server': {
      upstream_url: 'http://localhost:3002/mcp',
      enabled: false,
    },
  },
  ...overrides,
});

describe('MCP Routes', () => {
  let fastify: FastifyInstance;
  let mockMcpUsageStorage: McpUsageStorageService;
  let mockProxyMcpRequest: any;

  beforeAll(async () => {
    fastify = Fastify();

    // Mock MCP usage storage
    mockMcpUsageStorage = {
      saveRequest: vi.fn(),
      saveDebugLog: vi.fn(),
    } as unknown as McpUsageStorageService;

    // Mock the proxyMcpRequest function to avoid network calls
    mockProxyMcpRequest = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, result: {} },
    }));

    // Set config with keys and MCP servers
    setConfigForTesting(baseConfig());

    await registerMcpRoutes(fastify, mockMcpUsageStorage);
    await fastify.ready();
  });

  beforeEach(() => {
    registerSpy(mcpProxyService, 'proxyMcpRequest').mockImplementation(mockProxyMcpRequest);
  });

  afterAll(async () => {
    await fastify.close();
  });

  describe('OAuth Discovery Endpoints', () => {
    test('GET /.well-known/oauth-authorization-server should be 404 when MCP OAuth is off', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server',
      });

      expect(response.statusCode).toBe(404);
    });

    test('GET /.well-known/oauth-protected-resource should be 404 when MCP OAuth is off', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/oauth-protected-resource',
      });

      expect(response.statusCode).toBe(404);
    });

    test('GET /.well-known/openid-configuration should be 404 when MCP OAuth is off', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/openid-configuration',
      });

      expect(response.statusCode).toBe(404);
    });

    test('POST /register should be 404 when MCP OAuth is off', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/register',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Authentication', () => {
    test('should reject request without authorization', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test('should reject request with invalid key', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer invalid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test('should allow request with valid Bearer token', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      // Should either proxy successfully or fail with upstream error
      // The test server doesn't exist, so we'll get a connection error
      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });

    test('should allow request with x-api-key header', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          'x-api-key': 'sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      // Should either proxy successfully or fail with upstream error
      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });

    test('should allow request with key attribution', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key:copilot',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });
  });

  describe('Server Validation', () => {
    test('should reject invalid server name', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/InvalidServer',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Invalid server name');
    });

    test('should reject request to disabled server', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/disabled-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('not found or disabled');
    });

    test('should reject request to non-existent server', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/non-existent',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('not found or disabled');
    });
  });

  describe('HTTP Methods', () => {
    test('POST /mcp/:name should proxy POST requests', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      // Check that usage was recorded
      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
    });

    test('GET /mcp/:name should proxy GET requests', async () => {
      // Clear previous mock calls
      (mockProxyMcpRequest as any).mockClear();

      const response = await fastify.inject({
        method: 'GET',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
        },
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
      expect(mockProxyMcpRequest).toHaveBeenCalled();
    });

    test('GET /mcp/:name should forward upstream status for streamed responses', async () => {
      // Regression: a 405 standalone-SSE response from the upstream must not
      // be rewritten to 200, otherwise strict MCP clients try to parse the
      // error body as an SSE stream and the session fails.
      (mockProxyMcpRequest as any).mockClear();
      (mockProxyMcpRequest as any).mockResolvedValueOnce({
        status: 405,
        headers: {},
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Method Not Allowed'));
            controller.close();
          },
        }),
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
        },
      });

      expect(response.statusCode).toBe(405);
    });

    test('DELETE /mcp/:name should proxy DELETE requests', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
        },
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });
  });

  describe('Usage Recording', () => {
    test('should record usage on POST requests', async () => {
      // Reset mock
      (mockMcpUsageStorage.saveRequest as any).mockClear();

      await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key:myapp',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
      });

      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.server_name).toBe('test-server');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.jsonrpc_method).toBe('tools/list');
      expect(callArgs.api_key).toBe('test-key-1');
      expect(callArgs.attribution).toBe('myapp');
    });

    test('should record usage on GET requests', async () => {
      (mockMcpUsageStorage.saveRequest as any).mockClear();
      (mockProxyMcpRequest as any).mockClear();

      const response = await fastify.inject({
        method: 'GET',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
        },
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.method).toBe('GET');
    });

    test('should record usage on DELETE requests', async () => {
      (mockMcpUsageStorage.saveRequest as any).mockClear();

      await fastify.inject({
        method: 'DELETE',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
        },
      });

      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.method).toBe('DELETE');
    });
  });

  describe('MCP OAuth fallback when enabled', () => {
    let oauthFastify: FastifyInstance;
    let validateToken: any;

    beforeEach(async () => {
      oauthFastify = Fastify();
      validateToken = vi.fn(async (token: string) =>
        token === 'pox_valid_oauth_token' ? { keyName: 'test-key-1', scopes: ['mcp:read'] } : null
      );

      setConfigForTesting(
        baseConfig({
          mcpOAuth: {
            enabled: true,
            provider: 'plexus-idp',
          },
        })
      );

      registerSpy(mcpAuthProviderFactory, 'isMcpOAuthEnabled').mockReturnValue(true);
      registerSpy(mcpAuthProviderFactory, 'getMcpAuthProvider').mockReturnValue({
        getDiscoveryMetadata: vi.fn((request) => ({
          issuer: 'http://localhost',
          authorization_endpoint: 'http://localhost/oauth/authorize',
          token_endpoint: 'http://localhost/oauth/token',
          registration_endpoint: 'http://localhost/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['mcp:read', 'mcp:write'],
          resource_supported: true,
        })),
        getProtectedResourceMetadata: vi.fn(() => ({
          resource: 'http://localhost/mcp',
          authorization_servers: ['http://localhost'],
          scopes_supported: ['mcp:read', 'mcp:write'],
          bearer_methods_supported: ['header'],
        })),
        handleAuthorize: vi.fn(async (_request, reply) => reply.send({ ok: true })),
        handleToken: vi.fn(async (_request, reply) => reply.send({ access_token: 'pox-token' })),
        handleRegister: vi.fn(async (_request, reply) =>
          reply.code(201).send({ client_id: 'mcp-test' })
        ),
        validateToken,
      });

      await registerMcpRoutes(oauthFastify, mockMcpUsageStorage);
      await oauthFastify.ready();
    });

    afterEach(async () => {
      await oauthFastify.close();
    });

    test('registers OAuth discovery and DCR routes when enabled', async () => {
      const discovery = await oauthFastify.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server',
      });
      expect(discovery.statusCode).toBe(200);
      expect(JSON.parse(discovery.body).code_challenge_methods_supported).toEqual(['S256']);

      const registration = await oauthFastify.inject({
        method: 'POST',
        url: '/register',
        payload: {},
      });
      expect(registration.statusCode).toBe(201);
      expect(JSON.parse(registration.body).client_id).toBe('mcp-test');
    });

    test('missing auth returns an OAuth discovery challenge', async () => {
      const response = await oauthFastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: { 'content-type': 'application/json' },
        payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toContain(
        '/.well-known/oauth-protected-resource"'
      );
    });

    test('valid raw API key still bypasses OAuth token validation', async () => {
      const response = await oauthFastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(validateToken).not.toHaveBeenCalled();
    });

    test('OAuth access token is accepted after raw API key lookup fails', async () => {
      const response = await oauthFastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer pox_valid_oauth_token',
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(validateToken).toHaveBeenCalledWith('pox_valid_oauth_token');
    });

    test('invalid OAuth token returns invalid_token challenge', async () => {
      const response = await oauthFastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer pox_invalid_oauth_token',
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    });
  });
});
