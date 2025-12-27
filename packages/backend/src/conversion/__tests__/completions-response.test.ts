import { describe, it, expect } from 'vitest';
import { convertToOpenAIChatResponse } from '../completions/response.js';

describe('convertToOpenAIChatResponse', () => {
  it('should convert a basic text response', () => {
    const result = {
      content: [{ type: 'text', text: 'Hello from GPT!' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      response: {
        id: 'chatcmpl-123',
      },
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.id).toBe('chatcmpl-123');
    expect(response.choices).toHaveLength(1);
    expect(response.choices[0].message).toMatchObject({
      role: 'assistant',
      content: 'Hello from GPT!',
    });
    expect(response.choices[0].finish_reason).toBe('stop');
    expect(response.usage).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it('should include reasoning as text content', () => {
    const result = {
      content: [
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text', text: 'Here is my answer' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.content).toBe('Let me think...Here is my answer');
  });

  it('should convert tool calls', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_abc',
          toolName: 'get_weather',
          input: { location: 'NYC' },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.tool_calls).toHaveLength(1);
    expect(response.choices[0].message.tool_calls![0]).toMatchObject({
      id: 'call_abc',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"location":"NYC"}',
      },
    });
    expect(response.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should handle null toolCallId', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolName: 'search',
          input: {},
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.tool_calls![0].id).toBeNull();
  });

  it('should map finish reasons correctly', () => {
    const testCases = [
      { input: 'stop', expected: 'stop' },
      { input: 'length', expected: 'length' },
      { input: 'tool-calls', expected: 'tool_calls' },
      { input: 'content-filter', expected: 'content_filter' },
      { input: 'error', expected: 'stop' },
      { input: 'other', expected: 'stop' },
    ];

    for (const testCase of testCases) {
      const result = {
        content: [{ type: 'text', text: 'Test' }],
        finishReason: testCase.input,
      };

      const response = convertToOpenAIChatResponse(result);
      expect(response.choices[0].finish_reason).toBe(testCase.expected);
    }
  });

  it('should build annotations from sources', () => {
    const result = {
      content: [{ type: 'text', text: 'According to sources...' }],
      sources: [
        {
          sourceType: 'url',
          url: 'https://example.com',
          title: 'Example',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.annotations).toHaveLength(1);
    expect(response.choices[0].message.annotations![0]).toMatchObject({
      type: 'url_citation',
      url_citation: {
        start_index: 0,
        end_index: 0,
        url: 'https://example.com',
        title: 'Example',
      },
    });
  });

  it('should handle multiple sources', () => {
    const result = {
      content: [{ type: 'text', text: 'Info' }],
      sources: [
        { sourceType: 'url', url: 'https://source1.com', title: 'Source 1' },
        { sourceType: 'url', url: 'https://source2.com', title: 'Source 2' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.annotations).toHaveLength(2);
  });

  it('should include cached tokens in usage', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        inputTokenDetails: {
          cacheReadTokens: 30,
        },
      },
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.usage!.prompt_tokens_details).toMatchObject({
      cached_tokens: 30,
    });
  });

  it('should include reasoning tokens in usage', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        outputTokenDetails: {
          reasoningTokens: 20,
        },
      },
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.usage!.completion_tokens_details).toMatchObject({
      reasoning_tokens: 20,
      accepted_prediction_tokens: null,
      rejected_prediction_tokens: null,
    });
  });

  it('should handle missing usage data', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.usage).toBeNull();
  });

  it('should handle empty content array', () => {
    const result = {
      content: [],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    // When content is empty, it should be null (OpenAI API behavior)
    expect(response.choices[0].message.content).toBeNull();
  });

  it('should ignore unsupported content types', () => {
    const result = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool-result', toolCallId: 'call_123', output: { type: 'text', value: 'result' } },
        { type: 'file', mediaType: 'image/png', data: 'base64data' },
        { type: 'source', url: 'https://example.com' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    // Should only include text content
    expect(response.choices[0].message.content).toBe('Hello');
  });

  it('should generate ID if not provided', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.id).toBeTruthy();
    expect(typeof response.id).toBe('string');
  });

  it('should set created timestamp', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const before = Math.floor(Date.now() / 1000);
    const response = convertToOpenAIChatResponse(result);
    const after = Math.floor(Date.now() / 1000);

    expect(response.created).toBeGreaterThanOrEqual(before);
    expect(response.created).toBeLessThanOrEqual(after);
  });

  it('should set logprobs to null', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].logprobs).toBeNull();
  });

  it('should handle content with null', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_xyz',
          toolName: 'search',
          input: {},
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIChatResponse(result);

    // Content should be null when only tool calls
    expect(response.choices[0].message.content).toBeNull();
  });

  it('should handle mixed content with text and tool calls', () => {
    const result = {
      content: [
        { type: 'text', text: 'Let me search for that' },
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'search',
          input: { query: 'test' },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.content).toBe('Let me search for that');
    expect(response.choices[0].message.tool_calls).toHaveLength(1);
  });

  it('should set choice index to 0', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].index).toBe(0);
  });

  it('should handle multiple tool calls', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'tool1',
          input: { a: 1 },
        },
        {
          type: 'tool-call',
          toolCallId: 'call_2',
          toolName: 'tool2',
          input: { b: 2 },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.tool_calls).toHaveLength(2);
    expect(response.choices[0].message.tool_calls![0].id).toBe('call_1');
    expect(response.choices[0].message.tool_calls![1].id).toBe('call_2');
  });

  it('should handle sources with missing title', () => {
    const result = {
      content: [{ type: 'text', text: 'Info' }],
      sources: [
        { sourceType: 'url', url: 'https://example.com' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIChatResponse(result);

    expect(response.choices[0].message.annotations![0]).toMatchObject({
      type: 'url_citation',
      url_citation: {
        url: 'https://example.com',
        title: '',
      },
    });
  });
});
