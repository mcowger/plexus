import { describe, expect, test, mock, beforeAll } from "bun:test";
import Fastify, { FastifyInstance } from "fastify";
import { setConfigForTesting } from "../../../config";
import { registerMcpRoutes } from "../index";
import { McpUsageStorageService } from "../../../services/mcp-proxy/mcp-usage-storage";

describe("MCP Routes", () => {
  let fastify: FastifyInstance;
  let mockMcpUsageStorage: McpUsageStorageService;

  beforeAll(async () => {
    fastify = Fastify();

    // Mock MCP usage storage
    mockMcpUsageStorage = {
      saveRequest: mock(),
      saveDebugLog: mock()
    } as unknown as McpUsageStorageService;

    // Set config with keys and MCP servers
    setConfigForTesting({
      providers: {},
      models: {},
      keys: {
        "test-key-1": { secret: "sk-valid-key", comment: "Test Key" }
      },
      adminKey: "admin-secret",
      failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
      quotas: [],
      mcpServers: {
        "test-server": {
          upstream_url: "http://localhost:3000/mcp",
          enabled: true,
          headers: {
            "x-upstream-header": "value"
          }
        },
        "server-with-auth": {
          upstream_url: "http://localhost:3001/mcp?auth=token123",
          enabled: true,
          headers: {
            "Authorization": "Bearer upstream-secret"
          }
        },
        "disabled-server": {
          upstream_url: "http://localhost:3002/mcp",
          enabled: false
        }
      }
    });

    await registerMcpRoutes(fastify, mockMcpUsageStorage);
    await fastify.ready();
  });

  describe("OAuth Discovery Endpoints", () => {
    test("GET /.well-known/oauth-authorization-server should return OAuth metadata", async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.issuer).toBe('/');
      expect(body.authorization_endpoint).toBe('/oauth/authorize');
      expect(body.token_endpoint).toBe('/oauth/token');
      expect(body.grant_types_supported).toContain('bearer');
    });

    test("GET /.well-known/oauth-protected-resource should return protected resource metadata", async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/oauth-protected-resource'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.resource).toBe('/');
      expect(body.scopes_supported).toContain('read');
    });

    test("GET /.well-known/openid-configuration should return OIDC config", async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/.well-known/openid-configuration'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.issuer).toBe('/');
      expect(body.jwks_uri).toBe('/.well-known/jwks.json');
    });

    test("POST /register should return static client registration", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/register'
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.client_id).toBe('plexus-mcp-static');
      expect(body.grant_types).toContain('bearer');
    });
  });

  describe("Authentication", () => {
    test("should reject request without authorization", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(response.statusCode).toBe(401);
    });

    test("should reject request with invalid key", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer invalid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(response.statusCode).toBe(401);
    });

    test("should allow request with valid Bearer token", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      // Should either proxy successfully or fail with upstream error
      // The test server doesn't exist, so we'll get a connection error
      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });

    test("should allow request with x-api-key header", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          'x-api-key': 'sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      // Should either proxy successfully or fail with upstream error
      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });

    test("should allow request with key attribution", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key:copilot',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });
  });

  describe("Server Validation", () => {
    test("should reject invalid server name", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/InvalidServer',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Invalid server name');
    });

    test("should reject request to disabled server", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/disabled-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('not found or disabled');
    });

    test("should reject request to non-existent server", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/non-existent',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('not found or disabled');
    });
  });

  describe("HTTP Methods", () => {
    test("POST /mcp/:name should proxy POST requests", async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      // Check that usage was recorded
      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
    });

    test("GET /mcp/:name should proxy GET requests", async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key'
        }
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });

    test("DELETE /mcp/:name should proxy DELETE requests", async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key'
        }
      });

      expect([200, 400, 404, 500, 502, 504]).toContain(response.statusCode);
    });
  });

  describe("Usage Recording", () => {
    test("should record usage on POST requests", async () => {
      // Reset mock
      (mockMcpUsageStorage.saveRequest as any).mockClear();

      await fastify.inject({
        method: 'POST',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key:myapp',
          'content-type': 'application/json'
        },
        payload: {
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        }
      });

      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.server_name).toBe('test-server');
      expect(callArgs.method).toBe('POST');
      expect(callArgs.jsonrpc_method).toBe('tools/list');
      expect(callArgs.api_key).toBe('test-key-1');
      expect(callArgs.attribution).toBe('myapp');
    });

    test("should record usage on GET requests", async () => {
      (mockMcpUsageStorage.saveRequest as any).mockClear();

      await fastify.inject({
        method: 'GET',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key'
        }
      });

      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.method).toBe('GET');
    });

    test("should record usage on DELETE requests", async () => {
      (mockMcpUsageStorage.saveRequest as any).mockClear();

      await fastify.inject({
        method: 'DELETE',
        url: '/mcp/test-server',
        headers: {
          authorization: 'Bearer sk-valid-key'
        }
      });

      expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
      const callArgs = (mockMcpUsageStorage.saveRequest as any).mock.calls[0][0];
      expect(callArgs.method).toBe('DELETE');
    });
  });
});
