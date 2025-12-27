import { describe, it, expect } from 'vitest';
import { convertToGoogleGenerativeAIResponse } from '../google/response.js';

describe('convertToGoogleGenerativeAIResponse', () => {
  it('should convert a basic text response', () => {
    const result = {
      content: [{ type: 'text', text: 'Hello from Gemini!' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
      },
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates).toHaveLength(1);
    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: 'Hello from Gemini!',
      thought: false,
    });
    expect(response.candidates[0].finishReason).toBe('STOP');
    expect(response.usageMetadata).toMatchObject({
      promptTokenCount: 10,
      candidatesTokenCount: 20,
    });
  });

  it('should convert reasoning content', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Let me analyze this...',
          providerMetadata: {
            google: {
              thoughtSignature: 'sig_abc123',
            },
          },
        },
        { type: 'text', text: 'Here is my answer' },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(2);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: 'Let me analyze this...',
      thought: true,
      thoughtSignature: 'sig_abc123',
    });
    expect(response.candidates[0].content?.parts[1]).toMatchObject({
      text: 'Here is my answer',
      thought: false,
    });
  });

  it('should convert reasoning without signature', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Thinking...',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: 'Thinking...',
      thought: true,
    });
    // thoughtSignature should be undefined, not included in the object
    expect((response.candidates[0].content?.parts[0] as any).thoughtSignature).toBeUndefined();
  });

  it('should convert tool calls', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolName: 'search_web',
          input: { query: 'test query' },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      functionCall: {
        name: 'search_web',
        args: { query: 'test query' },
      },
    });
    expect(response.candidates[0].finishReason).toBe('FUNCTION_CALL');
  });

  it('should parse string input as JSON for tool calls', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolName: 'my_func',
          input: '{"key": "value"}',
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    const functionCall = (response.candidates[0].content?.parts[0] as any).functionCall;
    expect(functionCall.args).toEqual({ key: 'value' });
  });

  it('should handle invalid JSON in tool call input', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolName: 'my_func',
          input: 'not valid json',
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    const functionCall = (response.candidates[0].content?.parts[0] as any).functionCall;
    expect(functionCall.args).toBe('not valid json');
  });

  it('should map finish reasons correctly', () => {
    const testCases = [
      { input: 'stop', expected: 'STOP' },
      { input: 'length', expected: 'MAX_TOKENS' },
      { input: 'tool-calls', expected: 'FUNCTION_CALL' },
      { input: 'content-filter', expected: 'SAFETY' },
      { input: 'error', expected: 'OTHER' },
      { input: 'other', expected: 'OTHER' },
    ];

    for (const testCase of testCases) {
      const result = {
        content: [{ type: 'text', text: 'Test' }],
        finishReason: testCase.input,
      };

      const response = convertToGoogleGenerativeAIResponse(result);
      expect(response.candidates[0].finishReason).toBe(testCase.expected);
    }
  });

  it('should build grounding metadata from sources', () => {
    const result = {
      content: [{ type: 'text', text: 'Information from sources' }],
      sources: [
        {
          sourceType: 'url',
          url: 'https://example.com',
          title: 'Example Page',
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].groundingMetadata).toBeTruthy();
    expect(response.candidates[0].groundingMetadata?.groundingChunks).toHaveLength(1);
    expect(response.candidates[0].groundingMetadata?.groundingChunks![0]).toMatchObject({
      web: {
        uri: 'https://example.com',
        title: 'Example Page',
      },
    });
  });

  it('should handle multiple sources', () => {
    const result = {
      content: [{ type: 'text', text: 'Info' }],
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

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].groundingMetadata?.groundingChunks).toHaveLength(2);
  });

  it('should include usage metadata with cache tokens', () => {
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

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.usageMetadata).toMatchObject({
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
      cachedContentTokenCount: 30,
    });
  });

  it('should handle missing usage data', () => {
    const result = {
      content: [{ type: 'text', text: 'Response' }],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.usageMetadata).toBeNull();
  });

  it('should handle empty content array', () => {
    const result = {
      content: [],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: '',
      thought: false,
    });
  });

  it('should ignore unsupported content types', () => {
    const result = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool-result', toolCallId: 'call_123', output: { type: 'text', value: 'result' } },
        { type: 'source', url: 'https://example.com' },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    // Should only include text content
    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: 'Hello',
      thought: false,
    });
  });

  it('should set content role to model', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.role).toBe('model');
  });

  it('should set safety ratings and prompt feedback to null', () => {
    const result = {
      content: [{ type: 'text', text: 'Test' }],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].safetyRatings).toBeNull();
    expect(response.promptFeedback).toBeNull();
  });

  it('should handle file content with string data', () => {
    const result = {
      content: [
        {
          type: 'file',
          file: {
            mimeType: 'image/png',
            data: 'base64data',
          },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      inlineData: {
        mimeType: 'image/png',
        data: 'base64data',
      },
    });
  });

  it('should handle file content with URL data', () => {
    const result = {
      content: [
        {
          type: 'file',
          file: {
            mimeType: 'application/pdf',
            data: new URL('gs://bucket/file.pdf'),
          },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      fileData: {
        mimeType: 'application/pdf',
        fileUri: 'gs://bucket/file.pdf',
      },
    });
  });

  it('should handle file without data', () => {
    const result = {
      content: [
        {
          type: 'file',
          file: {
            mimeType: 'image/png',
          },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    // Should not add any parts for file without data
    expect(response.candidates[0].content?.parts).toHaveLength(1);
    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: '',
      thought: false,
    });
  });

  it('should handle mixed content types', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Analyzing...',
          providerMetadata: { google: { thoughtSignature: 'sig' } },
        },
        { type: 'text', text: 'First part' },
        {
          type: 'tool-call',
          toolName: 'search',
          input: { q: 'test' },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts).toHaveLength(3);
    expect((response.candidates[0].content?.parts[0] as any).thought).toBe(true);
    expect((response.candidates[0].content?.parts[1] as any).thought).toBe(false);
    expect((response.candidates[0].content?.parts[2] as any).functionCall).toBeTruthy();
  });

  it('should handle thought signature from alternative metadata path', () => {
    const result = {
      content: [
        {
          type: 'reasoning',
          text: 'Thinking...',
          providerMetadata: {
            google: {
              signature: 'sig_from_signature_field',
            },
          },
        },
      ],
      finishReason: 'stop',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect(response.candidates[0].content?.parts[0]).toMatchObject({
      text: 'Thinking...',
      thought: true,
      thoughtSignature: 'sig_from_signature_field',
    });
  });

  it('should add thoughtSignature to function call if available', () => {
    const result = {
      content: [
        {
          type: 'tool-call',
          toolName: 'my_tool',
          input: { arg: 'value' },
          providerMetadata: {
            google: {
              thoughtSignature: 'call_sig',
            },
          },
        },
      ],
      finishReason: 'tool-calls',
    };

    const response = convertToGoogleGenerativeAIResponse(result);

    expect((response.candidates[0].content?.parts[0] as any).thoughtSignature).toBe('call_sig');
  });
});
