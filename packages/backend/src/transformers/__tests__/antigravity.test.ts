import { test, expect, describe } from "bun:test";
import { AntigravityTransformer } from "../antigravity";
import { UnifiedChatRequest } from "../../types/unified";

describe("AntigravityTransformer", () => {
  describe("getEndpoint", () => {
    test("should return non-streaming endpoint", () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "test" }],
        model: "gemini-3-flash-preview",
        stream: false,
      };

      const endpoint = transformer.getEndpoint(request);
      expect(endpoint).toBe("/v1internal:generateContent");
    });

    test("should return streaming endpoint with alt=sse", () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "test" }],
        model: "gemini-3-flash-preview",
        stream: true,
      };

      const endpoint = transformer.getEndpoint(request);
      expect(endpoint).toBe("/v1internal:streamGenerateContent?alt=sse");
    });
  });

  describe("transformRequest", () => {
    test("should wrap Gemini request in Antigravity envelope", async () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-3-flash-preview",
        max_tokens: 1024,
        temperature: 0.7,
        stream: false,
      };

      const transformed = await transformer.transformRequest(request);

      expect(transformed.model).toBe("gemini-3-flash-preview");
      expect(transformed.project).toBeDefined();
      expect(transformed.project).toMatch(/^project-/);
      expect(transformed.requestId).toBeDefined();
      expect(transformed.requestId).toMatch(/^agent-/);
      expect(transformed.userAgent).toBe("antigravity");
      expect(transformed.request).toBeDefined();
      expect(transformed.request.contents).toBeDefined();
      expect(transformed.request.sessionId).toBeDefined();
      expect(transformed.request.generationConfig).toBeDefined();
    });

    test("should use OAuth project_id from metadata when available", async () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-3-flash-preview",
        stream: false,
        metadata: {
          oauth_project_id: "test-project-123",
        },
      };

      const transformed = await transformer.transformRequest(request);

      expect(transformed.project).toBe("test-project-123");
    });

    test("should include toolConfig when tools are present", async () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-3-flash-preview",
        stream: false,
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      };

      const transformed = await transformer.transformRequest(request);

      expect(transformed.request.toolConfig).toBeDefined();
      expect(transformed.request.toolConfig.functionCallingConfig.mode).toBe(
        "VALIDATED"
      );
    });

    test("should generate stable sessionId for same contents", async () => {
      const transformer = new AntigravityTransformer();
      const request: UnifiedChatRequest = {
        messages: [{ role: "user", content: "Hello" }],
        model: "gemini-3-flash-preview",
        stream: false,
      };

      const transformed1 = await transformer.transformRequest(request);
      const transformed2 = await transformer.transformRequest(request);

      expect(transformed1.request.sessionId).toBe(
        transformed2.request.sessionId
      );
    });
  });

  describe("transformResponse", () => {
    test("should unwrap Antigravity response envelope", async () => {
      const transformer = new AntigravityTransformer();
      const antigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Hello, world!" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            totalTokenCount: 15,
            thoughtsTokenCount: 0,
          },
        },
      };

      const unified = await transformer.transformResponse(antigravityResponse);

      expect(unified.content).toBe("Hello, world!");
      expect(unified.usage?.input_tokens).toBe(5);
      expect(unified.usage?.output_tokens).toBe(10);
      expect(unified.usage?.reasoning_tokens).toBe(0);
    });

    test("should handle response without envelope wrapper", async () => {
      const transformer = new AntigravityTransformer();
      const geminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Direct response" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 5,
          totalTokenCount: 8,
        },
      };

      const unified = await transformer.transformResponse(geminiResponse);

      expect(unified.content).toBe("Direct response");
      expect(unified.usage?.input_tokens).toBe(3);
      expect(unified.usage?.output_tokens).toBe(5);
    });

    test("should correctly map reasoning tokens from thoughtsTokenCount", async () => {
      const transformer = new AntigravityTransformer();
      const antigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Response with thinking" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 1405,
            totalTokenCount: 2201,
            thoughtsTokenCount: 789,
          },
        },
      };

      const unified = await transformer.transformResponse(antigravityResponse);

      expect(unified.content).toBe("Response with thinking");
      expect(unified.usage?.input_tokens).toBe(7);
      expect(unified.usage?.output_tokens).toBe(1405);
      expect(unified.usage?.reasoning_tokens).toBe(789);
      expect(unified.usage?.total_tokens).toBe(2201);
    });
  });

  describe("transformStream", () => {
    test("should unwrap Antigravity SSE envelope in stream chunks", async () => {
      const transformer = new AntigravityTransformer();

      // Simulate Antigravity SSE stream with wrapped responses
      const antigravitySSE = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":null}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"finishReason":null}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":10,"totalTokenCount":15,"thoughtsTokenCount":0}}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of antigravitySSE) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should have text chunks and final usage chunk
      expect(chunks.length).toBeGreaterThan(0);

      // First chunk should have text delta
      expect(chunks[0].delta?.content).toBe("Hello");

      // Should have accumulated all text
      const textChunks = chunks.filter((c) => c.delta?.content);
      const fullText = textChunks.map((c) => c.delta.content).join("");
      expect(fullText).toBe("Hello world");

      // Final chunk should have usage
      const usageChunk = chunks.find((c) => c.usage);
      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.input_tokens).toBe(5);
      expect(usageChunk.usage.output_tokens).toBe(10);
    });

    test("should handle [DONE] sentinel", async () => {
      const transformer = new AntigravityTransformer();

      const antigravitySSE = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Done"}]},"finishReason":"STOP"}]}}\n\n',
        "data: [DONE]\n\n",
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of antigravitySSE) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should process successfully without errors
      expect(chunks.length).toBeGreaterThan(0);
    });

    test("should handle chunks split across line boundaries", async () => {
      const transformer = new AntigravityTransformer();

      // Simulate partial SSE chunks
      const partialChunks = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"te',
        'xt":"Split"}]},"finishReason":null}]}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of partialChunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should handle split chunks correctly
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].delta?.content).toBe("Split");
    });

    test("should unwrap reasoning tokens from thoughtsTokenCount in streams", async () => {
      const transformer = new AntigravityTransformer();

      const antigravitySSE = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Thinking response"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":1405,"totalTokenCount":2201,"thoughtsTokenCount":789}}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of antigravitySSE) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Find the usage chunk
      const usageChunk = chunks.find((c) => c.usage);
      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.input_tokens).toBe(7);
      expect(usageChunk.usage.output_tokens).toBe(1405);
      expect(usageChunk.usage.reasoning_tokens).toBe(789);
      expect(usageChunk.usage.total_tokens).toBe(2201);
    });

    test("should handle different line endings (CRLF and LF)", async () => {
      const transformer = new AntigravityTransformer();

      // Mix of \r\n and \n line endings
      const mixedLineEndings = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Line1"}]},"finishReason":null}]}}\r\n\r\n',
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Line2"}]},"finishReason":null}]}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of mixedLineEndings) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should handle both line ending styles
      expect(chunks.length).toBeGreaterThan(0);
      const textChunks = chunks.filter((c) => c.delta?.content);
      expect(textChunks.length).toBe(2);
      expect(textChunks[0].delta.content).toBe("Line1");
      expect(textChunks[1].delta.content).toBe("Line2");
    });

    test("should process remaining buffer on flush", async () => {
      const transformer = new AntigravityTransformer();

      // Final chunk without trailing newline
      const noTrailingNewline = [
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Final"}]},"finishReason":"STOP"}]}}',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of noTrailingNewline) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const transformedStream = transformer.transformStream(stream);
      const reader = transformedStream.getReader();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should process the buffered content on flush
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].delta?.content).toBe("Final");
    });
  });
});
