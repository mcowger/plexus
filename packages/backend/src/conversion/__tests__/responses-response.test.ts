import { describe, it, expect } from 'vitest';
import { convertToOpenAIResponsesResponse } from '../responses/response.js';

describe('convertToOpenAIResponsesResponse', () => {
  it('should convert a basic text response', () => {
    const result = {
      content: [{ type: 'text', text: 'Hello from GPT!' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
      },
      response: {
        id: 'resp_123',
        model: 'gpt-4',
      },
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.id).toBe('resp_123');
    expect(response.model).toBe('gpt-4');
    expect(response.output).toHaveLength(1);
    expect(response.output![0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'Hello from GPT!',
          logprobs: null,
          annotations: [],
        },
      ],
    });
    expect(response.incomplete_details).toBeNull();
  });

  it('should convert reasoning separately', () => {
    const result = {
      content: [
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text', text: 'Here is the answer' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(2);
    expect(response.output![0]).toMatchObject({
      type: 'reasoning',
      encrypted_content: null,
      summary: [
        {
          type: 'summary_text',
          text: 'Let me think...',
        },
      ],
    });
    expect(response.output![1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'Here is the answer',
        },
      ],
    });
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

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(1);
    expect(response.output![0]).toMatchObject({
      type: 'function_call',
      call_id: 'call_abc',
      name: 'get_weather',
      arguments: '{"location":"NYC"}',
    });
  });

  it('should flush accumulated text before reasoning', () => {
    const result = {
      content: [
        { type: 'text', text: 'First part ' },
        { type: 'text', text: 'second part' },
        { type: 'reasoning', text: 'Thinking...' },
        { type: 'text', text: 'Third part' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(3);
    expect(response.output![0].type).toBe('message');
    expect((response.output![0] as any).content[0].text).toBe('First part second part');
    expect(response.output![1].type).toBe('reasoning');
    expect(response.output![2].type).toBe('message');
    expect((response.output![2] as any).content[0].text).toBe('Third part');
  });

  it('should flush accumulated text before tool calls', () => {
    const result = {
      content: [
        { type: 'text', text: 'Let me search' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'search',
          input: {},
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(2);
    expect(response.output![0].type).toBe('message');
    expect(response.output![1].type).toBe('function_call');
  });

  it('should add annotations from sources to first text block', () => {
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

    const response = convertToOpenAIResponsesResponse(result);

    const messageOutput = response.output![0] as any;
    expect(messageOutput.content[0].annotations).toHaveLength(1);
    expect(messageOutput.content[0].annotations[0]).toMatchObject({
      type: 'url_citation',
      start_index: 0,
      end_index: 0,
      url: 'https://example.com',
      title: 'Example',
    });
  });

  it('should include usage metadata', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 30,
        },
        outputTokenDetails: {
          reasoningTokens: 20,
        },
      },
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.usage).toMatchObject({
      input_tokens: 100,
      input_tokens_details: {
        cached_tokens: 30,
      },
      output_tokens: 50,
      output_tokens_details: {
        reasoning_tokens: 20,
      },
    });
  });

  it('should handle missing usage data', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.usage).toBeUndefined();
  });

  it('should set incomplete_details when finishReason is not stop', () => {
    const reasons = ['length', 'tool-calls', 'content-filter', 'error'];

    for (const reason of reasons) {
      const result = {
        content: [{ type: 'text', text: 'Test' }],
        finishReason: reason,
      };

      const response = convertToOpenAIResponsesResponse(result);

      expect(response.incomplete_details).toMatchObject({
        reason,
      });
    }
  });

  it('should not set incomplete_details for stop finish reason', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.incomplete_details).toBeNull();
  });

  it('should handle empty content array', () => {
    const result = {
      content: [],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(1);
    expect(response.output![0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '',
          logprobs: null,
          annotations: [],
        },
      ],
    });
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

    const response = convertToOpenAIResponsesResponse(result);

    // Should only include text content
    expect(response.output).toHaveLength(1);
    expect(response.output![0].type).toBe('message');
  });

  it('should generate ID if not provided', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.id).toBeTruthy();
    expect(typeof response.id).toBe('string');
  });

  it('should set created_at timestamp', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const before = Math.floor(Date.now() / 1000);
    const response = convertToOpenAIResponsesResponse(result);
    const after = Math.floor(Date.now() / 1000);

    expect(response.created_at).toBeGreaterThanOrEqual(before);
    expect(response.created_at).toBeLessThanOrEqual(after);
  });

  it('should set error to null', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.error).toBeNull();
  });

  it('should set service_tier to null', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.service_tier).toBeNull();
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

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(2);
    expect(response.output![0].type).toBe('function_call');
    expect(response.output![1].type).toBe('function_call');
  });

  it('should handle mixed content types', () => {
    const result = {
      content: [
        { type: 'text', text: 'Start' },
        { type: 'reasoning', text: 'Thinking' },
        { type: 'text', text: 'Middle' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'search',
          input: {},
        },
        { type: 'text', text: 'End' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    // Should flush: Start, Thinking, Middle, Search, End (5 items)
    expect(response.output).toHaveLength(5);
    expect(response.output![0].type).toBe('message');
    expect(response.output![1].type).toBe('reasoning');
    expect(response.output![2].type).toBe('message');
    expect(response.output![3].type).toBe('function_call');
    expect(response.output![4].type).toBe('message');
  });

  it('should handle sources with missing title', () => {
    const result = {
      content: [{ type: 'text', text: 'Info' }],
      sources: [
        { sourceType: 'url', url: 'https://example.com' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    const messageOutput = response.output![0] as any;
    expect(messageOutput.content[0].annotations[0]).toMatchObject({
      type: 'url_citation',
      url: 'https://example.com',
      title: '',
    });
  });

  it('should accumulate multiple text parts', () => {
    const result = {
      content: [
        { type: 'text', text: 'Part 1 ' },
        { type: 'text', text: 'Part 2 ' },
        { type: 'text', text: 'Part 3' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.output).toHaveLength(1);
    const messageOutput = response.output![0] as any;
    expect(messageOutput.content[0].text).toBe('Part 1 Part 2 Part 3');
  });

  it('should handle model from request if not in response', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
      request: {
        model: 'gpt-4-turbo',
      },
    };

    const response = convertToOpenAIResponsesResponse(result);

    expect(response.model).toBe('gpt-4-turbo');
  });

  it('should generate unique IDs for each output item', () => {
    const result = {
      content: [
        { type: 'text', text: 'Text 1' },
        { type: 'reasoning', text: 'Thinking' },
        { type: 'text', text: 'Text 2' },
      ],
      finishReason: 'stop',
    };

    const response = convertToOpenAIResponsesResponse(result);

    const ids = response.output!.map((item: any) => item.id);
    // Check that all IDs are unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});
