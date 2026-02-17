import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";
import { 
  getMcpServerConfig, 
  validateServerName, 
  filterHopByHopHeaders, 
  filterClientAuthHeaders,
  mergeUpstreamHeaders,
  redactSensitiveHeaders,
  extractJsonRpcMethod,
  proxyMcpRequest
} from "../mcp-proxy-service";
import { setConfigForTesting } from "../../../config";

describe("MCP Proxy Service", () => {
  describe("validateServerName", () => {
    test("should accept valid slug names", () => {
      expect(validateServerName("test")).toBe(true);
      expect(validateServerName("test-server")).toBe(true);
      expect(validateServerName("test_server")).toBe(true); // underscores are allowed
      expect(validateServerName("test123")).toBe(true);
    });

    test("should reject names starting with hyphen", () => {
      expect(validateServerName("-test")).toBe(false);
      expect(validateServerName("_test")).toBe(false); // can't start with underscore (requires [a-z0-9] first)
    });

    test("should reject names that are too short", () => {
      expect(validateServerName("a")).toBe(false); // needs at least 2 chars (1 + 1-62 = 2-63 total)
      expect(validateServerName("")).toBe(false);
    });

    test("should reject names with uppercase letters", () => {
      expect(validateServerName("Test")).toBe(false);
      expect(validateServerName("TEST")).toBe(false);
      expect(validateServerName("Test-Server")).toBe(false);
    });

    test("should reject names with special characters", () => {
      expect(validateServerName("test@server")).toBe(false);
      expect(validateServerName("test.server")).toBe(false);
      expect(validateServerName("test server")).toBe(false);
    });
  });

  describe("filterHopByHopHeaders", () => {
    test("should filter out hop-by-hop headers", () => {
      const headers = {
        "content-type": "application/json",
        "connection": "keep-alive",
        "transfer-encoding": "chunked",
        "upgrade": "http/2",
        "x-custom-header": "value"
      };
      
      const filtered = filterHopByHopHeaders(headers);
      
      expect(filtered["content-type"]).toBe("application/json");
      expect(filtered["x-custom-header"]).toBe("value");
      expect(filtered["connection"]).toBeUndefined();
      expect(filtered["transfer-encoding"]).toBeUndefined();
      expect(filtered["upgrade"]).toBeUndefined();
    });

    test("should handle case-insensitive header names", () => {
      const headers = {
        "Content-Type": "application/json",
        "Connection": "keep-alive"
      };
      
      const filtered = filterHopByHopHeaders(headers);
      
      expect(filtered["Content-Type"]).toBe("application/json");
      expect(filtered["connection"]).toBeUndefined();
    });

    test("should handle array values", () => {
      const headers = {
        "x-array-header": ["value1", "value2"],
        "x-string-header": "singlevalue"
      };
      
      const filtered = filterHopByHopHeaders(headers);
      
      expect(filtered["x-array-header"]).toBe("value1");
      expect(filtered["x-string-header"]).toBe("singlevalue");
    });

    test("should handle undefined and null values", () => {
      const headers = {
        "x-defined": "value",
        "x-undefined": undefined,
        "x-null": null as any
      };
      
      const filtered = filterHopByHopHeaders(headers);
      
      expect(filtered["x-defined"]).toBe("value");
      expect(filtered["x-undefined"]).toBeUndefined();
      expect(filtered["x-null"]).toBeUndefined();
    });
  });

  describe("filterClientAuthHeaders", () => {
    test("should filter out authorization headers", () => {
      const headers = {
        "content-type": "application/json",
        "authorization": "Bearer token123",
        "x-api-key": "secret-key",
        "x-custom-header": "value"
      };
      
      const filtered = filterClientAuthHeaders(headers);
      
      expect(filtered["content-type"]).toBe("application/json");
      expect(filtered["x-custom-header"]).toBe("value");
      expect(filtered["authorization"]).toBeUndefined();
      expect(filtered["x-api-key"]).toBeUndefined();
    });

    test("should handle case-insensitive header names", () => {
      const headers = {
        "Authorization": "Bearer token",
        "X-Api-Key": "secret"
      };
      
      const filtered = filterClientAuthHeaders(headers);
      
      expect(filtered["Authorization"]).toBeUndefined();
      expect(filtered["X-Api-Key"]).toBeUndefined();
    });
  });

  describe("mergeUpstreamHeaders", () => {
    test("should merge client headers with static headers", () => {
      const clientHeaders = {
        "accept": "application/json",
        "x-client-header": "client-value"
      };
      
      const staticHeaders = {
        "x-static-header": "static-value",
        "authorization": "Bearer upstream-token"
      };
      
      const merged = mergeUpstreamHeaders(clientHeaders, staticHeaders);
      
      expect(merged["accept"]).toBe("application/json");
      expect(merged["x-client-header"]).toBe("client-value");
      expect(merged["x-static-header"]).toBe("static-value");
      expect(merged["authorization"]).toBe("Bearer upstream-token");
    });

    test("should prioritize static headers over client headers", () => {
      const clientHeaders = {
        "x-custom": "client"
      };
      
      const staticHeaders = {
        "x-custom": "static"
      };
      
      const merged = mergeUpstreamHeaders(clientHeaders, staticHeaders);
      
      expect(merged["x-custom"]).toBe("static");
    });

    test("should handle undefined static headers", () => {
      const clientHeaders = {
        "x-custom": "value"
      };
      
      const merged = mergeUpstreamHeaders(clientHeaders);
      
      expect(merged["x-custom"]).toBe("value");
    });
  });

  describe("redactSensitiveHeaders", () => {
    test("should redact sensitive headers", () => {
      const headers = {
        "content-type": "application/json",
        "authorization": "Bearer secret",
        "cookie": "session=abc123",
        "x-api-key": "secret-key"
      };
      
      const redacted = redactSensitiveHeaders(headers);
      
      expect(redacted["content-type"]).toBe("application/json");
      expect(redacted["authorization"]).toBe("[REDACTED]");
      expect(redacted["cookie"]).toBe("[REDACTED]");
      expect(redacted["x-api-key"]).toBe("[REDACTED]");
    });
  });

  describe("extractJsonRpcMethod", () => {
    test("should extract method from JSON-RPC body", () => {
      const body = {
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: 1
      };
      
      expect(extractJsonRpcMethod(body)).toBe("tools/list");
    });

    test("should return null for invalid body", () => {
      expect(extractJsonRpcMethod(null)).toBeNull();
      expect(extractJsonRpcMethod(undefined)).toBeNull();
      expect(extractJsonRpcMethod("string")).toBeNull();
      expect(extractJsonRpcMethod({})).toBeNull();
      expect(extractJsonRpcMethod({ jsonrpc: "2.0" })).toBeNull();
    });

    test("should handle nested objects", () => {
      const body = {
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {}
        }
      };
      
      expect(extractJsonRpcMethod(body)).toBe("initialize");
    });
  });

  describe("getMcpServerConfig", () => {
    beforeEach(() => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
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
          "disabled-server": {
            upstream_url: "http://localhost:3001/mcp",
            enabled: false
          }
        }
      });
    });

    test("should return config for enabled server", () => {
      const config = getMcpServerConfig("test-server");
      
      expect(config).not.toBeNull();
      expect(config?.upstream_url).toBe("http://localhost:3000/mcp");
      expect(config?.enabled).toBe(true);
      expect(config?.headers).toEqual({ "x-upstream-header": "value" });
    });

    test("should return null for disabled server", () => {
      const config = getMcpServerConfig("disabled-server");
      
      expect(config).toBeNull();
    });

    test("should return null for non-existent server", () => {
      const config = getMcpServerConfig("non-existent");
      
      expect(config).toBeNull();
    });

    test("should return null when mcpServers is not defined", () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "admin-secret",
        failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
        quotas: []
      });
      
      const config = getMcpServerConfig("test-server");
      
      expect(config).toBeNull();
    });
  });
});
