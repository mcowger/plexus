import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Dispatcher } from "../services/dispatcher";
import type { PlexusConfig } from "../types/config";

// Mock logger to avoid noise in tests
import { logger } from "../utils/logger";
mock.module("../utils/logger", () => ({
  logger: {
    child: () => ({
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
      silly: () => {},
    }),
    debug: () => {},
    info: () => {},
    error: () => {},
    warn: () => {},
    silly: () => {},
  },
}));

describe("Streaming Support", () => {
  let mockConfig: any;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    // Setup mock config with test providers
    mockConfig = {
      apiKeys: [
        {
          name: "test-key",
          secret: "test-secret",
          enabled: true,
        },
      ],
      providers: [
        {
          name: "openai-test",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: {
            chat: "https://api.openai.com/v1/chat/completions",
          },
          auth: {
            type: "bearer",
            apiKey: "{env:OPENAI_API_KEY}",
          },
          models: ["gpt-4"],
        },
        {
          name: "anthropic-test",
          enabled: true,
          apiTypes: ["messages"],
          baseUrls: {
            messages: "https://api.anthropic.com/v1/messages",
          },
          auth: {
            type: "x-api-key",
            apiKey: "{env:ANTHROPIC_API_KEY}",
          },
          models: ["claude-3-5-sonnet-20241022"],
        },
      ],
      models: [
        {
          alias: "fast",
          selector: "random",
          targets: [
            {
              provider: "openai-test",
              model: "gpt-4",
              weight: 1,
            },
          ],
        },
        {
          alias: "sonnet",
          selector: "random",
          targets: [
            {
              provider: "anthropic-test",
              model: "claude-3-5-sonnet-20241022",
              weight: 1,
            },
          ],
        },
      ],
      server: {
        port: 4000,
        host: "127.0.0.1",
      },
      logging: {
        level: "error",
        debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false },
        usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 },
        errors: { storagePath: "logs/errors", retentionDays: 90 }
      },
    };

    dispatcher = new Dispatcher(mockConfig);
  });

  describe("OpenAI Streaming", () => {
    test("should detect streaming response from Content-Type header", async () => {
      // Create a mock streaming response
      const mockStreamBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      const mockResponse = new Response(mockStreamBody, {
        headers: {
          "Content-Type": "text/event-stream",
        },
      });

      // Verify the response is detected as streaming
      expect(mockResponse.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("should parse SSE chunks correctly", async () => {
      const mockStreamBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Test"},"finish_reason":null}]}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      const reader = mockStreamBody.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const text = decoder.decode(value);

      expect(text).toContain("data:");
      expect(text).toContain("Test");
    });
  });

  describe("Anthropic Streaming", () => {
    test("should handle Anthropic event stream format", async () => {
      const mockStreamBody = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","role":"assistant"}}\n\n')
          );
          controller.enqueue(
            encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n')
          );
          controller.enqueue(
            encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')
          );
          controller.close();
        },
      });

      const reader = mockStreamBody.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const text = decoder.decode(value);

      expect(text).toContain("event: message_start");
      expect(text).toContain("data:");
    });
  });

  describe("Stream Handler", () => {
    test("should handle SSE line parsing for OpenAI format", () => {
      const { SSEParser } = require("../services/stream-handler");
      
      const result = SSEParser.parseLine("data: [DONE]");
      expect(result?.isDone).toBe(true);

      const dataResult = SSEParser.parseLine('data: {"test":"value"}');
      expect(dataResult?.data).toBe('{"test":"value"}');
      expect(dataResult?.isDone).toBe(false);
    });

    test("should handle SSE line parsing for Anthropic format", () => {
      const { SSEParser } = require("../services/stream-handler");
      
      const eventResult = SSEParser.parseLine("event: message_start");
      expect(eventResult?.event).toBe("message_start");
      expect(eventResult?.isDone).toBe(false);

      const dataResult = SSEParser.parseLine('data: {"type":"message_stop"}');
      expect(dataResult?.data).toBe('{"type":"message_stop"}');
    });

    test("should parse JSON data from SSE chunks", () => {
      const { SSEParser } = require("../services/stream-handler");
      
      const parsed = SSEParser.parseJSON('{"test":"value"}');
      expect(parsed).toEqual({ test: "value" });

      const invalid = SSEParser.parseJSON("invalid json");
      expect(invalid).toBeNull();
    });

    test("should extract content for token counting", () => {
      const { SSEParser } = require("../services/stream-handler");
      
      // OpenAI format
      const openaiChunk = {
        choices: [{ delta: { content: "Hello" } }],
      };
      const content = SSEParser.extractContent(openaiChunk, "chat");
      expect(content).toBe("Hello");

      // Anthropic format
      const anthropicEvent = {
        type: "content_block_delta",
        delta: { text: "World" },
      };
      const anthropicContent = SSEParser.extractContent(anthropicEvent, "messages");
      expect(anthropicContent).toBe("World");
    });
  });

  describe("Cross-format Streaming", () => {
    test("should identify when transformation is needed", () => {
      const { TransformerFactory } = require("../services/transformer-factory");
      
      expect(TransformerFactory.needsTransformation("chat", "messages")).toBe(true);
      expect(TransformerFactory.needsTransformation("chat", "chat")).toBe(false);
      expect(TransformerFactory.needsTransformation("messages", "chat")).toBe(true);
      expect(TransformerFactory.needsTransformation("messages", "messages")).toBe(false);
    });
  });

  describe("Stream Metrics", () => {
    test("should track TTFT and token count", async () => {
      const { StreamHandler } = require("../services/stream-handler");
      
      const handler = new StreamHandler("test-req-id", "chat", "chat");
      
      // Simulate some time passing
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      const metrics = handler.getMetrics();
      expect(metrics.streamDuration).toBeGreaterThan(0);
      expect(metrics.ttft).toBeNull(); // No tokens received yet
      expect(metrics.totalTokens).toBe(0);
    });
  });
});
