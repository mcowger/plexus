import { describe, it, expect } from 'vitest';
import { convertFromAnthropicMessagesRequest, AnthropicMessagesRequest } from '../anthropic/request.js';

describe('convertFromAnthropicMessagesRequest', () => {
  it('should convert a basic text message', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello, Claude!' }],
        },
      ],
      max_tokens: 1024,
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.options.prompt).toHaveLength(1);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello, Claude!' }],
    });
    expect(result.options.maxOutputTokens).toBe(1024);
    expect(result.warnings).toEqual([]);
  });

  it('should convert system messages', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      system: { type: 'text', text: 'You are a helpful assistant.' },
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  it('should convert multiple system messages', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      system: [
        { type: 'text', text: 'System message 1' },
        { type: 'text', text: 'System message 2' },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt).toHaveLength(3);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'System message 1',
    });
    expect(result.options.prompt[1]).toMatchObject({
      role: 'system',
      content: 'System message 2',
    });
  });

  it('should convert image content with base64', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUg==',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUg==',
        },
      ],
    });
  });

  it('should convert image content with URL', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'url',
                url: 'https://example.com/image.png',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/*',
          data: new URL('https://example.com/image.png'),
        },
      ],
    });
  });

  it('should convert document content', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'JVBERi0xLjQK',
              },
              title: 'test.pdf',
            },
          ],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: 'JVBERi0xLjQK',
          filename: 'test.pdf',
        },
      ],
    });
  });

  it('should convert assistant messages with text', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there!' }],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('should convert assistant messages with thinking', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Solve this problem' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think about this...' },
            { type: 'text', text: 'Here is the solution' },
          ],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me think about this...' },
        { type: 'text', text: 'Here is the solution' },
      ],
    });
  });

  it('should convert tool calls', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'What is the weather?' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'get_weather',
              input: { location: 'San Francisco' },
            },
          ],
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ],
    });
  });

  it('should convert temperature and sampling parameters', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      stop_sequences: ['STOP', 'END'],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.temperature).toBe(0.7);
    expect(result.options.topP).toBe(0.9);
    expect(result.options.topK).toBe(40);
    expect(result.options.stopSequences).toEqual(['STOP', 'END']);
  });

  it('should convert response format with JSON schema', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Generate JSON' }],
        },
      ],
      output_format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      },
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.responseFormat).toMatchObject({
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
    });
  });

  it('should convert tools', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0]).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather for a location',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    });
  });

  it('should convert tool choice', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          name: 'get_weather',
          input_schema: { type: 'object', properties: {} },
        },
      ],
      tool_choice: { type: 'tool', name: 'get_weather' },
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.toolChoice).toMatchObject({
      type: 'tool',
      toolName: 'get_weather',
    });
  });

  it('should handle tool choice auto', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tool_choice: 'auto',
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'auto' });
  });

  it('should handle tool choice none', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tool_choice: 'none',
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'none' });
  });

  it('should map tool choice "any" to "auto"', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tool_choice: 'any',
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'auto' });
  });

  it('should add warning for thinking configuration', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      thinking: { type: 'enabled', budget_tokens: 1000 },
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({
      type: 'other',
      message: 'Extended thinking configuration is not directly converted to V2 format',
    });
  });

  it('should handle tools with missing type in input_schema', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          name: 'my_tool',
          input_schema: {
            properties: {
              param: { type: 'string' },
            },
          } as any, // Missing type field
        },
      ],
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0].inputSchema).toMatchObject({
      type: 'object',
      properties: {
        param: { type: 'string' },
      },
    });
  });

  it('should convert multiple messages of different types', () => {
    const request: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this image' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: 'base64data',
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I can see the image.' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'What do you see?' }],
        },
      ],
      system: { type: 'text', text: 'You are a vision AI.' },
    };

    const result = convertFromAnthropicMessagesRequest(request);

    expect(result.options.prompt).toHaveLength(4);
    expect(result.options.prompt[0].role).toBe('system');
    expect(result.options.prompt[1].role).toBe('user');
    expect(result.options.prompt[2].role).toBe('assistant');
    expect(result.options.prompt[3].role).toBe('user');
  });
});
