import { test, expect, beforeAll, afterAll } from "bun:test";
import { ProviderClient } from "../services/provider-client";
import type { ProviderConfig } from "../types/config";

// Mock provider configuration
const mockProviderConfig: ProviderConfig = {
  name: "test-provider",
  enabled: true,
  baseUrls: {
    chat: { url: "https://api.test.com/v1/chat/completions", enabled: true },
  },
  auth: {
    type: "bearer",
    apiKey: "{env:TEST_API_KEY}",
  },
  models: ["test-model"],
};

// Set up test environment
beforeAll(() => {
  process.env.TEST_API_KEY = "test-api-key-123";
});

test("Provider Client - Bearer Token Authentication", async () => {
  const client = new ProviderClient(mockProviderConfig);

  // Mock fetch to verify headers
  let capturedHeaders: Record<string, string> | null = null;

  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, options: any) => {
    capturedHeaders = options.headers;
    return new Response(
      JSON.stringify({
        id: "test-response",
        object: "chat.completion",
        created: 1234567890,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "test response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await client.request({
      method: "POST",
      url: "https://api.test.com/v1/chat/completions",
      body: { model: "test-model", messages: [] },
      requestId: "test-request-id",
    });

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.authorization).toBe("Bearer test-api-key-123");
    expect(capturedHeaders!["content-type"]).toBe("application/json");
    expect(capturedHeaders!["x-request-id"]).toBe("test-request-id");
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Provider Client - Missing API Key", async () => {
  const config: ProviderConfig = {
    ...mockProviderConfig,
    auth: {
      type: "bearer",
      apiKey: "{env:NONEXISTENT_KEY}",
    },
  };

  const client = new ProviderClient(config);

  expect(async () => {
    await client.request({
      method: "POST",
      url: "https://api.test.com/v1/chat/completions",
      body: { model: "test-model", messages: [] },
    });
  }).toThrow();
});

test("Provider Client - X-API-Key Authentication", async () => {
  process.env.CUSTOM_API_KEY = "custom-key-value";

  const config: ProviderConfig = {
    ...mockProviderConfig,
    auth: {
      type: "x-api-key",
      apiKey: "{env:CUSTOM_API_KEY}",
    },
  };

  const client = new ProviderClient(config);

  let capturedHeaders: Record<string, string> | null = null;

  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, options: any) => {
    capturedHeaders = options.headers;
    return new Response(
      JSON.stringify({
        id: "test-response",
        object: "chat.completion",
        created: 1234567890,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "test" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await client.request({
      method: "POST",
      url: "https://api.test.com/v1/chat/completions",
      body: {},
    });

    expect(capturedHeaders!["x-api-key"]).toBe("custom-key-value");
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Provider Client - Direct String API Key", async () => {
  const config: ProviderConfig = {
    ...mockProviderConfig,
    auth: {
      type: "bearer",
      apiKey: "direct-api-key-value",
    },
  };

  const client = new ProviderClient(config);
  let capturedHeaders: Record<string, string> | null = null;

  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string, options: any) => {
    capturedHeaders = options.headers;
    return new Response(
      JSON.stringify({
        id: "test-response",
        choices: [{ message: { role: "assistant", content: "test" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    await client.request({
      method: "POST",
      url: "https://api.test.com/v1/chat/completions",
      body: {},
    });

    expect(capturedHeaders!.authorization).toBe("Bearer direct-api-key-value");
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Provider Client - Error Response from Provider", async () => {
  const client = new ProviderClient(mockProviderConfig);

  const originalFetch = global.fetch;
  (global as any).fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid request",
          type: "invalid_request_error",
        },
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  };

  try {
    expect(async () => {
      await client.request({
        method: "POST",
        url: "https://api.test.com/v1/chat/completions",
        body: { model: "test-model", messages: [] },
      });
    }).toThrow();
  } finally {
    (global as any).fetch = originalFetch;
  }
});
