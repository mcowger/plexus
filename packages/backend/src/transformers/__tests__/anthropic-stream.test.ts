import { test, expect, describe } from "bun:test";
import { AnthropicTransformer } from "../anthropic";
import { UnifiedChatStreamChunk } from "../../types/unified";

describe("AnthropicTransformer Stream Formatting", () => {
  test("should include usage when it arrives after finish_reason", async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        // Chunk 1: Stop reason
        controller.enqueue({
          id: "msg_1",
          model: "claude",
          created: 1234567890,
          delta: { role: "assistant", content: "Hello" },
          finish_reason: "stop",
        });

        // Chunk 2: Usage (after stop)
        controller.enqueue({
          id: "msg_1",
          model: "claude",
          created: 1234567890,
          delta: {},
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    // Check for message_delta with usage
    const events = output.split("\n\n").filter(Boolean);
    const messageDeltaEvent = events.find(e => e.includes("message_delta"));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent!.split("data: ")[1];
    const data = JSON.parse(jsonStr);

    expect(data.type).toBe("message_delta");
    expect(data.usage).toBeDefined();
    expect(data.usage.output_tokens).toBe(20);
    expect(data.delta.stop_reason).toBe("end_turn");
  });

  test("should include thinkingTokens in message_delta usage", async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        // Chunk 1: Content
        controller.enqueue({
          id: "msg_2",
          model: "claude",
          created: 1234567890,
          delta: { role: "assistant", content: "Response with thinking" },
        });

        // Chunk 2: Finish with usage including reasoning tokens
        controller.enqueue({
          id: "msg_2",
          model: "claude",
          created: 1234567890,
          finish_reason: "stop",
          usage: {
            input_tokens: 7,
            output_tokens: 325,
            total_tokens: 1027,
            reasoning_tokens: 695,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    // Check for message_delta with thinkingTokens
    const events = output.split("\n\n").filter(Boolean);
    const messageDeltaEvent = events.find((e) => e.includes("message_delta"));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent!.split("data: ")[1];
    const data = JSON.parse(jsonStr);

    expect(data.type).toBe("message_delta");
    expect(data.usage).toBeDefined();
    expect(data.usage.input_tokens).toBe(7);
    expect(data.usage.output_tokens).toBe(325);
    expect(data.usage.thinkingTokens).toBe(695);
    expect(data.delta.stop_reason).toBe("end_turn");
  });

  test("should handle zero thinkingTokens", async () => {
    const transformer = new AnthropicTransformer();
    const stream = new ReadableStream<UnifiedChatStreamChunk>({
      start(controller) {
        controller.enqueue({
          id: "msg_3",
          model: "claude",
          created: 1234567890,
          delta: { role: "assistant", content: "Simple response" },
          finish_reason: "stop",
          usage: {
            input_tokens: 5,
            output_tokens: 10,
            total_tokens: 15,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    const events = output.split("\n\n").filter(Boolean);
    const messageDeltaEvent = events.find((e) => e.includes("message_delta"));

    expect(messageDeltaEvent).toBeDefined();

    const jsonStr = messageDeltaEvent!.split("data: ")[1];
    const data = JSON.parse(jsonStr);

    expect(data.usage).toBeDefined();
    expect(data.usage.thinkingTokens).toBe(0);
  });
});
