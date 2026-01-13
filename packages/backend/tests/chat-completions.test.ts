import { test, expect, mock, spyOn } from "bun:test";
import { handleChatCompletions } from "../src/routes/chat-completions";
import type { PlexusConfig } from "../src/types/config";
import { CooldownManager } from "../src/services/cooldown-manager";
import { HealthMonitor } from "../src/services/health-monitor";
import type { ServerContext } from "../src/types/server";

const mockConfig: PlexusConfig = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "info", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "openai",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: {
        chat: "https://api.openai.com/v1/chat/completions",
      },
      auth: {
        type: "bearer",
        apiKey: "{env:OPENAI_API_KEY}",
      },
      models: ["gpt-4", "gpt-3.5-turbo"],
    },
  ],
  models: [
    {
      alias: "gpt-4",
      targets: [{ provider: "openai", model: "gpt-4" }],
      selector: "random",
    },
    {
      alias: "gpt-3.5-turbo",
      targets: [{ provider: "openai", model: "gpt-3.5-turbo" }],
      selector: "random",
    },
  ],
  apiKeys: [{ name: "default", secret: "test-key-123", enabled: true }],
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

const cooldownManager = new CooldownManager(mockConfig);
const healthMonitor = new HealthMonitor(mockConfig, cooldownManager);
const mockContext: ServerContext = {
  config: mockConfig,
  cooldownManager,
  healthMonitor,
};

test("Chat Completions - Missing Authorization Header", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(401);

  const data = await response.json() as any;
  expect(data.error.type).toBe("authentication_error");
});

test("Chat Completions - Invalid JSON Body", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": "Bearer test-key-123",
      "content-type": "application/json",
    },
    body: "not valid json",
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(400);

  const data = await response.json() as any;
  expect(data.error.type).toBe("invalid_request_error");
});

test("Chat Completions - Missing Model Field", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": "Bearer test-key-123",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(400);

  const data = await response.json() as any;
  expect(data.error.type).toBe("invalid_request_error");
});

test("Chat Completions - Missing Messages Field", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": "Bearer test-key-123",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
    }),
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(400);

  const data = await response.json() as any;
  expect(data.error.type).toBe("invalid_request_error");
});

test("Chat Completions - Invalid Role in Message", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": "Bearer test-key-123",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "invalid-role", content: "hello" }],
    }),
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(400);

  const data = await response.json() as any;
  expect(data.error.type).toBe("invalid_request_error");
});

test("Chat Completions - Unknown Model", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": "Bearer test-key-123",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "unknown-model",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
  expect(response.status).toBe(404);

  const data = await response.json() as any;
  expect(data.error.type).toBe("invalid_request_error");
});

test("Chat Completions - Valid Request (with mock provider)", async () => {
  const fetchSpy = spyOn(global as any, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "chatcmpl-test-123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello! How can I help?" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

  try {
    process.env.OPENAI_API_KEY = "test-openai-key";

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": "Bearer test-key-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello!" }],
      }),
    });

    const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.object).toBe("chat.completion");
    expect(data.model).toBe("gpt-4");
    expect(data.choices).toHaveLength(1);
    expect(data.choices[0].message.role).toBe("assistant");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("Chat Completions - Valid with All Optional Fields", async () => {
  const fetchSpy = spyOn(global as any, "fetch").mockImplementation(async (url: string | URL | Request, options?: any) => {
    // Verify that all fields were passed through
    const body = JSON.parse(options.body);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(100);
    expect(body.presence_penalty).toBe(0.1);

    return new Response(
      JSON.stringify({
        id: "chatcmpl-test-123",
        object: "chat.completion",
        created: 1234567890,
        model: "gpt-3.5-turbo",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });

  try {
    process.env.OPENAI_API_KEY = "test-key";

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": "Bearer test-key-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        presence_penalty: 0.1,
      }),
    });

    const response = await handleChatCompletions(req, mockContext, "test-id", "127.0.0.1");
    expect(response.status).toBe(200);
  } finally {
    fetchSpy.mockRestore();
  }
});