import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { Dispatcher } from '../dispatch/dispatcher';
import { probeStreamingStart } from '../probes/stream-probe';

// Mock fetch to prevent actual network calls
beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(
    mock(async () => new Response('', { status: 200 })) as any
  );
});

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

  describe('Responses lifecycle prelude before response.failed', () => {
    const encoder = new TextEncoder();
    const frame = (type: string, body: object) =>
      encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
    const created = frame('response.created', { response: { id: 'resp_1', status: 'queued' } });
    const inProgress = frame('response.in_progress', { response: { id: 'resp_1' } });
    const failed = frame('response.failed', {
      response: {
        id: 'resp_1',
        status: 'failed',
        error: {
          code: 'no_available_provider',
          message: 'No one started answering within 85 seconds.',
        },
      },
    });

    // Pull-driven with zero buffering: each upstream read yields exactly one frame.
    const sseResponse = (chunks: Uint8Array[]) => {
      let index = 0;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              const chunk = chunks[index++];
              if (chunk) controller.enqueue(chunk);
              else controller.close();
            },
          },
          { highWaterMark: 0 }
        ),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    };

    test('failure arriving after a prelude chunk is reported before anything is committed', async () => {
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, inProgress, failed])
      );

      expect(result.ok).toBe(false);
      expect(result.streamStarted).toBe(false);
      expect(result.error.isStreamError).toBe(true);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
      expect(result.error.routingContext.cooldownTriggered).toBe(true);
    });

    test('caller-fault response.failed after a prelude passes through without failover', async () => {
      const callerFault = frame('response.failed', {
        response: {
          id: 'resp_1',
          status: 'failed',
          error: { code: 'image_too_large', message: 'x' },
        },
      });
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, inProgress, callerFault])
      );

      expect(result.ok).toBe(true);
      const body = await new Response(result.response.body).text();
      expect(body).toContain('image_too_large');
    });

    test('error after a response.metadata prelude frame fails over with Retry-After cooldown', async () => {
      const metadata = frame('response.metadata', {
        response_id: 'resp_1',
        metadata: { openai_chatgpt_moderation_metadata: { prompt: {} } },
      });
      const overloaded = encoder.encode(
        'event: error\ndata: {"type":"error","error":{"message":"Our servers are currently overloaded. Please try again later.","type":"service_unavailable_error","code":"server_is_overloaded","headers":{"retry-after":"313"}}}\n\n'
      );
      const result = await probeStreamingStart(
        sseResponse([created, inProgress, metadata, overloaded, failed])
      );

      if (result.ok) throw new Error('expected probe to fail over');
      expect(result.streamStarted).toBe(false);
      // parseInitialStreamError attaches routing fields to a plain Error.
      const error = result.error as Error & {
        routingContext?: { cooldownTriggered?: boolean };
        cooldownDuration?: number;
      };
      expect(error.message).toBe('Our servers are currently overloaded. Please try again later.');
      expect(error.routingContext?.cooldownTriggered).toBe(true);
      expect(error.cooldownDuration).toBe(313_000);
    });

    test('error event after a prelude keeps its own details', async () => {
      const rateLimited = encoder.encode(
        'event: error\ndata: {"type":"error","error":{"code":429,"message":"slow down"}}\n\n'
      );
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, rateLimited])
      );

      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('slow down');
      expect(result.error.statusCode).toBe(429);
    });

    test('stall-aware probe also fails over on a failure after a prelude that meets ttfbBytes', async () => {
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, inProgress, failed]),
        { ttfbMs: 5000, ttfbBytes: 1 }
      );

      expect(result.ok).toBe(false);
      expect(result.error.isStreamError).toBe(true);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
    });

    test('stall-aware timeout after only a prelude reports streamStarted false', async () => {
      const silent = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(created);
          },
          pull: () => new Promise<void>(() => {}),
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(silent, {
        ttfbMs: 50,
        ttfbBytes: 1,
      });

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('stalled');
      expect(result.streamStarted).toBe(false);
    });

    test('failure frame split across reads (CRLF framing) still fails over', async () => {
      const crlf = (bytes: Uint8Array) =>
        encoder.encode(new TextDecoder().decode(bytes).replaceAll('\n', '\r\n'));
      const failedBytes = crlf(failed);
      const mid = Math.floor(failedBytes.length / 2);
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([crlf(created), failedBytes.slice(0, mid), failedBytes.slice(mid)])
      );

      expect(result.ok).toBe(false);
      expect(result.streamStarted).toBe(false);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
    });

    test('failure frame cut inside its event name still fails over', async () => {
      const text = new TextDecoder().decode(failed);
      const cut = text.indexOf('response.failed') + 'response.fa'.length;
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, encoder.encode(text.slice(0, cut)), encoder.encode(text.slice(cut))])
      );

      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
    });

    test('data-only failure cut inside the field name still fails over', async () => {
      const text = new TextDecoder().decode(failed).replace(/^event:.*\n/, '');
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, encoder.encode(text.slice(0, 3)), encoder.encode(text.slice(3))])
      );

      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
    });

    describe('every read boundary', () => {
      const dataOnly = (bytes: Uint8Array) =>
        encoder.encode(new TextDecoder().decode(bytes).replace(/^event:.*\n/, ''));
      const withEol = (bytes: Uint8Array, eol: string) =>
        encoder.encode(new TextDecoder().decode(bytes).replaceAll('\n', eol));
      const join = (...parts: Uint8Array[]) =>
        encoder.encode(parts.map((part) => new TextDecoder().decode(part)).join(''));
      const slices = (bytes: Uint8Array, at: number) => [bytes.slice(0, at), bytes.slice(at)];

      const variants: [string, (frame: Uint8Array) => Uint8Array][] = [
        ['LF', (frame) => frame],
        ['CRLF', (frame) => withEol(frame, '\r\n')],
        ['data-only LF', dataOnly],
        ['data-only CRLF', (frame) => withEol(dataOnly(frame), '\r\n')],
      ];

      for (const [name, shape] of variants) {
        test(`${name}: a failure fails over wherever the stream is cut`, async () => {
          const whole = join(shape(created), shape(inProgress), shape(failed));
          for (let at = 1; at < whole.length; at++) {
            const result = await (new Dispatcher() as any).probeStreamingStart(
              sseResponse(slices(whole, at))
            );
            expect(result.ok, `cut at byte ${at}`).toBe(false);
            expect(result.error.message, `cut at byte ${at}`).toBe(
              'No one started answering within 85 seconds.'
            );
          }
        });

        test(`${name}: the stall-aware probe fails over wherever the stream is cut`, async () => {
          const whole = join(shape(created), shape(inProgress), shape(failed));
          for (let at = 1; at < whole.length; at++) {
            const result = await (new Dispatcher() as any).probeStreamingStart(
              sseResponse(slices(whole, at)),
              { ttfbMs: 5000, ttfbBytes: 1 }
            );
            expect(result.ok, `cut at byte ${at}`).toBe(false);
            expect(result.streamStarted, `cut at byte ${at}`).toBe(false);
            expect(result.error.message, `cut at byte ${at}`).toBe(
              'No one started answering within 85 seconds.'
            );
          }
        });

        test(`${name}: a failure fails over when read one byte at a time`, async () => {
          const whole = join(shape(created), shape(failed));
          const singles = Array.from(whole, (byte) => Uint8Array.of(byte));
          const result = await (new Dispatcher() as any).probeStreamingStart(sseResponse(singles));
          expect(result.ok).toBe(false);
          expect(result.error.message).toBe('No one started answering within 85 seconds.');
        });

        test(`${name}: real output is replayed byte-for-byte wherever it is cut`, async () => {
          const delta = frame('response.output_text.delta', { delta: 'hi' });
          const whole = join(shape(created), shape(delta));
          for (let at = 1; at < whole.length; at++) {
            const result = await (new Dispatcher() as any).probeStreamingStart(
              sseResponse(slices(whole, at))
            );
            expect(result.ok, `cut at byte ${at}`).toBe(true);
            const body = await new Response(result.response.body).arrayBuffer();
            expect(new Uint8Array(body), `cut at byte ${at}`).toEqual(whole);
          }
        });
      }
    });

    test('an SSE comment after the prelude does not end the hold', async () => {
      const ping = encoder.encode(': ping\n\n');
      const result = await (new Dispatcher() as any).probeStreamingStart(
        sseResponse([created, ping, failed])
      );

      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('No one started answering within 85 seconds.');
    });

    test('fragmented Chat SSE is not held while the upstream stays open', async () => {
      const open = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"con'));
          },
          pull: () => new Promise<void>(() => {}),
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
      const result = await (new Dispatcher() as any).probeStreamingStart(open);
      expect(result.ok).toBe(true);
      const first = await result.response.body.getReader().read();
      expect(new TextDecoder().decode(first.value)).toContain('"choices"');
    });

    for (const [name, fragment] of [
      ['Chat', 'data: {"choices":[{"delta":{"con'],
      ['Anthropic', 'event: message_start\ndata: {"type":"mess'],
    ] as const) {
      test(`fragmented ${name} SSE is not held while the upstream stays open`, async () => {
        const open = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(fragment));
            },
            pull: () => new Promise<void>(() => {}),
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        );
        const result = await (new Dispatcher() as any).probeStreamingStart(open);
        expect(result.ok).toBe(true);
        const first = await result.response.body.getReader().read();
        expect(new TextDecoder().decode(first.value)).toBe(fragment);
      });
    }

    describe('native NDJSON is never held', () => {
      const token = encoder.encode('{"message":{"content":"hi"},"done":false}\n');
      // Upstream stays open after the first token: a held probe would never resolve.
      const openNdjson = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(token);
            },
            pull: () => new Promise<void>(() => {}),
          }),
          { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }
        );

      test('default probe returns while the upstream is still open', async () => {
        const result = await (new Dispatcher() as any).probeStreamingStart(openNdjson());
        expect(result.ok).toBe(true);
        const first = await result.response.body.getReader().read();
        expect(new TextDecoder().decode(first.value)).toContain('"content":"hi"');
      });

      test('stall-aware probe does not time out on real NDJSON output', async () => {
        const result = await (new Dispatcher() as any).probeStreamingStart(openNdjson(), {
          ttfbMs: 5000,
          ttfbBytes: 10,
        });
        expect(result.ok).toBe(true);
      });
    });

    test('real output split across reads is not held back', async () => {
      const delta = frame('response.output_text.delta', { delta: 'hi' });
      const half = Math.floor(delta.length / 2);
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, delta.slice(0, half), delta.slice(half)])
      );

      expect(result.ok).toBe(true);
      const body = await new Response(result.response.body).text();
      expect(body).toContain('response.output_text.delta');
    });

    test('prelude followed by real output is replayed intact', async () => {
      const delta = frame('response.output_text.delta', { delta: 'hi' });
      const dispatcher = new Dispatcher();
      const result = await (dispatcher as any).probeStreamingStart(
        sseResponse([created, inProgress, delta])
      );

      expect(result.ok).toBe(true);
      const body = await new Response(result.response.body).text();
      expect(body.indexOf('response.created')).toBeLessThan(body.indexOf('response.in_progress'));
      expect(body).toContain('response.output_text.delta');
    });
  });
});
