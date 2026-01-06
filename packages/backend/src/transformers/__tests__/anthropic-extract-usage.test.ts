
import { test, expect, describe } from "bun:test";
import { AnthropicTransformer } from "../anthropic";

describe("AnthropicTransformer extractUsage", () => {
  test("should extract input_tokens from message_delta", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { input_tokens: 154, output_tokens: 24, cache_read_input_tokens: 0 }
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(154);
    expect(usage!.output_tokens).toBe(24);
  });

  test("should extract reasoning_tokens from thinkingTokens in message_delta", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "max_tokens", stop_sequence: null },
      usage: {
        input_tokens: 7,
        output_tokens: 325,
        thinkingTokens: 695,
        cache_read_input_tokens: 0,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(7);
    expect(usage!.output_tokens).toBe(325);
    expect(usage!.reasoning_tokens).toBe(695);
    expect(usage!.cached_tokens).toBe(0);
  });

  test("should extract reasoning_tokens from thinkingTokens in message_start", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          thinkingTokens: 100,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        },
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(10);
    expect(usage!.output_tokens).toBe(0);
    expect(usage!.reasoning_tokens).toBe(100);
    expect(usage!.cached_tokens).toBe(50);
  });

  test("should handle missing thinkingTokens", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        input_tokens: 15,
        output_tokens: 30,
        cache_read_input_tokens: 5,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(15);
    expect(usage!.output_tokens).toBe(30);
    expect(usage!.reasoning_tokens).toBe(0);
    expect(usage!.cached_tokens).toBe(5);
  });

  test("should return undefined for non-usage events", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeUndefined();
  });

  test("should handle malformed JSON gracefully", async () => {
    const transformer = new AnthropicTransformer();
    const dataStr = "not valid json";

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeUndefined();
  });
});
