import { test, expect, describe } from 'vitest';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { formatGeminiStream } from '../stream-formatter';

async function readAllChunks(stream: ReadableStream): Promise<any[]> {
  const reader = stream.getReader();
  const chunks: any[] = [];
  const decoder = new TextDecoder();
  let parser: any;

  return new Promise((resolve) => {
    parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === '[DONE]') return;
        try {
          chunks.push({ event: event.event, data: JSON.parse(event.data) });
        } catch {
          // ignore malformed events
        }
      },
    });

    const read = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          resolve(chunks);
          break;
        }
        parser.feed(decoder.decode(value, { stream: true }));
      }
    };

    read();
  });
}

describe('formatGeminiStream', () => {
  test('should format usage event correctly', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-3-flash-preview',
          created: Date.now(),
          event: 'usage',
          delta: {},
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
            reasoning_tokens: 10,
            cached_tokens: 20,
            cache_creation_tokens: 0,
            upstream_inference_cost: 0.001,
            upstream_inference_prompt_cost: 0.0004,
            upstream_inference_completions_cost: 0.0006,
          },
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));

    expect(sseChunks).toHaveLength(1);
    expect(sseChunks[0].event).toBe('usage');
    expect(sseChunks[0].data.type).toBe('usage');
    expect(sseChunks[0].data.usage.prompt_tokens).toBe(120);
    expect(sseChunks[0].data.usage.completion_tokens).toBe(50);
    expect(sseChunks[0].data.usage.total_tokens).toBe(150);
    expect(sseChunks[0].data.usage.prompt_tokens_details.cached_tokens).toBe(20);
    expect(sseChunks[0].data.usage.cost_details.upstream_inference_cost).toBe(0.001);
    expect(sseChunks[0].data.usage.completion_tokens_details.reasoning_tokens).toBe(10);
  });

  test('should buffer partial tool call arguments until they are complete', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'manage_todo_list',
                  arguments: '{"items":[',
                },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: '"buy milk"]}',
                },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {},
          finish_reason: 'stop',
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    const functionCallChunks = sseChunks.filter((chunk) =>
      chunk.data.candidates?.[0]?.content?.parts?.some((part: any) => part.functionCall)
    );

    expect(functionCallChunks).toHaveLength(1);
    expect(functionCallChunks[0].data.candidates[0].content.parts[0].functionCall.name).toBe(
      'manage_todo_list'
    );
    expect(functionCallChunks[0].data.candidates[0].content.parts[0].functionCall.args).toEqual({
      items: ['buy milk'],
    });
    expect(
      sseChunks.find((chunk) => chunk.data.candidates?.[0]?.finishReason)?.data.candidates[0]
        .finishReason
    ).toBe('STOP');
  });

  test('should preserve parallel tool calls when partial arguments arrive interleaved', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_date',
                  arguments: '{"timezone":"',
                },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 1,
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'add_tasks',
                  arguments: '{"tasks":["buy milk"',
                },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 1,
                function: {
                  arguments: ',"clean kitchen"]}',
                },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: 'UTC"}',
                },
              },
            ],
          },
          finish_reason: 'stop',
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    const functionCallChunks = sseChunks.filter((chunk) =>
      chunk.data.candidates?.[0]?.content?.parts?.some((part: any) => part.functionCall)
    );

    expect(functionCallChunks).toHaveLength(2);
    expect(functionCallChunks[0].data.candidates[0].content.parts[0].functionCall.name).toBe(
      'add_tasks'
    );
    expect(functionCallChunks[0].data.candidates[0].content.parts[0].functionCall.args).toEqual({
      tasks: ['buy milk', 'clean kitchen'],
    });
    expect(functionCallChunks[1].data.candidates[0].content.parts[0].functionCall.name).toBe(
      'get_date'
    );
    expect(functionCallChunks[1].data.candidates[0].content.parts[0].functionCall.args).toEqual({
      timezone: 'UTC',
    });
    expect(
      sseChunks.find((chunk) => chunk.data.candidates?.[0]?.finishReason)?.data.candidates[0]
        .finishReason
    ).toBe('STOP');
  });

  test('should emit functionCall id and thoughtSignature from real Google OpenAI-compat chunks', async () => {
    // Modeled on a captured gemini-3.5-flash stream via the OpenAI-compat
    // endpoint: tool calls have no `index`, carry an `id`, complete args per
    // chunk, and thought signature under extra_content.google.
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_real',
          model: 'gemini-3.5-flash',
          created: Date.now(),
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'xjcm5z4x',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
                extra_content: { google: { thought_signature: 'sig-abc' } },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_real',
          model: 'gemini-3.5-flash',
          created: Date.now(),
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'pc5lscvl',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
          finish_reason: null,
        });
        controller.enqueue({
          id: 'resp_real',
          model: 'gemini-3.5-flash',
          created: Date.now(),
          delta: { role: 'assistant' },
          finish_reason: 'stop',
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    const functionCallParts = sseChunks.flatMap(
      (chunk) =>
        chunk.data.candidates?.[0]?.content?.parts?.filter((part: any) => part.functionCall) ?? []
    );

    expect(functionCallParts).toHaveLength(2);
    expect(functionCallParts[0].functionCall).toEqual({
      name: 'get_weather',
      args: { city: 'Paris' },
      id: 'xjcm5z4x',
    });
    expect(functionCallParts[0].thoughtSignature).toBe('sig-abc');
    expect(functionCallParts[1].functionCall).toEqual({
      name: 'get_weather',
      args: { city: 'Tokyo' },
      id: 'pc5lscvl',
    });
    expect(functionCallParts[1].thoughtSignature).toBeUndefined();
  });

  test('should emit done event when stream ends with done chunk', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          event: 'done',
          delta: {},
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    expect(sseChunks.some((chunk) => chunk.event === 'done')).toBe(true);
  });

  test('should emit usage in finish chunk', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: { content: 'Response' },
          finish_reason: 'stop',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
            reasoning_tokens: 25,
            cached_tokens: 20,
          },
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    const usageEvent = sseChunks.find((chunk) => chunk.data.usageMetadata !== undefined);

    expect(usageEvent).toBeDefined();
    expect(usageEvent?.data.usageMetadata.promptTokenCount).toBe(120);
    expect(usageEvent?.data.usageMetadata.candidatesTokenCount).toBe(50);
    expect(usageEvent?.data.usageMetadata.totalTokenCount).toBe(150);
    expect(usageEvent?.data.usageMetadata.thoughtsTokenCount).toBe(25);
  });

  test('should keep stop finish reason when no function calls', async () => {
    const inputStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'resp_123',
          model: 'gemini-2.0-flash',
          created: Date.now(),
          delta: { content: 'Hello world' },
          finish_reason: 'stop',
        });
        controller.close();
      },
    });

    const sseChunks = await readAllChunks(formatGeminiStream(inputStream));
    const finishChunk = sseChunks.find((chunk) => chunk.data.candidates?.[0]?.finishReason);
    expect(finishChunk?.data.candidates[0].finishReason).toBe('STOP');
  });
});
