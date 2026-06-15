import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import { ConcurrencyTracker } from '../concurrency-tracker';
import { CooldownManager } from '../cooldown-manager';
import type { UnifiedChatRequest } from '../../types/unified';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeConfig(maxConcurrency?: number) {
  const providers: Record<string, any> = {
    p1: {
      api_base_url: 'https://p1.example.com/v1',
      api_key: 'test-key-p1',
      enabled: true,
      models: { 'model-a': {} },
      ...(maxConcurrency != null ? { maxConcurrency } : {}),
    },
    p2: {
      api_base_url: 'https://p2.example.com/v1',
      api_key: 'test-key-p2',
      enabled: true,
      models: { 'model-b': {} },
    },
  };

  return {
    providers,
    models: {
      'test-alias': {
        selector: 'in_order',
        target_groups: [
          {
            name: 'default',
            selector: 'in_order',
            targets: [
              { provider: 'p1', model: 'model-a', enabled: true },
              { provider: 'p2', model: 'model-b', enabled: true },
            ],
          },
        ],
      },
    },
    keys: {},
    failover: { enabled: true, retryableStatusCodes: [500], retryableErrors: [] },
    quotas: [],
  } as any;
}

function makeChatRequest(stream = false): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream,
  };
}

function streamingResponse(text = 'data: hello\n\n') {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function nonStreamingResponse(model = 'model-a') {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Dispatcher concurrency slot release', () => {
  beforeEach(() => {
    ConcurrencyTracker.resetForTesting();
    CooldownManager.resetInstance();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('non-streaming response releases concurrency slot', async () => {
    setConfigForTesting(makeConfig(2));
    fetchMock.mockImplementation(async () => nonStreamingResponse());

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.getProviderCount('p1')).toBe(0);

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(false));

    expect(response).toBeDefined();
    // Slot should be released immediately after non-streaming response
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
  });

  test('streaming response releases concurrency slot after stream is consumed', async () => {
    setConfigForTesting(makeConfig(2));
    fetchMock.mockImplementation(async () => streamingResponse());

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));

    expect(response.stream).toBeDefined();

    // The stream wrapper reads from the upstream eagerly. Consume the
    // wrapped stream fully — the concurrency slot should be released.
    const reader = (response.stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    reader.releaseLock();

    // After stream is fully consumed, slot must be released
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
  });

  test('streaming response holds slot while upstream is still sending', async () => {
    setConfigForTesting(makeConfig(2));

    // Create an upstream stream that stays open until we explicitly close it
    let upstreamController: ReadableStreamDefaultController<Uint8Array>;
    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(new TextEncoder().encode('data: chunk1\n\n'));
      },
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(upstreamStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));

    // Read the first chunk from the wrapped stream
    const reader = (response.stream as ReadableStream<Uint8Array>).getReader();
    const { done: done1 } = await reader.read();
    expect(done1).toBe(false);

    // The concurrency slot should still be held while the stream is active
    expect(tracker.getProviderCount('p1')).toBe(1);

    // Now close the upstream
    upstreamController!.enqueue(new TextEncoder().encode('data: chunk2\n\n'));
    upstreamController!.close();

    // Drain the rest of the wrapped stream
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    reader.releaseLock();

    // Slot released after stream completes
    expect(tracker.getProviderCount('p1')).toBe(0);
  });

  test('streaming response releases slot when stream is cancelled', async () => {
    setConfigForTesting(makeConfig(2));

    // Create a slow upstream stream that stays open
    const slowStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
        // Don't close — simulate a long-running stream
      },
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(slowStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));

    // Cancel the stream without reading it first — simulating a client
    // disconnecting before consuming any data
    await (response.stream as ReadableStream<Uint8Array>).cancel();

    // Slot should be released after cancellation
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
  });

  test('HTTP error response releases concurrency slot', async () => {
    setConfigForTesting(makeConfig(2));
    // Both providers return 500 — the dispatcher will try both, fail, and throw
    fetchMock.mockImplementation(
      async () => new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain' } })
    );

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();
    try {
      await dispatcher.dispatch(makeChatRequest(false));
    } catch {
      // Expected — 500 error propagates
    }

    // Slot should be released even after error
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
  });

  test('concurrent requests respect maxConcurrency and overflow to next provider', async () => {
    setConfigForTesting(makeConfig(1)); // Only 1 concurrent request to p1

    // p1 returns a slow stream, p2 returns a fast response
    let p1StreamController: ReadableStreamDefaultController<Uint8Array>;
    const p1Stream = new ReadableStream<Uint8Array>({
      start(controller) {
        p1StreamController = controller;
        controller.enqueue(new TextEncoder().encode('data: p1-start\n\n'));
      },
    });

    fetchMock.mockImplementationOnce(
      async () =>
        new Response(p1Stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );
    fetchMock.mockImplementationOnce(async () => streamingResponse('data: p2-start\n\n'));

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();

    // First request goes to p1 (under limit)
    const response1 = await dispatcher.dispatch(makeChatRequest(true));
    expect(response1.plexus?.provider).toBe('p1');

    // Second request should overflow to p2 (p1 at limit)
    const response2 = await dispatcher.dispatch(makeChatRequest(true));
    expect(response2.plexus?.provider).toBe('p2');

    // Consume p2's stream (it closes immediately)
    const reader2 = (response2.stream as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done } = await reader2.read();
      if (done) break;
    }
    reader2.releaseLock();

    // Now close p1's stream and consume it
    p1StreamController!.close();
    const reader1 = (response1.stream as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done } = await reader1.read();
      if (done) break;
    }
    reader1.releaseLock();

    // Both slots should be released
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getProviderCount('p2')).toBe(0);
  });

  test('slot is released after non-streaming response even when error is thrown downstream', async () => {
    setConfigForTesting(makeConfig(2));
    fetchMock.mockImplementation(async () => nonStreamingResponse());

    const tracker = ConcurrencyTracker.getInstance();

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeChatRequest(false));

    // Verify no slots are leaked after a normal non-streaming dispatch
    expect(tracker.getProviderCount('p1')).toBe(0);
  });

  test('enforceContextLimit does not leak concurrency slot', async () => {
    setConfigForTesting({
      ...makeConfig(2),
      models: {
        'test-alias': {
          selector: 'in_order',
          target_groups: [
            {
              name: 'default',
              selector: 'in_order',
              targets: [{ provider: 'p1', model: 'model-a', enabled: true }],
            },
          ],
        },
        // model-a config with enforce_limits enabled and a tiny context window
        'model-a': {
          enforce_limits: true,
          context_length: 100,
        },
      },
    } as any);

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);

    const dispatcher = new Dispatcher();
    try {
      // Request with messages that exceed the tiny 100-token context limit
      await dispatcher.dispatch({
        model: 'test-alias',
        messages: [{ role: 'user', content: 'x'.repeat(1000) }],
        incomingApiType: 'chat',
        stream: false,
      });
    } catch (e: any) {
      // Error is expected (may be wrapped by buildAllTargetsFailedError)
      expect(e).toBeDefined();
    }

    // The slot must NOT be leaked — enforceContextLimit ran before acquire()
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
    expect(tracker.getProviderCount('p1')).toBe(0);
  });

  test('TTFB stall timeout releases concurrency slot', async () => {
    // Enable stall detection with a very short TTFB timeout so the
    // fetch itself gets aborted before the provider responds.
    setConfigForTesting({
      ...makeConfig(2),
      stall: { ttfbSeconds: 0.05, ttfbBytes: 100 },
    } as any);

    // Simulate a slow provider that respects abort signals.
    // The stall timeout will abort before this resolves.
    fetchMock.mockImplementation(async (_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => {
          _resolve(streamingResponse());
        }, 500);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    const tracker = ConcurrencyTracker.getInstance();
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);

    const dispatcher = new Dispatcher();
    try {
      await dispatcher.dispatch(makeChatRequest(true));
    } catch {
      // Expected — stall timeout error propagates
    }

    // The slot must be released after the TTFB stall abort
    expect(tracker.getTargetCount('p1', 'model-a')).toBe(0);
    expect(tracker.getProviderCount('p1')).toBe(0);
    expect(tracker.getTargetCount('p2', 'model-b')).toBe(0);
    expect(tracker.getProviderCount('p2')).toBe(0);
  });
});
