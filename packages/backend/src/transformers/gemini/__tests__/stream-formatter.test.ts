import { test, expect, describe } from 'vitest';
import { formatGeminiStream } from '../stream-formatter';
import { UnifiedChatStreamChunk } from '../../../types/unified';
import { createParser, EventSourceMessage } from 'eventsource-parser';

/**
 * Helper to read SSE chunks from a ReadableStream
 */
async function readSSEChunks(stream: ReadableStream): Promise<any[]> {
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
        } catch (e) {
          // ignore
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
    const unifiedChunks: UnifiedChatStreamChunk[] = [
      {
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
        } as any,
      },
    ];

    const inputStream = new ReadableStream({
      start(controller) {
        for (const chunk of unifiedChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const formattedStream = formatGeminiStream(inputStream);
    const sseChunks = await readSSEChunks(formattedStream);

    expect(sseChunks.length).toBe(1);
    const usageEvent = sseChunks[0];
    expect(usageEvent.event).toBe('usage');
    expect(usageEvent.data.type).toBe('usage');
    expect(usageEvent.data.usage).toBeDefined();
    expect(usageEvent.data.usage.prompt_tokens).toBe(120);
    expect(usageEvent.data.usage.completion_tokens).toBe(50);
    expect(usageEvent.data.usage.total_tokens).toBe(150);
    expect(usageEvent.data.usage.prompt_tokens_details.cached_tokens).toBe(20);
    expect(usageEvent.data.usage.cost_details.upstream_inference_cost).toBe(0.001);
    expect(usageEvent.data.usage.completion_tokens_details.reasoning_tokens).toBe(10);
  });

  test('should format usage correctly even if event is missing but usage is present', async () => {
    const unifiedChunks: UnifiedChatStreamChunk[] = [
      {
        id: 'resp_123',
        model: 'gemini-3-flash-preview',
        created: Date.now(),
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
        } as any,
      },
    ];

    const inputStream = new ReadableStream({
      start(controller) {
        for (const chunk of unifiedChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const formattedStream = formatGeminiStream(inputStream);
    const sseChunks = await readSSEChunks(formattedStream);

    expect(sseChunks.length).toBe(1);
    const usageChunk = sseChunks[0];
    expect(usageChunk.data.usageMetadata).toBeDefined();
    expect(usageChunk.data.usageMetadata.promptTokenCount).toBe(120);
    expect(usageChunk.data.usageMetadata.candidatesTokenCount).toBe(50);
  });
});
