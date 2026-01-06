import { test, expect, describe } from "bun:test";
import { GeminiTransformer } from "../gemini";

describe("GeminiTransformer extractUsage", () => {
  test("should extract reasoning_tokens from thoughtsTokenCount", () => {
    const transformer = new GeminiTransformer();
    const dataStr = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Response" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 1405,
        totalTokenCount: 2201,
        thoughtsTokenCount: 789,
        cachedContentTokenCount: 0,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(7);
    expect(usage!.output_tokens).toBe(1405);
    expect(usage!.reasoning_tokens).toBe(789);
    expect(usage!.cached_tokens).toBe(0);
  });

  test("should handle missing thoughtsTokenCount", () => {
    const transformer = new GeminiTransformer();
    const dataStr = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Response" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(10);
    expect(usage!.output_tokens).toBe(20);
    expect(usage!.reasoning_tokens).toBe(0);
  });

  test("should handle cached tokens", () => {
    const transformer = new GeminiTransformer();
    const dataStr = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Response" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
        cachedContentTokenCount: 25,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(100);
    expect(usage!.output_tokens).toBe(50);
    expect(usage!.cached_tokens).toBe(25);
    expect(usage!.reasoning_tokens).toBe(0);
  });

  test("should return undefined for missing usageMetadata", () => {
    const transformer = new GeminiTransformer();
    const dataStr = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Response" }] },
          finishReason: "STOP",
        },
      ],
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeUndefined();
  });

  test("should handle malformed JSON gracefully", () => {
    const transformer = new GeminiTransformer();
    const dataStr = "not valid json";

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeUndefined();
  });

  test("should extract all token types together", () => {
    const transformer = new GeminiTransformer();
    const dataStr = JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Response" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 336,
        totalTokenCount: 1027,
        thoughtsTokenCount: 684,
        cachedContentTokenCount: 50,
      },
    });

    const usage = transformer.extractUsage(dataStr);

    expect(usage).toBeDefined();
    expect(usage!.input_tokens).toBe(7);
    expect(usage!.output_tokens).toBe(336);
    expect(usage!.reasoning_tokens).toBe(684);
    expect(usage!.cached_tokens).toBe(50);
  });
});
