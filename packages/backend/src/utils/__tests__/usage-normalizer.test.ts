import { describe, expect, test } from 'bun:test';
import { normalizeOpenAIResponsesUsage } from '../usage-normalizer';

describe('usage-normalizer - OpenAI Responses usage', () => {
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
