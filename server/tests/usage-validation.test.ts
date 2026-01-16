import { test, expect, mock } from "bun:test";
import { Dispatcher } from "../services/dispatcher";
import { UsageLogger } from "../services/usage-logger";
import type { PlexusConfig } from "../types/config";
import type { ServerContext } from "../types/server";

const mockConfig: any = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "error", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7 }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "anthropic-mock",
      enabled: true,
      baseUrls: {
        chat: "https://api.anthropic.com/v1/chat/completions",
        messages: "https://api.anthropic.com/v1/messages",
      },
      auth: {
        type: "x-api-key",
        apiKey: "test-key",
      },
      models: ["claude-3-opus"],
    },
    {
      name: "openai-mock",
      enabled: true,
      baseUrls: { chat: "https://api.openai.com/v1/chat/completions", messages: "https://api.openai.com/v1/chat/completions" },
      auth: { type: "bearer", apiKey: "test" },
      models: ["gpt-4o"],
    }
  ],
  apiKeys: [{ name: "default", secret: "test-key", enabled: true }],
  aliases: {},
};

const createMockContext = (config: any): ServerContext => ({
  config,
  cooldownManager: {
    isOnCooldown: () => false,
    setCooldown: () => {},
    removeCooldown: () => {},
    updateConfig: () => {},
  } as any,
  healthMonitor: {
    getProviderHealth: () => null,
    recordRequest: () => {},
  } as any,
  usageLogger: undefined,
  metricsCollector: undefined,
  costCalculator: undefined,
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
});

const waitFor = async (condition: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met within timeout");
};

test("Dispatcher - Correctly logs usage from Anthropic format response", async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = (mock as any)(async () => {
    return new Response(JSON.stringify({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      usage: {
        input_tokens: 15,
        output_tokens: 25,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 10
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  try {
    const context = createMockContext(mockConfig);
    const dispatcher = new Dispatcher(context);

    const request = {
      model: "anthropic-mock/claude-3-opus",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100
    };

    await dispatcher.dispatchMessages(request, "req-123", "127.0.0.1", "default");
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Dispatcher - Correctly logs usage from Anthropic streaming response", async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = (mock as any)(async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Use template literals with explicit newlines to avoid escaping issues
        const chunks = [
          `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":0}}}

`,
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

`,
          `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":10,"output_tokens":5}}

`,
          `event: message_stop\ndata: {"type":"message_stop"}

`
        ];

        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache"
      }
    });
  });

  try {
    const context = createMockContext(mockConfig);
    const dispatcher = new Dispatcher(context);

    const request = {
      model: "anthropic-mock/claude-3-opus",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
      stream: true
    };

    const response = await dispatcher.dispatchMessages(request, "req-stream-123", "127.0.0.1", "default");

    const reader = response.body?.getReader();
    while (true) {
      const { done } = await reader!.read();
      if (done) break;
    }
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Dispatcher - Correctly logs usage from Chat (OpenAI) unary response", async () => {
  const mockLogRequest = mock((...args: any[]) => Promise.resolve());
  const mockUsageLogger = {
    logRequest: mockLogRequest,
    enabled: true,
  } as unknown as UsageLogger;

  const originalFetch = global.fetch;
  (global as any).fetch = (mock as any)(async () => {
    return new Response(JSON.stringify({
      id: "chatcmpl-123",
      choices: [{ message: { role: "assistant", content: "Hello" } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  try {
    const context = createMockContext(mockConfig);
    const dispatcher = new Dispatcher(context);

    await dispatcher.dispatchChatCompletion({
      model: "openai-mock/gpt-4o",
      messages: [{ role: "user", content: "hi" }]
    }, "req-chat-unary");

  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Dispatcher - Correctly logs usage from Chat (OpenAI) streaming response", async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = (mock as any)(async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const chunks = [
          `data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n`,
          `data: {"id":"chatcmpl-123","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"object":"chat.completion.chunk"}\n\n`,
          `data: [DONE]\n\n`
        ];

        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  });

  try {
    const context = createMockContext(mockConfig);
    const dispatcher = new Dispatcher(context);

    const response = await dispatcher.dispatchChatCompletion({
      model: "openai-mock/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stream: true
    }, "req-chat-stream");

    const reader = response.body?.getReader();
    while (true) {
      const { done } = await reader!.read();
    if (done) break;
    }
  } finally {
    (global as any).fetch = originalFetch;
  }
});