
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
});
