import { describe, it, expect } from 'vitest';
import { convertToAnthropicMessagesResponse } from '../anthropic/response.js';

describe('convertToAnthropicMessagesResponse', () => {
  it('should convert a basic text response', () => {
    const result = {
      content: [{ type: 'text', text: 'Hello, how can I help you?' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
      },
      response: {
        id: 'msg_123',
        model: 'claude-3-5-sonnet-20241022',
      },
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.type).toBe('message');
    expect(response.id).toBe('msg_123');
    expect(response.model).toBe('claude-3-5-sonnet-20241022');
    expect(response.stop_reason).toBe('end_turn');
    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: 'Hello, how can I help you?',
    });
    expect(response.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 20,
    });
  });

  it('should convert reasoning content', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Let me think about this problem...',
          providerMetadata: {
            anthropic: {
              signature: 'sig_abc123',
            },
          },
        },
        { type: 'text', text: 'Here is my answer.' },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content).toHaveLength(2);
    expect(response.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Let me think about this problem...',
      signature: 'sig_abc123',
    });
    expect(response.content[1]).toMatchObject({
      type: 'text',
      text: 'Here is my answer.',
    });
  });

  it('should convert reasoning without signature to redacted thinking', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Some private reasoning',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'redacted_thinking',
      data: Buffer.from('Some private reasoning').toString('base64'),
    });
  });

  it('should convert tool calls', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_456',
          toolName: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'tool_use',
      id: 'call_456',
      name: 'get_weather',
      input: { location: 'San Francisco' },
    });
    expect(response.stop_reason).toBe('tool_use');
  });

  it('should handle tool call with providerExecuted', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_789',
          toolName: 'execute_code',
          input: { code: 'print("hello")' },
          providerExecuted: true,
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content[0]).toMatchObject({
      type: 'tool_use',
      id: 'call_789',
      name: 'execute_code',
      input: { code: 'print("hello")' },
      caller: {
        type: 'code_execution_20250825',
        tool_id: 'call_789',
      },
    });
  });

  it('should add citations to first text block', () => {
    const result = {
      content: [
        { type: 'text', text: 'According to sources...' },
        { type: 'text', text: 'Additional information.' },
      ],
      sources: [
        {
          sourceType: 'url',
          url: 'https://example.com',
          title: 'Example Page',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content[0]).toHaveProperty('citations');
    const firstBlock = response.content[0] as any;
    expect(firstBlock.citations).toHaveLength(1);
    expect(firstBlock.citations[0]).toMatchObject({
      type: 'web_search_result_location',
      url: 'https://example.com',
      title: 'Example Page',
      start: 0,
      end: 0,
    });
    // Second text block should not have citations
    expect(response.content[1]).not.toHaveProperty('citations');
  });

  it('should map finish reasons correctly', () => {
    const testCases = [
      { input: 'stop', expected: 'end_turn' },
      { input: 'length', expected: 'max_tokens' },
      { input: 'tool-calls', expected: 'tool_use' },
      { input: 'content-filter', expected: 'safety' },
      { input: 'error', expected: 'error' },
      { input: 'other', expected: 'end_turn' },
    ];

    for (const testCase of testCases) {
      const result = {
        content: [{ type: 'text', text: 'Test' }],
        finishReason: testCase.input,
      };

      const response = convertToAnthropicMessagesResponse(result);
      expect(response.stop_reason).toBe(testCase.expected);
    }
  });

  it('should include usage details with cache tokens', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheWriteTokens: 20,
          cacheReadTokens: 30,
        },
      },
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
    });
  });

  it('should handle missing usage data', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.usage).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });
  });

  it('should handle empty content array', () => {
    const result = {
      content: [],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: '',
    });
  });

  it('should ignore unsupported content types', () => {
    const result = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool-result', toolCallId: 'call_123', output: { type: 'text', value: 'result' } },
        { type: 'file', mediaType: 'image/png', data: 'base64data' },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    // Should only include text content
    expect(response.content).toHaveLength(1);
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: 'Hello',
    });
  });

  it('should generate ID if not provided', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.id).toBeTruthy();
    expect(typeof response.id).toBe('string');
  });

  it('should handle model from request if not in response', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
      request: {
        model: 'claude-3-opus-20240229',
      },
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.model).toBe('claude-3-opus-20240229');
  });

  it('should set container and context_management to null', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.container).toBeNull();
    expect(response.context_management).toBeNull();
  });

  it('should handle multiple citations', () => {
    const result = {
      content: [{ type: 'text', text: 'Information from multiple sources' }],
      sources: [
        {
          sourceType: 'url',
          url: 'https://source1.com',
          title: 'Source 1',
        },
        {
          sourceType: 'url',
          url: 'https://source2.com',
          title: 'Source 2',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    const firstBlock = response.content[0] as any;
    expect(firstBlock.citations).toHaveLength(2);
    expect(firstBlock.citations[0].url).toBe('https://source1.com');
    expect(firstBlock.citations[1].url).toBe('https://source2.com');
  });

  it('should handle mixed content types', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Thinking...',
          providerMetadata: {
            anthropic: {
              signature: 'sig_xyz',
            },
          },
        },
        { type: 'text', text: 'First part' },
        {
          type: 'tool-call',
          toolCallId: 'call_001',
          toolName: 'search',
          input: { query: 'test' },
        },
        { type: 'text', text: 'Second part' },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content).toHaveLength(4);
    expect(response.content[0].type).toBe('thinking');
    expect(response.content[1].type).toBe('text');
    expect(response.content[2].type).toBe('tool_use');
    expect(response.content[3].type).toBe('text');
  });

  it('should use rawFinishReason as stop_sequence', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
      rawFinishReason: 'CUSTOM_STOP',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.stop_sequence).toBe('CUSTOM_STOP');
  });

  it('should handle reasoning with thoughtSignature metadata', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Complex reasoning',
          providerMetadata: {
            anthropic: {
              thoughtSignature: 'thought_sig_123',
            },
          },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToAnthropicMessagesResponse(result);

    expect(response.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Complex reasoning',
      signature: 'thought_sig_123',
    });
  });
});
