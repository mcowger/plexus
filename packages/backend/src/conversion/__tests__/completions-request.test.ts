import { describe, it, expect } from 'vitest';
import { convertFromOpenAIChatRequest, OpenAIChatRequest } from '../completions/request.js';

describe('convertFromOpenAIChatRequest', () => {
  it('should convert a basic text message', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello, GPT!' },
      ],
      temperature: 0.7,
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.model).toBe('gpt-4');
    expect(result.options.prompt).toHaveLength(1);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello, GPT!' }],
    });
    expect(result.options.temperature).toBe(0.7);
  });

  it('should convert system messages', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  it('should convert developer role to system with warning', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'developer', content: 'Developer instruction' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'Developer instruction',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({
      type: 'other',
      message: 'developer role converted to system role (not supported in V2)',
    });
  });

  it('should convert user messages with content array', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this image:' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Look at this image:' },
        {
          type: 'file',
          mediaType: 'image/*',
          data: new URL('https://example.com/image.png'),
        },
      ],
    });
  });

  it('should convert image with data URI', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

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

  it('should convert input audio', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: 'base64audiodata', format: 'wav' },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'audio/wav',
          data: 'base64audiodata',
        },
      ],
    });
  });

  it('should convert file content with file_id', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: { file_id: 'file_abc123' },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: 'file_abc123',
        },
      ],
    });
  });

  it('should convert file content with filename and file_data', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: 'data:application/pdf;base64,JVBERi0xLjQK',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: 'JVBERi0xLjQK',
          filename: 'document.pdf',
        },
      ],
    });
  });

  it('should convert assistant messages with text', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('should convert assistant messages with tool calls', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              type: 'function',
              id: 'call_123',
              function: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

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

  it('should handle invalid JSON in tool call arguments', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              id: 'call_456',
              function: {
                name: 'my_tool',
                arguments: 'not valid json',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0].type).toBe('other');
    expect(result.options.prompt[0].content[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call_456',
      toolName: 'my_tool',
      input: { _raw: 'not valid json' },
    });
  });

  it('should convert tool messages', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              id: 'call_789',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"result": "found"}',
          tool_call_id: 'call_789',
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[1]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_789',
          toolName: 'search',
          output: {
            type: 'json',
            value: { result: 'found' },
          },
        },
      ],
    });
  });

  it('should parse tool output as text when JSON parse fails', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              id: 'call_abc',
              function: { name: 'my_tool', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          content: 'plain text result',
          tool_call_id: 'call_abc',
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[1].content[0]).toMatchObject({
      type: 'tool-result',
      output: {
        type: 'text',
        value: 'plain text result',
      },
    });
  });

  it('should convert generation parameters', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 12345,
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.maxOutputTokens).toBe(1024);
    expect(result.options.temperature).toBe(0.7);
    expect(result.options.topP).toBe(0.9);
    expect(result.options.frequencyPenalty).toBe(0.5);
    expect(result.options.presencePenalty).toBe(0.3);
    expect(result.options.seed).toBe(12345);
  });

  it('should convert stop sequences from string', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      stop: 'STOP',
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.stopSequences).toEqual(['STOP']);
  });

  it('should convert stop sequences from array', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      stop: ['STOP', 'END'],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.stopSequences).toEqual(['STOP', 'END']);
  });

  it('should convert response format text', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      response_format: { type: 'text' },
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.responseFormat).toEqual({ type: 'text' });
  });

  it('should convert response format json_object', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Generate JSON' }],
      response_format: { type: 'json_object' },
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.responseFormat).toEqual({ type: 'json' });
  });

  it('should convert response format json_schema', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Generate JSON' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Person',
          description: 'A person',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      },
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.responseFormat).toMatchObject({
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
      name: 'Person',
      description: 'A person',
    });
  });

  it('should convert tools', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather info',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0]).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather info',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
      },
    });
  });

  it('should handle tools with missing type in parameters', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              properties: {
                param: { type: 'string' },
              },
            } as any, // Missing type
          },
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect((result.options.tools![0] as { inputSchema: object }).inputSchema).toMatchObject({
      type: 'object',
      properties: {
        param: { type: 'string' },
      },
    });
  });

  it('should convert tool choice auto', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: 'auto',
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'auto' });
  });

  it('should convert tool choice none', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: 'none',
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'none' });
  });

  it('should convert tool choice required', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: 'required',
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.toolChoice).toEqual({ type: 'required' });
  });

  it('should convert specific tool choice', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tool_choice: {
        type: 'function',
        function: { name: 'get_weather' },
      },
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.toolChoice).toMatchObject({
      type: 'tool',
      toolName: 'get_weather',
    });
  });

  it('should handle multiple messages of different types', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Question 1' },
        { role: 'assistant', content: 'Answer 1' },
        { role: 'user', content: 'Question 2' },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt).toHaveLength(4);
    expect(result.options.prompt[0].role).toBe('system');
    expect(result.options.prompt[1].role).toBe('user');
    expect(result.options.prompt[2].role).toBe('assistant');
    expect(result.options.prompt[3].role).toBe('user');
  });

  it('should handle assistant message with both content and tool calls', () => {
    const request: OpenAIChatRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          content: 'Let me check that for you.',
          tool_calls: [
            {
              type: 'function',
              id: 'call_xyz',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIChatRequest(request);

    expect(result.options.prompt[0].content).toHaveLength(2);
    expect(result.options.prompt[0].content[0]).toMatchObject({
      type: 'text',
      text: 'Let me check that for you.',
    });
    expect((result.options.prompt[0].content[1] as { type: string }).type).toBe('tool-call');
  });
});
