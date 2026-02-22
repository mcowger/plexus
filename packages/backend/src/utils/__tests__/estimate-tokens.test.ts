import { describe, test, expect } from 'bun:test';
import {
  estimateTokens,
  estimateInputTokens,
  estimateTokensFromReconstructed,
} from '../estimate-tokens';

describe('estimateTokens', () => {
  test('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null as any)).toBe(0);
    expect(estimateTokens(undefined as any)).toBe(0);
  });

  test('should estimate tokens for simple prose', () => {
    const text = 'Hello, how are you today?';
    const estimate = estimateTokens(text);
    // Rough estimate: ~6 tokens (typical tokenization)
    expect(estimate).toBeGreaterThan(4);
    expect(estimate).toBeLessThan(10);
  });

  test('should handle code with higher token density', () => {
    const code = `function test() { return { key: "value" }; }`;
    const estimate = estimateTokens(code);
    // Code is more token-dense
    expect(estimate).toBeGreaterThan(8);
  });

  test('should handle JSON structures', () => {
    const json = JSON.stringify({ name: 'test', values: [1, 2, 3], nested: { key: 'value' } });
    const estimate = estimateTokens(json);
    expect(estimate).toBeGreaterThan(0);
  });

  test('should handle URLs correctly', () => {
    const text = 'Visit https://example.com/path/to/resource for more info';
    const estimate = estimateTokens(text);
    // URLs increase token count
    expect(estimate).toBeGreaterThan(10);
  });

  test('should handle repetitive text', () => {
    const repetitive = 'test '.repeat(100);
    const varied = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

    const repetitiveEstimate = estimateTokens(repetitive);
    const variedEstimate = estimateTokens(varied);

    // Both should produce estimates
    expect(repetitiveEstimate).toBeGreaterThan(0);
    expect(variedEstimate).toBeGreaterThan(0);
  });
});

describe('estimateInputTokens', () => {
  test('should estimate tokens from OpenAI chat format', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello, how are you?' },
      ],
    };

    const estimate = estimateInputTokens(body, 'chat');
    expect(estimate).toBeGreaterThan(10);
  });

  test('should estimate tokens from Anthropic messages format', () => {
    const body = {
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello, how are you?' }],
    };

    const estimate = estimateInputTokens(body, 'messages');
    expect(estimate).toBeGreaterThan(10);
  });

  test('should estimate tokens from Gemini format', () => {
    const body = {
      systemInstruction: { text: 'You are a helpful assistant.' },
      contents: [{ parts: [{ text: 'Hello, how are you?' }] }],
    };

    const estimate = estimateInputTokens(body, 'gemini');
    expect(estimate).toBeGreaterThan(10);
  });

  test('should return 0 for malformed input', () => {
    const estimate = estimateInputTokens({}, 'chat');
    expect(estimate).toBe(0);
  });
});

describe('estimateTokensFromReconstructed', () => {
  test('should extract tokens from chat completions response', () => {
    const reconstructed = {
      choices: [
        {
          delta: {
            content: 'This is a test response with some content.',
            reasoning_content: 'Thinking through the problem step by step.',
          },
        },
      ],
    };

    const { output, reasoning } = estimateTokensFromReconstructed(reconstructed, 'chat');
    expect(output).toBeGreaterThan(5);
    expect(reasoning).toBeGreaterThan(5);
  });

  test('should extract tokens from Anthropic messages response', () => {
    const reconstructed = {
      content: [
        { type: 'text', text: 'This is a response.' },
        { type: 'thinking', thinking: 'Let me think about this.' },
      ],
    };

    const { output, reasoning } = estimateTokensFromReconstructed(reconstructed, 'messages');
    expect(output).toBeGreaterThan(2);
    expect(reasoning).toBeGreaterThan(3);
  });

  test('should extract tokens from Gemini response', () => {
    const reconstructed = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'Regular response text.', thought: false },
              { text: 'Thought process here.', thought: true },
            ],
          },
        },
      ],
    };

    const { output, reasoning } = estimateTokensFromReconstructed(reconstructed, 'gemini');
    expect(output).toBeGreaterThan(2);
    expect(reasoning).toBeGreaterThan(2);
  });

  test('should handle tool calls in chat completions', () => {
    const reconstructed = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: {
                  name: 'get_weather',
                  arguments: '{"location": "San Francisco"}',
                },
              },
            ],
          },
        },
      ],
    };

    const { output } = estimateTokensFromReconstructed(reconstructed, 'chat');
    expect(output).toBeGreaterThan(0);
  });

  test('should return 0 for null/undefined reconstructed response', () => {
    const { output, reasoning } = estimateTokensFromReconstructed(null, 'chat');
    expect(output).toBe(0);
    expect(reasoning).toBe(0);
  });

  test('should handle empty responses', () => {
    const { output, reasoning } = estimateTokensFromReconstructed({}, 'chat');
    expect(output).toBe(0);
    expect(reasoning).toBe(0);
  });

  test('should handle unknown API type gracefully', () => {
    const reconstructed = { some: 'data' };
    const { output, reasoning } = estimateTokensFromReconstructed(reconstructed, 'unknown');
    expect(output).toBe(0);
    expect(reasoning).toBe(0);
  });
});
