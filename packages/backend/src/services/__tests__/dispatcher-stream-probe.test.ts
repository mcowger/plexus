import { describe, expect, test, mock } from 'bun:test';
import { Dispatcher } from '../dispatcher';

// Mock fetch to prevent actual network calls
global.fetch = mock(async () => new Response('', { status: 200 })) as any;

describe('probeStreamingStart', () => {
  test('timeout path preserves the first chunk', async () => {
    // Simulate a stream where the first chunk arrives after >100ms
    const encoder = new TextEncoder();
    const firstChunk = encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n');
    const secondChunk = encoder.encode(
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'
    );

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Delay the first chunk by 200ms to trigger timeout path
        await new Promise((resolve) => setTimeout(resolve, 200));
        controller.enqueue(firstChunk);
        controller.enqueue(secondChunk);
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response);

    expect(result.ok).toBe(true);

    // Read all chunks from the replayed stream
    const reader = result.response.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const fullBody = new TextDecoder().decode(
      new Uint8Array(chunks.reduce((acc, c) => [...acc, ...c], [] as number[]))
    );

    // The first chunk (message_start) must NOT be lost
    expect(fullBody).toContain('message_start');
    expect(fullBody).toContain('content_block_delta');
  });

  test('normal path (fast response) preserves the first chunk', async () => {
    // Stream where the first chunk arrives immediately (< 100ms)
    const encoder = new TextEncoder();
    const firstChunk = encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n');
    const secondChunk = encoder.encode(
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Enqueue immediately — no delay
        controller.enqueue(firstChunk);
        controller.enqueue(secondChunk);
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response);

    expect(result.ok).toBe(true);

    const reader = result.response.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const fullBody = new TextDecoder().decode(
      new Uint8Array(chunks.reduce((acc, c) => [...acc, ...c], [] as number[]))
    );

    expect(fullBody).toContain('message_start');
    expect(fullBody).toContain('content_block_delta');
  });

  test('timeout path with stream error propagates error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        controller.error(new Error('connection reset'));
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response);

    expect(result.ok).toBe(true);

    const reader = result.response.body!.getReader();
    try {
      await reader.read();
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toBe('connection reset');
    }
  });
});
