import { describe, expect, test, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';

// Mock fetch to prevent actual network calls
global.fetch = vi.fn(async () => new Response('', { status: 200 })) as any;

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

  test('detects OpenRouter upstream rate limit SSE error and returns ok: false with parsed cooldown', async () => {
    const encoder = new TextEncoder();
    const errorPayload = {
      message: 'Provider returned error',
      code: 429,
      metadata: {
        raw: 'openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations',
        provider_name: 'OpenInference',
        is_byok: false,
        retry_after_seconds: 29,
      },
    };
    const chunk = encoder.encode(`data: ${JSON.stringify(errorPayload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain(
      'openai/gpt-5.6-luna is temporarily rate-limited upstream'
    );
    expect(result.error.statusCode).toBe(429);
    expect(result.error.cooldownDuration).toBe(29000);
    expect(result.error.isStreamError).toBe(true);
  });

  test('detects Anthropic SSE error event and returns ok: false', async () => {
    const encoder = new TextEncoder();
    const errorEvent =
      'event: error\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"Anthropic rate limit hit"}}\n\n';
    const chunk = encoder.encode(errorEvent);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response);

    expect(result.ok).toBe(false);
    expect(result.error.message).toBe('Anthropic rate limit hit');
    expect(result.error.statusCode).toBe(429);
    expect(result.error.isStreamError).toBe(true);
  });

  test('detects SSE error split across multiple chunks in stall-aware probe', async () => {
    const encoder = new TextEncoder();
    const errorPayload = {
      message: 'Provider returned error',
      code: 429,
      metadata: {
        raw: 'openai/gpt-5.6-luna is temporarily rate-limited upstream.',
        retry_after_seconds: 15,
      },
    };
    const jsonStr = `data: ${JSON.stringify(errorPayload)}\n\n`;
    const half = Math.floor(jsonStr.length / 2);
    const chunk1 = encoder.encode(jsonStr.slice(0, half));
    const chunk2 = encoder.encode(jsonStr.slice(half));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const dispatcher = new Dispatcher();
    const result = await (dispatcher as any).probeStreamingStart(response, {
      ttfbMs: 1000,
      ttfbBytes: 500,
    });

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain(
      'openai/gpt-5.6-luna is temporarily rate-limited upstream'
    );
    expect(result.error.statusCode).toBe(429);
    expect(result.error.cooldownDuration).toBe(15000);
  });

  test('does not falsely flag normal delta content mentioning the word error', async () => {
    const encoder = new TextEncoder();
    const normalPayload = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-5.6-luna',
      choices: [
        {
          index: 0,
          delta: { content: 'Here is the error log you requested.' },
          finish_reason: null,
        },
      ],
    };
    const chunk = encoder.encode(`data: ${JSON.stringify(normalPayload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
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
  });
});
