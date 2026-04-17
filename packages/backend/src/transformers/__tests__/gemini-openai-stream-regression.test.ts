import { describe, expect, test } from 'vitest';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { transformGeminiStream } from '../gemini/stream-transformer';
import { OpenAITransformer } from '../openai';

function createGeminiSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.close();
    },
  });
}

async function readOpenAISSEChunks(stream: ReadableStream<Uint8Array>): Promise<any[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: any[] = [];

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (event.data === '[DONE]') {
        chunks.push('[DONE]');
        return;
      }

      chunks.push(JSON.parse(event.data));
    },
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }

  return chunks;
}

describe('Gemini -> OpenAI stream regression', () => {
  test('emits indexed tool calls with stable ids for chat completion chunks', async () => {
    const geminiStream = createGeminiSSEStream([
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'search_web',
                    args: { query: "today's top news headlines" },
                  },
                },
              ],
            },
            index: 0,
          },
        ],
        responseId: 'resp_123',
        modelVersion: 'gemini-3.1-flash-lite-preview',
      }),
      JSON.stringify({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '' }] },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        responseId: 'resp_123',
        modelVersion: 'gemini-3.1-flash-lite-preview',
      }),
      '[DONE]',
    ]);

    const unifiedStream = transformGeminiStream(geminiStream as ReadableStream);
    const formattedStream = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formattedStream as ReadableStream<Uint8Array>);

    const toolCallChunk = chunks.find(
      (chunk) => chunk !== '[DONE]' && chunk.choices?.[0]?.delta?.tool_calls?.length
    );
    expect(toolCallChunk).toBeDefined();
    expect(toolCallChunk.choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: {
        name: 'search_web',
        arguments: '{"query":"today\'s top news headlines"}',
      },
    });

    const finishChunk = chunks.find(
      (chunk) => chunk !== '[DONE]' && chunk.choices?.[0]?.finish_reason === 'tool_calls'
    );
    expect(finishChunk).toBeDefined();
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('preserves upstream function call ids when Gemini provides them', async () => {
    const geminiStream = createGeminiSSEStream([
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'zq87ju01',
                    name: 'search_web',
                    args: { query: 'top news headlines today' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        responseId: 'resp_456',
        modelVersion: 'gemini-3.1-flash-lite-preview',
      }),
    ]);

    const unifiedStream = transformGeminiStream(geminiStream as ReadableStream);
    const formattedStream = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formattedStream as ReadableStream<Uint8Array>);

    const toolCallChunk = chunks.find(
      (chunk) => chunk !== '[DONE]' && chunk.choices?.[0]?.delta?.tool_calls?.length
    );
    expect(toolCallChunk).toBeDefined();
    expect(toolCallChunk.choices[0].delta.tool_calls[0].index).toBe(0);
    expect(toolCallChunk.choices[0].delta.tool_calls[0].id).toBe('zq87ju01');

    const finishChunk = chunks.find(
      (chunk) => chunk !== '[DONE]' && chunk.choices?.[0]?.finish_reason === 'tool_calls'
    );
    expect(finishChunk).toBeDefined();
  });
});
