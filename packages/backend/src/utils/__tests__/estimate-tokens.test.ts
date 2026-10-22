import { describe, expect, test } from 'vitest';

import {
  estimateContextTokens,
  estimateInputTokens,
  estimateTokens,
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

  test('should estimate tokens from Responses API array input', () => {
    const body = {
      instructions: 'You are a helpful assistant.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello, how are you?' }],
        },
      ],
    };

    const estimate = estimateInputTokens(body, 'responses');
    expect(estimate).toBeGreaterThan(10);
  });

  test('should estimate tokens from Responses API string input', () => {
    const body = {
      input: 'Explain the difference between SSE and WebSocket in two sentences.',
    };

    const estimate = estimateInputTokens(body, 'responses');
    expect(estimate).toBeGreaterThan(5);
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

describe('estimateContextTokens', () => {
  // Test 1: Empty context → 0 (or ~0)
  test('empty context returns 0', () => {
    expect(estimateContextTokens({ messages: [] })).toBe(0);
  });

  // Test 2: systemPrompt contributes tokens
  test('systemPrompt contributes tokens', () => {
    const withPrompt = estimateContextTokens({
      systemPrompt: 'You are a helpful assistant.',
      messages: [],
    });
    const withoutPrompt = estimateContextTokens({
      systemPrompt: '',
      messages: [],
    });
    expect(withPrompt).toBeGreaterThan(0);
    expect(withPrompt).toBeGreaterThan(withoutPrompt);
  });

  // Test 3: User message with string content == equivalent single text-block array
  test('user message string content and text-block array produce same estimate', () => {
    const text = 'Hello, how are you doing today?';
    const withString = estimateContextTokens({
      messages: [{ role: 'user', content: text, timestamp: 0 }],
    });
    const withArray = estimateContextTokens({
      messages: [{ role: 'user', content: [{ type: 'text', text }], timestamp: 0 }],
    });
    expect(withString).toEqual(withArray);
  });

  // Test 4: More/larger text → strictly larger estimate
  test('larger text block produces strictly larger estimate', () => {
    const shortContext = estimateContextTokens({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi.' }], timestamp: 0 }],
    });
    const longContext = estimateContextTokens({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'This is a much longer message with a lot more content to count tokens for, which should produce a higher estimate than a short message.',
            },
          ],
          timestamp: 0,
        },
      ],
    });
    expect(longContext).toBeGreaterThan(shortContext);
  });

  // Test 5: assistant message with toolCall block contributes > 0
  test('assistant message with toolCall block contributes tokens', () => {
    const result = estimateContextTokens({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call_123',
              name: 'get_weather',
              arguments: { location: 'San Francisco', unit: 'celsius' },
            },
          ],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-opus-4-5',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 0,
        },
      ],
    });
    expect(result).toBeGreaterThan(0);
  });

  // Test 6: toolResult message with text block contributes > 0
  test('toolResult message with text block contributes tokens', () => {
    const result = estimateContextTokens({
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          content: [{ type: 'text', text: 'The weather in San Francisco is 18°C and sunny.' }],
          isError: false,
          timestamp: 0,
        },
      ],
    });
    expect(result).toBeGreaterThan(0);
  });

  // Test 7: Image block adds positive cost
  test('user message with image block estimates more than without image', () => {
    // A tiny 1×1 pixel PNG in base64 (raw, no data: prefix)
    const tiny1x1PngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const withoutImage = estimateContextTokens({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'What do you see?' }],
          timestamp: 0,
        },
      ],
    });
    const withImage = estimateContextTokens({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What do you see?' },
            { type: 'image', data: tiny1x1PngBase64, mimeType: 'image/png' },
          ],
          timestamp: 0,
        },
      ],
    });
    expect(withImage).toBeGreaterThan(withoutImage);
  });

  // Test 8: context.tools increases the estimate (FIX 1 parity test)
  test('context with tools array estimates more than context without tools', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get the weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ];
    const baseMessages = [{ role: 'user' as const, content: 'What is the weather?', timestamp: 0 }];
    const withTools = estimateContextTokens({ messages: baseMessages, tools });
    const withoutTools = estimateContextTokens({ messages: baseMessages });
    expect(withTools).toBeGreaterThan(withoutTools);
  });

  // Test 9: apiType changes image cost (gemini 258/image < messages 1600/image)
  test('apiType changes image cost: gemini estimate < messages estimate', () => {
    // A short non-image base64 string — won't decode to real dimensions,
    // so both paths fall back to per-provider defaults (gemini=258, messages=1600).
    const fakeBase64 = Buffer.from('x'.repeat(40)).toString('base64');
    const ctx = {
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'image' as const, data: fakeBase64, mimeType: 'image/png' as const }],
          timestamp: 0,
        },
      ],
    };
    const geminiEstimate = estimateContextTokens(ctx, 'gemini');
    const messagesEstimate = estimateContextTokens(ctx, 'messages');
    expect(geminiEstimate).toBeLessThan(messagesEstimate);
  });
});
