import { test, expect, describe } from 'bun:test';
import { OllamaTransformer } from '../ollama';
import { UnifiedChatRequest, UnifiedChatStreamChunk } from '../../types/unified';

describe('OllamaTransformer', () => {
  const transformer = new OllamaTransformer();

  describe('name and endpoint', () => {
    test('should have correct name and default endpoint', () => {
      expect(transformer.name).toBe('ollama');
      expect(transformer.defaultEndpoint).toBe('/api/chat');
    });
  });

  describe('transformRequest', () => {
    test('should transform basic unified request to Ollama format', async () => {
      const request: UnifiedChatRequest = {
        model: 'llama3',
        messages: [
          { role: 'user', content: 'Hello, how are you?' },
          { role: 'assistant', content: 'I am doing well!' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        stream: false,
      };

      const result = await transformer.transformRequest(request);

      expect(result.model).toBe('llama3');
      expect(result.stream).toBe(false);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello, how are you?' });
      expect(result.messages[1]).toEqual({ role: 'assistant', content: 'I am doing well!' });
      expect(result.messages[2]).toEqual({ role: 'user', content: 'What is 2+2?' });
    });

    test('should map max_tokens to options.num_predict', async () => {
      const request: UnifiedChatRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      const result = await transformer.transformRequest(request);

      expect(result.options.num_predict).toBe(100);
    });

    test('should map temperature to options.temperature', async () => {
      const request: UnifiedChatRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      };

      const result = await transformer.transformRequest(request);

      expect(result.options.temperature).toBe(0.7);
    });

    test('should include tools in the request', async () => {
      const request: UnifiedChatRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather',
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

      const result = await transformer.transformRequest(request);

      expect(result.tools).toBeDefined();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].function.name).toBe('get_weather');
    });

    test('should handle stream true', async () => {
      const request: UnifiedChatRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const result = await transformer.transformRequest(request);

      expect(result.stream).toBe(true);
    });
  });

  describe('transformResponse', () => {
    test('should transform basic Ollama response to unified format', async () => {
      const ollamaResponse = {
        model: 'llama3',
        created_at: '2023-08-04T08:52:19.385406Z',
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        done: true,
        prompt_eval_count: 10,
        eval_count: 20,
      };

      const result = await transformer.transformResponse(ollamaResponse);

      expect(result.id).toBeDefined();
      expect(result.model).toBe('llama3');
      expect(result.content).toBe('Hello! How can I help you today?');
      expect(result.usage).toBeDefined();
      expect(result.usage?.input_tokens).toBe(10);
      expect(result.usage?.output_tokens).toBe(20);
      expect(result.usage?.total_tokens).toBe(30);
      expect(result.finishReason).toBe('stop'); // done true, so finish_reason is 'stop'
    });

    test('should extract done_reason as finish_reason', async () => {
      const ollamaResponse = {
        model: 'llama3',
        created_at: '2023-08-04T08:52:19.385406Z',
        message: {
          role: 'assistant',
          content: 'Done!',
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 10,
      };

      const result = await transformer.transformResponse(ollamaResponse);

      expect(result.finishReason).toBe('stop');
    });

    test('should handle tool calls in response', async () => {
      const ollamaResponse = {
        model: 'llama3',
        created_at: '2023-08-04T08:52:19.385406Z',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          ],
        },
        done: true,
      };

      const result = await transformer.transformResponse(ollamaResponse);

      expect(result.tool_calls).toBeDefined();
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls?.[0]?.function.name).toBe('get_weather');
    });

    test('should handle missing usage gracefully', async () => {
      const ollamaResponse = {
        model: 'llama3',
        message: {
          role: 'assistant',
          content: 'Hello',
        },
        done: true,
      };

      const result = await transformer.transformResponse(ollamaResponse);

      expect(result.usage).toBeUndefined();
    });
  });

  describe('formatResponse', () => {
    test('should format unified response to OpenAI-compatible output', async () => {
      const unifiedResponse = {
        id: 'test-id',
        model: 'llama3',
        created: 1691143939,
        content: 'Hello! How can I help?',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0,
        },
        finishReason: 'stop',
      };

      const result = await transformer.formatResponse(unifiedResponse);

      expect(result.id).toBe('test-id');
      expect(result.object).toBe('chat.completion');
      expect(result.model).toBe('llama3');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello! How can I help?');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage).toBeDefined();
      expect(result.usage.prompt_tokens).toBe(10);
      expect(result.usage.completion_tokens).toBe(20);
    });

    test('should use tool_calls finish_reason when tool_calls present', async () => {
      const unifiedResponse = {
        id: 'test-id',
        model: 'llama3',
        created: 1691143939,
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'get_weather', arguments: '{}' },
          },
        ],
      };

      const result = await transformer.formatResponse(unifiedResponse);

      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });
  });

  describe('transformStream', () => {
    test('should parse NDJSON stream to unified chunks', async () => {
      // Create NDJSON stream
      const ndjsonLines = [
        JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'Hello' } }),
        JSON.stringify({ model: 'llama3', message: { content: ' world' } }),
        JSON.stringify({
          model: 'llama3',
          message: { content: '!' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 5,
          eval_count: 10,
        }),
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const line of ndjsonLines) {
            controller.enqueue(new TextEncoder().encode(line + '\n'));
          }
          controller.close();
        },
      });

      const unifiedStream = transformer.transformStream(stream);
      const reader = unifiedStream.getReader();
      const chunks: UnifiedChatStreamChunk[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]?.delta.content).toBe('Hello');
      expect(chunks[1]?.delta.content).toBe(' world');
      expect(chunks[2]?.delta.content).toBe('!');
      expect(chunks[2]?.finish_reason).toBe('stop');
      expect(chunks[2]?.usage).toBeDefined();
      expect(chunks[2]?.usage?.input_tokens).toBe(5);
      expect(chunks[2]?.usage?.output_tokens).toBe(10);
    });
  });

  describe('formatStream', () => {
    test('should format unified stream to OpenAI SSE format', async () => {
      const unifiedStream = new ReadableStream<UnifiedChatStreamChunk>({
        start(controller) {
          controller.enqueue({
            id: 'test-id',
            model: 'llama3',
            created: 1691143939,
            delta: { role: 'assistant', content: 'Hello' },
          });
          controller.enqueue({
            id: 'test-id',
            model: 'llama3',
            created: 1691143939,
            delta: { content: ' world' },
            finish_reason: 'stop',
            usage: {
              input_tokens: 5,
              output_tokens: 10,
              total_tokens: 15,
              reasoning_tokens: 0,
              cached_tokens: 0,
              cache_creation_tokens: 0,
            },
          });
          controller.close();
        },
      });

      const sseStream = transformer.formatStream(unifiedStream);
      const reader = sseStream.getReader();
      const decoder = new TextDecoder();
      let output = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }

      // Should have SSE format
      expect(output).toContain('data: ');
      expect(output).toContain('chat.completion.chunk');
      expect(output).toContain('[DONE]');

      // Parse the chunks
      const lines = output.split('\n\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);

      const firstChunk = JSON.parse((lines[0] ?? '').replace('data: ', ''));
      expect(firstChunk.object).toBe('chat.completion.chunk');
      expect(firstChunk.choices?.[0]?.delta.content).toBe('Hello');

      const lastLine = lines[lines.length - 1];
      expect(lastLine).toBe('data: [DONE]');
    });
  });

  describe('extractUsage', () => {
    test('should extract usage from Ollama response format', () => {
      const dataStr = JSON.stringify({
        model: 'llama3',
        prompt_eval_count: 15,
        eval_count: 25,
        done: true,
      });

      const usage = transformer.extractUsage(dataStr);

      expect(usage).toBeDefined();
      expect(usage?.input_tokens).toBe(15);
      expect(usage?.output_tokens).toBe(25);
      expect(usage?.total_tokens).toBe(40);
    });

    test('should return undefined for invalid JSON', () => {
      const usage = transformer.extractUsage('not valid json');

      expect(usage).toBeUndefined();
    });

    test('should return undefined when usage fields missing', () => {
      const usage = transformer.extractUsage(JSON.stringify({ model: 'llama3' }));

      expect(usage).toBeUndefined();
    });
  });
});
