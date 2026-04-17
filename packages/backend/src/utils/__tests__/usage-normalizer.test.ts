import { describe, expect, test } from 'vitest';
import { normalizeGeminiUsage, normalizeOpenAIResponsesUsage } from '../usage-normalizer';

describe('usage-normalizer - OpenAI Responses usage', () => {
  test('normalizes when input_tokens includes cached tokens', () => {
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 2006,
      output_tokens: 300,
      total_tokens: 2306,
      input_tokens_details: {
        cached_tokens: 1920,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(86);
    expect(normalized.cached_tokens).toBe(1920);
    expect(normalized.output_tokens).toBe(300);
    expect(normalized.total_tokens).toBe(2306);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('preserves uncached input when cached_tokens exceeds input_tokens', () => {
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 5233,
      output_tokens: 2643,
      total_tokens: 62660,
      input_tokens_details: {
        cached_tokens: 54784,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(5233);
    expect(normalized.cached_tokens).toBe(54784);
    expect(normalized.output_tokens).toBe(2643);
    expect(normalized.total_tokens).toBe(62660);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.input_tokens).toBeGreaterThanOrEqual(0);
  });
});

describe('usage-normalizer - Gemini usage', () => {
  test('normalizes promptTokenCount as total prompt and subtracts cachedContentTokenCount', () => {
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 2152,
      candidatesTokenCount: 710,
      totalTokenCount: 3564,
      thoughtsTokenCount: 702,
      cachedContentTokenCount: 2027,
    });

    expect(normalized.input_tokens).toBe(125);
    expect(normalized.cached_tokens).toBe(2027);
    expect(normalized.output_tokens).toBe(710);
    expect(normalized.reasoning_tokens).toBe(702);
    expect(normalized.total_tokens).toBe(3564);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('guards against cache values larger than prompt token count', () => {
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 7,
      candidatesTokenCount: 336,
      totalTokenCount: 1027,
      thoughtsTokenCount: 684,
      cachedContentTokenCount: 50,
    });

    expect(normalized.input_tokens).toBe(7);
    expect(normalized.cached_tokens).toBe(50);
    expect(normalized.output_tokens).toBe(336);
    expect(normalized.reasoning_tokens).toBe(684);
    expect(normalized.total_tokens).toBe(1027);
  });
});
