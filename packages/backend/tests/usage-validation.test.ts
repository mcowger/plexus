import { test, expect, mock } from "bun:test";
import { Dispatcher } from "../src/services/dispatcher";
import { UsageLogger } from "../src/services/usage-logger";
import type { PlexusConfig } from "../src/types/config";

const mockConfig: any = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "error", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "anthropic-mock",
      enabled: true,
      apiTypes: ["messages"],
      baseUrls: {
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
      apiTypes: ["chat"],
      baseUrls: { chat: "https://api.openai.com/v1/chat/completions" },
      auth: { type: "bearer", apiKey: "test" },
      models: ["gpt-4o"],
    }
  ],
  apiKeys: [{ name: "default", secret: "test-key", enabled: true }],
};

const waitFor = async (condition: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met within timeout");
};

test("Dispatcher - Correctly logs usage from Anthropic format response", async () => {
  const mockLogRequest = mock((...args: any[]) => Promise.resolve());
  const mockUsageLogger = {
    logRequest: mockLogRequest,
    enabled: true,
  } as unknown as UsageLogger;

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
    const dispatcher = new Dispatcher(
      mockConfig,
      undefined, undefined, undefined,
      mockUsageLogger, undefined
    );

    const request = {
      model: "anthropic-mock/claude-3-opus",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100
    };

    await dispatcher.dispatchMessages(request, "req-123", "127.0.0.1", "default");

    expect(mockLogRequest).toHaveBeenCalled();
    const [context, responseInfo] = mockLogRequest.mock.calls[0]!;
    
    expect(responseInfo.usage).toBeDefined();
    expect(responseInfo.usage.inputTokens).toBe(25);
    expect(responseInfo.usage.outputTokens).toBe(25);
    expect(responseInfo.usage.cacheReadTokens).toBe(10);
    expect(responseInfo.usage.cacheCreationTokens).toBe(5);
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Dispatcher - Correctly logs usage from Anthropic streaming response", async () => {
  const mockLogRequest = mock((...args: any[]) => Promise.resolve());
  const mockUsageLogger = {
    logRequest: mockLogRequest,
    enabled: true,
    markFirstToken: () => {},
  } as unknown as UsageLogger;

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
    const dispatcher = new Dispatcher(
      mockConfig,
      undefined, undefined, undefined,
      mockUsageLogger, undefined
    );

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

    await waitFor(() => mockLogRequest.mock.calls.length > 0);

    expect(mockLogRequest).toHaveBeenCalled();
    const [context, responseInfo] = mockLogRequest.mock.calls[0]!;
    
    expect(responseInfo.usage).toBeDefined();
    expect(responseInfo.usage.inputTokens).toBe(10);
    expect(responseInfo.usage.outputTokens).toBe(5);
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
    const dispatcher = new Dispatcher(
      mockConfig,
      undefined, undefined, undefined,
      mockUsageLogger, undefined
    );

    await dispatcher.dispatchChatCompletion({
      model: "openai-mock/gpt-4o",
      messages: [{ role: "user", content: "hi" }]
    }, "req-chat-unary");

    expect(mockLogRequest).toHaveBeenCalled();
    const [context, responseInfo] = mockLogRequest.mock.calls[0]!;
    
    expect(responseInfo.usage.inputTokens).toBe(10);
    expect(responseInfo.usage.outputTokens).toBe(20);
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("Dispatcher - Correctly logs usage from Chat (OpenAI) streaming response", async () => {
  const mockLogRequest = mock((...args: any[]) => Promise.resolve());
  const mockUsageLogger = {
    logRequest: mockLogRequest,
    enabled: true,
    markFirstToken: () => {},
  } as unknown as UsageLogger;

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
    const dispatcher = new Dispatcher(
      mockConfig,
      undefined, undefined, undefined,
      mockUsageLogger, undefined
    );

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

    await waitFor(() => mockLogRequest.mock.calls.length > 0);

    expect(mockLogRequest).toHaveBeenCalled();
    const [context, responseInfo] = mockLogRequest.mock.calls[0]!;
    
    expect(responseInfo.usage.inputTokens).toBe(10);
    expect(responseInfo.usage.outputTokens).toBe(5);
  } finally {
    (global as any).fetch = originalFetch;
  }
});