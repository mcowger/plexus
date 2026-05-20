import { describe, expect, test } from 'vitest';
import {
  normalizeGeminiUsage,
  normalizeOpenAIChatUsage,
  normalizeOpenAIResponsesUsage,
  extractUsageCostDetails,
} from '../usage-normalizer';

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

describe('usage-normalizer - OpenAI Chat usage', () => {
  test('normalizes prompt_tokens_details with cached_tokens', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 2006,
      completion_tokens: 300,
      total_tokens: 2306,
      prompt_tokens_details: {
        cached_tokens: 1920,
      },
      completion_tokens_details: {
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

  test('extracts cache_write_tokens from prompt_tokens_details', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 2006,
      completion_tokens: 300,
      total_tokens: 2306,
      prompt_tokens_details: {
        cached_tokens: 1920,
        cache_write_tokens: 50,
      },
      completion_tokens_details: {
        reasoning_tokens: 10,
      },
    });

    expect(normalized.cache_creation_tokens).toBe(50);
    expect(normalized.cached_tokens).toBe(1920);
    expect(normalized.reasoning_tokens).toBe(10);
  });

  test('normalizes DeepSeek top-level prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
    // DeepSeek reports cache at the top level instead of under prompt_tokens_details.
    // prompt_tokens = hit + miss; input_tokens should be the miss (uncached) portion.
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    });

    expect(normalized.cached_tokens).toBe(800);
    expect(normalized.input_tokens).toBe(200);
    expect(normalized.output_tokens).toBe(200);
    expect(normalized.total_tokens).toBe(1200);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('defaults cache_write_tokens to 0 when not present', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: {
        cached_tokens: 20,
      },
    });

    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('handles new usage format with cost_details (tokens only)', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 23,
      total_tokens: 66,
      completion_tokens: 43,
      estimated_cost: 0.00017465,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
        audio_tokens: 0,
        video_tokens: 0,
        image_tokens: 0,
      },
      cost: 0.00017465,
      cost_details: {
        total_cost: 0.00017465,
        input_cost: 0.00002415,
        output_cost: 0.0001505,
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        image_tokens: 0,
        audio_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(23);
    expect(normalized.output_tokens).toBe(43);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(66);
  });
});
