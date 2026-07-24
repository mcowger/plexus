import { describe, test, expect } from 'vitest';
import { OpenAICompletionTransformer } from '../completions';

describe('OpenAICompletionTransformer', () => {
  const transformer = new OpenAICompletionTransformer();

  describe('parseRequest', () => {
    test('should parse simple text prompt and create fallback chat messages', async () => {
      const input = {
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'function add(a, b) {',
        max_tokens: 50,
        temperature: 0.2,
      };

      const request = await transformer.parseRequest(input);

      expect(request.prompt).toBe('function add(a, b) {');
      expect(request.suffix).toBeNull();
      expect(request.model).toBe('gpt-3.5-turbo-instruct');
      expect(request.max_tokens).toBe(50);
      expect(request.temperature).toBe(0.2);
      expect(request.messages).toHaveLength(2);
      expect(request.messages?.[0]?.role).toBe('system');
      expect(request.messages?.[1]?.content).toBe('function add(a, b) {');
    });

    test('should parse prompt with suffix (Fill-In-Middle)', async () => {
      const input = {
        model: 'code-model',
        prompt: 'def hello():\n    ',
        suffix: '\n    return True',
        max_tokens: 30,
      };

      const request = await transformer.parseRequest(input);

      expect(request.prompt).toBe('def hello():\n    ');
      expect(request.suffix).toBe('\n    return True');
      expect(request.messages?.[1]?.content).toContain('<FILL_HERE>');
      expect(request.messages?.[1]?.content).toContain('def hello():\n    ');
      expect(request.messages?.[1]?.content).toContain('\n    return True');
    });
  });

  describe('transformRequest', () => {
    test('should build direct completion payload when incoming is same API type', async () => {
      const input = {
        model: 'text-davinci-003',
        prompt: 'Once upon a time',
        max_tokens: 100,
        temperature: 0.7,
        stream: false,
      };
      const parsed = await transformer.parseRequest(input);

      const transformed = await transformer.transformRequest(parsed);

      expect(transformed.model).toBe('text-davinci-003');
      expect(transformed.prompt).toBe('Once upon a time');
      expect(transformed.max_tokens).toBe(100);
    });
  });

  describe('formatResponse', () => {
    test('should format non-streaming response into text_completion object', async () => {
      const unifiedResponse = {
        id: 'cmpl-test-123',
        model: 'gpt-3.5-turbo-instruct',
        created: 1700000000,
        content: 'return a + b;\n}',
        finishReason: 'stop',
        usage: {
          input_tokens: 10,
          output_tokens: 6,
          total_tokens: 16,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0,
        },
      };

      const formatted = await transformer.formatResponse(unifiedResponse);

      expect(formatted.object).toBe('text_completion');
      expect(formatted.id).toBe('cmpl-test-123');
      expect(formatted.model).toBe('gpt-3.5-turbo-instruct');
      expect(formatted.choices).toHaveLength(1);
      expect(formatted.choices[0].text).toBe('return a + b;\n}');
      expect(formatted.choices[0].finish_reason).toBe('stop');
      expect(formatted.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      });
    });
  });

  describe('formatStream', () => {
    test('should format stream chunks into text_completion SSE format', async () => {
      const chunks = [
        {
          id: 'cmpl-stream-1',
          created: 1700000000,
          model: 'code-model',
          delta: { content: 'return ' },
          finish_reason: null,
        },
        {
          id: 'cmpl-stream-1',
          created: 1700000000,
          model: 'code-model',
          delta: { content: 'a + b;' },
          finish_reason: 'stop',
        },
      ];

      const inputStream = new ReadableStream({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(c));
          controller.close();
        },
      });

      const formattedStream = transformer.formatStream(inputStream);
      const reader = formattedStream.getReader();
      const decoder = new TextDecoder();

      let outputText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        outputText += decoder.decode(value);
      }

      expect(outputText).toContain('data: ');
      expect(outputText).toContain('text_completion');
      expect(outputText).toContain('return ');
      expect(outputText).toContain('a + b;');
      expect(outputText).toContain('[DONE]');
    });
  });
});
