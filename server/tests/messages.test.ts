import { test, expect, describe, mock } from "bun:test";
import { handleMessages } from "../routes/messages";
import type { PlexusConfig } from "../types/config";
import { CooldownManager } from "../services/cooldown-manager";
import { HealthMonitor } from "../services/health-monitor";
import type { ServerContext } from "../types/server";

const mockConfig: PlexusConfig = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "info", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false, streamTimeoutSeconds: 300 }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "anthropic",
      enabled: true,
      baseUrls: {
        messages: { url: "https://api.anthropic.com/v1/messages", enabled: true },
      },
      auth: {
        type: "x-api-key",
        apiKey: "{env:ANTHROPIC_API_KEY}",
      },
      models: ["claude-3-opus", "claude-3-sonnet"],
      customHeaders: {
        "anthropic-version": "2023-06-01",
      },
    },
  ],
  models: [
    {
      alias: "sonnet",
      targets: [{ provider: "anthropic", model: "claude-3-sonnet" }],
      selector: "random",
    },
  ],
  apiKeys: [{ name: "default", secret: "test-key", enabled: true }],
  pricing: { models: {} },
  resilience: {
    cooldown: {
      defaults: {
        rate_limit: 60,
        auth_error: 3600,
        timeout: 30,
        server_error: 120,
        connection_error: 60,
      },
      maxDuration: 3600,
      minDuration: 5,
      storagePath: "./data/cooldowns.json",
    },
    health: {
      degradedThreshold: 0.5,
      unhealthyThreshold: 0.9,
    },
  },
};

const mockConfigManager: any = {
  getCurrentConfig: () => mockConfig,
};

const cooldownManager = new CooldownManager(mockConfigManager);
const healthMonitor = new HealthMonitor(mockConfigManager, cooldownManager);
const mockContext: ServerContext = {
  config: mockConfig,
  cooldownManager,
  healthMonitor,
  debugLogger: {
    enabled: false,
    startTrace: () => {},
    captureProviderRequest: () => {},
    captureProviderResponse: () => {},
    captureClientResponse: () => {},
    captureProviderStreamChunk: () => {},
    captureClientStreamChunk: () => {},
    completeTrace: async () => {},
    cleanup: async () => {},
    initialize: async () => {},
  } as any,
};

describe("POST /v1/messages", () => {
  describe("Authentication", () => {
    test("rejects request without authentication", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-opus",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(401);

      const body = await response.json() as any;
      expect(body.type).toBe("error");
      expect(body.error.type).toBe("authentication_error");
    });

    test("accepts x-api-key header authentication", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "unknown-model",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      // Should fail with model not found, not auth error
      expect(response.status).toBe(404);
    });

    test("accepts Bearer token authentication", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key",
        },
        body: JSON.stringify({
          model: "unknown-model",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      // Should fail with model not found, not auth error
      expect(response.status).toBe(404);
    });

    test("rejects invalid API key", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "invalid-key",
        },
        body: JSON.stringify({
          model: "claude-3-opus",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(401);

      const body = await response.json() as any;
      expect(body.error.type).toBe("authentication_error");
    });
  });

  describe("Request Validation", () => {
    test("rejects invalid JSON body", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: "not valid json",
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error.type).toBe("invalid_request_error");
    });

    test("rejects request without model", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toContain("model");
    });

    test("rejects request without messages", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "claude-3-opus",
          max_tokens: 100,
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toContain("messages");
    });

    test("rejects request without max_tokens", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toContain("max_tokens");
    });
  });

  describe("Model Resolution", () => {
    test("returns 404 for unknown model", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "unknown-model",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      expect(response.status).toBe(404);

      const body = await response.json() as any;
      expect(body.type).toBe("error");
    });
  });

  describe("Error Response Format", () => {
    test("errors are in Anthropic format", async () => {
      const req = new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          model: "unknown-model",
          max_tokens: 100,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const response = await handleMessages(req, mockContext, "test-id", "127.0.0.1");
      const body = await response.json() as any;

      // Anthropic error format has type and error.type/error.message
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("type");
      expect(body.error).toHaveProperty("message");
    });
  });
});