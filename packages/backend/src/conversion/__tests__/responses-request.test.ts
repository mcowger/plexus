import { describe, it, expect } from 'vitest';
import { convertFromOpenAIResponsesRequest, OpenAIResponsesRequest } from '../responses/request.js';

describe('convertFromOpenAIResponsesRequest', () => {
  it('should convert a basic user message', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello!' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.model).toBe('gpt-4');
    expect(result.options.prompt).toHaveLength(1);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello!' }],
    });
  });

  it('should convert system messages', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'system',
          content: 'You are helpful',
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'You are helpful',
    });
  });

  it('should convert developer role to system with warning', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'developer',
          content: 'Developer instruction',
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

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

  it('should convert assistant messages', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hi there!' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('should convert input images with URL', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'https://example.com/image.png' },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

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

  it('should convert input images with data URI', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

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

  it('should convert input images with file_id', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_image', file_id: 'file_abc123' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/*',
          data: 'file_abc123',
        },
      ],
    });
  });

  it('should convert input files with URL', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_url: 'https://example.com/doc.pdf' },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/octet-stream',
          data: new URL('https://example.com/doc.pdf'),
        },
      ],
    });
  });

  it('should convert input files with file_id', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_file', file_id: 'file_xyz789' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/octet-stream',
          data: 'file_xyz789',
        },
      ],
    });
  });

  it('should convert input files with filename and file_data', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: 'document.pdf',
              file_data: 'data:application/pdf;base64,JVBERi0xLjQK',
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

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

  it('should convert function calls', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'function_call',
          call_id: 'call_123',
          name: 'get_weather',
          arguments: '{"location": "NYC"}',
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'NYC' },
        },
      ],
    });
  });

  it('should handle invalid JSON in function call arguments', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'function_call',
          call_id: 'call_456',
          name: 'my_func',
          arguments: 'invalid json',
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.warnings).toHaveLength(1);
    expect(result.options.prompt[0].content[0]).toMatchObject({
      type: 'tool-call',
      input: { _raw: 'invalid json' },
    });
  });

  it('should convert function call outputs with string', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'function_call',
          call_id: 'call_123',
          name: 'search',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_123',
          output: '{"result": "found"}',
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    const toolMessage = result.options.prompt.find((m: any) => m.role === 'tool');
    expect(toolMessage).toBeTruthy();
    expect(toolMessage.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call_123',
      toolName: 'search',
      output: {
        type: 'json',
        value: { result: 'found' },
      },
    });
  });

  it('should convert function call outputs with content array', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'function_call',
          call_id: 'call_abc',
          name: 'get_data',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_abc',
          output: [
            { type: 'input_text', text: 'Result text' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,abc123',
            },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    const toolMessage = result.options.prompt.find((m: any) => m.role === 'tool');
    expect(toolMessage.content[0].output).toMatchObject({
      type: 'content',
      value: expect.arrayContaining([
        { type: 'text', text: 'Result text' },
        { type: 'media', mediaType: 'image/png', data: 'abc123' },
      ]),
    });
  });

  it('should convert reasoning items', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'reasoning',
          id: 'reasoning_123',
          encrypted_content: null,
          summary: [
            { type: 'summary_text', text: 'Let me think...' },
            { type: 'summary_text', text: 'The answer is...' },
          ],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'Let me think...\nThe answer is...',
        },
      ],
    });
  });

  it('should warn about encrypted reasoning content', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          type: 'reasoning',
          id: 'reasoning_123',
          encrypted_content: 'encrypted_data',
          summary: [{ type: 'summary_text', text: 'Summary' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        type: 'other',
        message: 'Encrypted reasoning content is not converted to V2 format',
      })
    );
  });

  it('should warn about unsupported input types', () => {
    const unsupportedTypes = [
      { type: 'mcp_approval_response', approval_request_id: '123', approve: true },
      { type: 'computer_call', id: '123' },
      { type: 'local_shell_call', id: '123', call_id: 'call_123', action: { type: 'exec', command: [] } },
      { type: 'local_shell_call_output', call_id: 'call_123', output: '' },
      { type: 'shell_call', id: '123', call_id: 'call_123', status: 'completed', action: { commands: [] } },
      { type: 'shell_call_output', call_id: 'call_123', output: [] },
      { type: 'apply_patch_call', call_id: 'call_123', status: 'completed', operation: { type: 'create_file', path: '', diff: '' } },
      { type: 'apply_patch_call_output', call_id: 'call_123', status: 'completed' },
      { type: 'item_reference', id: 'ref_123' },
    ];

    for (const unsupportedInput of unsupportedTypes) {
      const request: OpenAIResponsesRequest = {
        input: [unsupportedInput as any],
      };

      const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'unsupported',
        })
      );
    }
  });

  it('should convert generation parameters', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      max_output_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 12345,
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.maxOutputTokens).toBe(1024);
    expect(result.options.temperature).toBe(0.7);
    expect(result.options.topP).toBe(0.9);
    expect(result.options.frequencyPenalty).toBe(0.5);
    expect(result.options.presencePenalty).toBe(0.3);
    expect(result.options.seed).toBe(12345);
  });

  it('should convert stop sequences from string', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      stop: 'STOP',
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.stopSequences).toEqual(['STOP']);
  });

  it('should convert stop sequences from array', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      stop: ['STOP', 'END'],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.stopSequences).toEqual(['STOP', 'END']);
  });

  it('should convert response formats', () => {
    const formats = [
      { input: { type: 'text' as const }, expected: { type: 'text' } },
      { input: { type: 'json_object' as const }, expected: { type: 'json' } },
      {
        input: {
          type: 'json_schema' as const,
          json_schema: {
            name: 'Person',
            schema: { type: 'object' as const, properties: {} },
          },
        },
        expected: {
          type: 'json',
          schema: { type: 'object', properties: {} },
          name: 'Person',
        },
      },
    ];

    for (const format of formats) {
      const request: OpenAIResponsesRequest = {
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Test' }],
          },
        ],
        response_format: format.input,
      };

      const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

      expect(result.options.responseFormat).toMatchObject(format.expected);
    }
  });

  it('should convert function tools', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
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

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0]).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
      },
    });
  });

  it('should warn about provider tools', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      tools: [
        { type: 'web_search' },
        { type: 'code_interpreter' },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        type: 'other',
        message: expect.stringContaining('Provider tools'),
      })
    );
  });

  it('should convert tool choice', () => {
    const choices = [
      { input: 'auto' as const, expected: { type: 'auto' } },
      { input: 'none' as const, expected: { type: 'none' } },
      { input: 'required' as const, expected: { type: 'required' } },
      {
        input: { type: 'function' as const, function: { name: 'my_tool' } },
        expected: { type: 'tool', toolName: 'my_tool' },
      },
    ];

    for (const choice of choices) {
      const request: OpenAIResponsesRequest = {
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          },
        ],
        tool_choice: choice.input,
      };

      const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

      expect(result.options.toolChoice).toMatchObject(choice.expected);
    }
  });

  it('should handle tools with missing type in parameters', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              properties: {
                param: { type: 'string' },
              },
            } as any,
          },
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.tools![0].inputSchema).toMatchObject({
      type: 'object',
      properties: {
        param: { type: 'string' },
      },
    });
  });

  it('should handle complex input with multiple types', () => {
    const request: OpenAIResponsesRequest = {
      input: [
        {
          role: 'system',
          content: 'You are helpful',
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Question' },
            { type: 'input_image', image_url: 'https://example.com/img.png' },
          ],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'search',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'result',
        },
        {
          type: 'reasoning',
          id: 'r_1',
          encrypted_content: null,
          summary: [{ type: 'summary_text', text: 'Thinking...' }],
        },
      ],
    };

    const result = convertFromOpenAIResponsesRequest(request, 'gpt-4');

    expect(result.options.prompt.length).toBeGreaterThan(0);
    expect(result.options.prompt.some((m: any) => m.role === 'system')).toBe(true);
    expect(result.options.prompt.some((m: any) => m.role === 'user')).toBe(true);
    expect(result.options.prompt.some((m: any) => m.role === 'tool')).toBe(true);
    expect(result.options.prompt.some((m: any) => m.role === 'assistant')).toBe(true);
  });
});
