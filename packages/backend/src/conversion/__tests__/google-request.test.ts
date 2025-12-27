import { describe, it, expect } from 'vitest';
import { convertFromGoogleGenerativeAIRequest, GoogleGenerativeAIRequest } from '../google/request.js';

describe('convertFromGoogleGenerativeAIRequest', () => {
  it('should convert a basic text message', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello, Gemini!' }],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.model).toBe('gemini-1.5-pro');
    expect(result.options.prompt).toHaveLength(1);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello, Gemini!' }],
    });
  });

  it('should convert system instructions', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      systemInstruction: {
        parts: [{ text: 'You are a helpful assistant.' }],
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[0]).toMatchObject({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  it('should convert multiple system instructions', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      systemInstruction: {
        parts: [
          { text: 'System instruction 1' },
          { text: 'System instruction 2' },
        ],
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt).toHaveLength(3);
    expect(result.options.prompt[0].role).toBe('system');
    expect(result.options.prompt[1].role).toBe('system');
    expect(result.options.prompt[2].role).toBe('user');
  });

  it('should convert inline image data', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUg==',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

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

  it('should convert file data with URI', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                mimeType: 'application/pdf',
                fileUri: 'gs://bucket/file.pdf',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: new URL('gs://bucket/file.pdf'),
        },
      ],
    });
  });

  it('should convert model messages with text', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Hi there!' }],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt).toHaveLength(2);
    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('should convert model messages with thought/reasoning', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Solve this' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'Let me analyze...', thought: true },
            { text: 'Here is the solution' },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me analyze...' },
        { type: 'text', text: 'Here is the solution' },
      ],
    });
  });

  it('should convert function calls', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'What is the weather?' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'New York' },
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'get_weather',
          toolName: 'get_weather',
          input: { location: 'New York' },
        },
      ],
    });
  });

  it('should convert function responses to tool messages', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                response: { temperature: 72, conditions: 'sunny' },
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    // Should create a user message plus a tool message
    const toolMessage = result.options.prompt.find((m: any) => m.role === 'tool');
    expect(toolMessage).toBeTruthy();
    expect(toolMessage).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'get_weather',
          toolName: 'get_weather',
          output: {
            type: 'json',
            value: { temperature: 72, conditions: 'sunny' },
          },
        },
      ],
    });
  });

  it('should convert generation config parameters', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
        stopSequences: ['STOP', 'END'],
        seed: 12345,
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.maxOutputTokens).toBe(1024);
    expect(result.options.temperature).toBe(0.7);
    expect(result.options.topK).toBe(40);
    expect(result.options.topP).toBe(0.95);
    expect(result.options.frequencyPenalty).toBe(0.5);
    expect(result.options.presencePenalty).toBe(0.5);
    expect(result.options.stopSequences).toEqual(['STOP', 'END']);
    expect(result.options.seed).toBe(12345);
  });

  it('should convert JSON response format', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Generate JSON' }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.responseFormat).toMatchObject({
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
    });
  });

  it('should convert JSON response format without schema', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Generate JSON' }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.responseFormat).toMatchObject({
      type: 'json',
    });
  });

  it('should convert tools', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0]).toMatchObject({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather information',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    });
  });

  it('should convert tool config with AUTO mode', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.toolChoice).toEqual({ type: 'auto' });
  });

  it('should convert tool config with NONE mode', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: 'NONE',
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.toolChoice).toEqual({ type: 'none' });
  });

  it('should convert tool config with ANY mode to auto', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.toolChoice).toEqual({ type: 'auto' });
  });

  it('should convert tool config with allowed function names', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO',
          allowedFunctionNames: ['get_weather', 'get_time'],
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.toolChoice).toMatchObject({
      type: 'tool',
      toolName: 'get_weather',
    });
  });

  it('should add warning for thinking config', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 1000,
          includeThoughts: true,
        },
      },
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({
      type: 'other',
      message: 'Extended thinking configuration is not directly converted to V2 format',
    });
  });

  it('should add warning for safety settings', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      safetySettings: [
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE',
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({
      type: 'other',
      message: 'Safety settings are not converted to V2 format',
    });
  });

  it('should handle tools with missing type in parameters', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'my_tool',
              parameters: {
                properties: {
                  param: { type: 'string' },
                },
              } as any, // Missing type field
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.tools).toHaveLength(1);
    expect(result.options.tools![0].inputSchema).toMatchObject({
      type: 'object',
      properties: {
        param: { type: 'string' },
      },
    });
  });

  it('should handle multiple function declarations', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'tool1',
              parameters: { type: 'object', properties: {} },
            },
            {
              name: 'tool2',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.tools).toHaveLength(2);
    expect(result.options.tools![0].name).toBe('tool1');
    expect(result.options.tools![1].name).toBe('tool2');
  });

  it('should handle model messages with unsupported media content', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'model',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'base64data',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt[0]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '[Unsupported content type: image/png]',
        },
      ],
    });
  });

  it('should parse function response as text when JSON parse fails', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_data',
                response: 'plain text response',
              },
            },
          ],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    const toolMessage = result.options.prompt.find((m: any) => m.role === 'tool');
    expect(toolMessage?.content[0].output).toMatchObject({
      type: 'text',
      value: 'plain text response',
    });
  });

  it('should handle multiple contents with mixed roles', () => {
    const request: GoogleGenerativeAIRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Question 1' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Answer 1' }],
        },
        {
          role: 'user',
          parts: [{ text: 'Question 2' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Answer 2' }],
        },
      ],
    };

    const result = convertFromGoogleGenerativeAIRequest(request, 'gemini-1.5-pro');

    expect(result.options.prompt).toHaveLength(4);
    expect(result.options.prompt[0].role).toBe('user');
    expect(result.options.prompt[1].role).toBe('assistant');
    expect(result.options.prompt[2].role).toBe('user');
    expect(result.options.prompt[3].role).toBe('assistant');
  });
});
