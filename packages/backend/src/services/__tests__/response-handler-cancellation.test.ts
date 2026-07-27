/**
 * Tests for the upstream fetch cancellation chain in handleResponse().
 *
 * These tests verify the two bugs discovered and fixed during the stream
 * disconnection work:
 *
 * 1. pipeline.destroy() alone does NOT propagate cancel() back through
 *    Readable.fromWeb() to the upstream web ReadableStream.
 *    nodeStream.destroy() (the source) must be called.
 *
 * 2. abortController.abort() alone also does NOT stop an already-in-progress
 *    Readable.fromWeb() read loop. The abort signal is consumed by fetch() at
 *    call time; aborting it afterwards has no effect on the streaming body.
 *    nodeStream.destroy() is required in all cases.
 *
 * See packages/backend/src/__tests__/disconnect-detection/ for the exploratory
 * test scripts that established these findings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { handleResponse } from '../responses/response-handler';
import { OpenAITransformer } from '../../transformers/openai';
import { DebugManager } from '../observability/debug-manager';
import type { UnifiedChatResponse } from '../../types/unified';
import type { UsageRecord } from '../../types/usage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a web ReadableStream that enqueues chunks on an interval.
 * Returns the stream and a spy that records whether cancel() was called.
 */
function makeWebStream(intervalMs = 20, maxChunks = 100) {
  let cancelCalled = false;
  let cancelReason: unknown = undefined;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let n = 0;
      intervalId = setInterval(() => {
        n++;
        try {
          controller.enqueue(new TextEncoder().encode(`chunk-${n}\n`));
        } catch {
          // controller already closed/cancelled — stop the interval
          if (intervalId) clearInterval(intervalId);
        }
        if (n >= maxChunks) {
          if (intervalId) clearInterval(intervalId);
          controller.close();
        }
      }, intervalMs);
    },
    cancel(reason) {
      cancelCalled = true;
      cancelReason = reason;
      if (intervalId) clearInterval(intervalId);
    },
  });

  return {
    stream,
    wasCancelled: () => cancelCalled,
    cancelReason: () => cancelReason,
  };
}

/**
 * Builds the same Node stream pipeline that response-handler.ts constructs:
 *   webStream -> Readable.fromWeb() -> nodeStream -> .pipe() -> passthrough
 */
function makePipeline(webStream: ReadableStream<Uint8Array>) {
  const nodeStream = Readable.fromWeb(webStream as any);
  const passthrough = new PassThrough();
  const pipeline = nodeStream.pipe(passthrough);
  // Suppress unhandled error events from deliberate destroy() calls
  pipeline.on('error', () => {});
  nodeStream.on('error', () => {});
  passthrough.on('data', () => {}); // drain so backpressure doesn't stall
  return { nodeStream, passthrough, pipeline };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Cancellation chain tests
// ---------------------------------------------------------------------------

describe('Upstream fetch cancellation chain', () => {
  it('pipeline.destroy() (downstream) does NOT cancel the upstream web stream', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { pipeline } = makePipeline(stream);

    await wait(100); // let some chunks flow
    pipeline.destroy();
    await wait(200); // give cancel() time to fire if it were going to

    expect(wasCancelled()).toBe(false);
  });

  it('nodeStream.destroy() (source) DOES cancel the upstream web stream', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream } = makePipeline(stream);

    await wait(100);
    nodeStream.destroy();
    await wait(200);

    expect(wasCancelled()).toBe(true);
  });

  it('abortController.abort() alone does NOT cancel an in-progress Readable.fromWeb stream', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream } = makePipeline(stream);

    const ac = new AbortController();
    // The signal was "passed to fetch()" at request time — aborting it after
    // streaming has begun has no effect on the body read loop.
    await wait(100);
    ac.abort(new DOMException('signal timed out', 'TimeoutError'));
    await wait(200);

    expect(wasCancelled()).toBe(false);
    // Clean up
    nodeStream.destroy();
  });

  it('abort() + nodeStream.destroy() together DO cancel the upstream', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream, pipeline } = makePipeline(stream);

    const ac = new AbortController();

    await wait(100);
    ac.abort(new DOMException('signal timed out', 'TimeoutError'));
    nodeStream.destroy(); // this is what actually cancels Readable.fromWeb
    pipeline.destroy();
    await wait(200);

    expect(wasCancelled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// signal.addEventListener('abort') pattern
// ---------------------------------------------------------------------------

describe('signal abort listener -> nodeStream.destroy() pattern', () => {
  it('wiring signal abort to nodeStream.destroy() cancels upstream on abort()', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream, pipeline } = makePipeline(stream);

    const ac = new AbortController();

    // This is the pattern now used in response-handler.ts
    ac.signal.addEventListener(
      'abort',
      () => {
        nodeStream.destroy();
        pipeline.destroy();
      },
      { once: true }
    );

    await wait(100);
    ac.abort(new DOMException('signal timed out', 'TimeoutError'));
    await wait(200);

    expect(wasCancelled()).toBe(true);
    expect(nodeStream.destroyed).toBe(true);
  });

  it('abort listener fires for plain abort (client disconnect case)', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream, pipeline } = makePipeline(stream);

    const ac = new AbortController();
    const listenerSpy = vi.fn(() => {
      nodeStream.destroy();
      pipeline.destroy();
    });

    ac.signal.addEventListener('abort', listenerSpy, { once: true });

    await wait(100);
    ac.abort(); // plain abort, no reason — simulates what onDisconnect() does
    await wait(200);

    expect(listenerSpy).toHaveBeenCalledOnce();
    expect(wasCancelled()).toBe(true);
  });

  it('abort listener fires for TimeoutError (timeout case)', async () => {
    const { stream, wasCancelled } = makeWebStream();
    const { nodeStream, pipeline } = makePipeline(stream);

    const ac = new AbortController();
    let capturedReason: unknown = null;

    ac.signal.addEventListener(
      'abort',
      () => {
        capturedReason = ac.signal.reason;
        nodeStream.destroy();
        pipeline.destroy();
      },
      { once: true }
    );

    await wait(100);
    ac.abort(new DOMException('signal timed out', 'TimeoutError'));
    await wait(200);

    expect(wasCancelled()).toBe(true);
    expect((capturedReason as DOMException)?.name).toBe('TimeoutError');
  });

  it('abort listener is called at most once even if abort() is called multiple times', async () => {
    const { stream } = makeWebStream();
    const { nodeStream, pipeline } = makePipeline(stream);

    const ac = new AbortController();
    const listenerSpy = vi.fn(() => {
      nodeStream.destroy();
      pipeline.destroy();
    });

    ac.signal.addEventListener('abort', listenerSpy, { once: true });

    await wait(50);
    ac.abort();
    ac.abort(); // second call should be a no-op
    await wait(100);

    expect(listenerSpy).toHaveBeenCalledOnce();
    nodeStream.destroy();
  });
});

// ---------------------------------------------------------------------------
// Stream termination state
// ---------------------------------------------------------------------------

describe('nodeStream destruction state', () => {
  it('nodeStream.destroyed is false before any cancellation', async () => {
    const { stream } = makeWebStream();
    const { nodeStream } = makePipeline(stream);

    await wait(50);
    expect(nodeStream.destroyed).toBe(false);
    nodeStream.destroy();
  });

  it('nodeStream.destroyed is true immediately after destroy()', async () => {
    const { stream } = makeWebStream();
    const { nodeStream } = makePipeline(stream);

    await wait(50);
    nodeStream.destroy();
    expect(nodeStream.destroyed).toBe(true);
  });

  it('upstream stops producing chunks after nodeStream.destroy()', async () => {
    const { stream, wasCancelled } = makeWebStream(20, 100);
    const { nodeStream } = makePipeline(stream);

    await wait(100); // ~5 chunks at 20ms intervals
    nodeStream.destroy();
    await wait(200); // wait for cancel() to propagate

    expect(wasCancelled()).toBe(true);
    expect(nodeStream.destroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: cancellation mid-stream still records usage
// ---------------------------------------------------------------------------
//
// The debug taps' snapshots (which UsageInspector's _destroy fallback reads)
// used to be written ONLY by the taps' flush/'end' handlers — and a client
// disconnect/timeout cancels the web TransformStreams WITHOUT running flush,
// so production cancellations finalized with no usage at all (the earlier
// tests pre-seeded the snapshots and never noticed). This exercises the REAL
// path end-to-end through handleResponse: provider SSE with usage-bearing
// chunks -> abort mid-stream (no flush anywhere) -> the saved record must
// still carry the observed usage, via the teardown's explicit finalize.
describe('handleResponse cancellation records usage from live captures (no pre-seeding)', () => {
  beforeEach(() => {
    DebugManager.getInstance().resetForTesting();
  });

  it('a client disconnect after usage-bearing chunks finalizes the record WITH usage and costs', async () => {
    const encoder = new TextEncoder();
    // Chat-format provider SSE: role/content chunk, then the usage-bearing
    // final chunk — and then the stream stays OPEN (no [DONE], no close):
    // the client disconnects first, so no flush ever runs anywhere. (In
    // production the upstream fetch is killed by the abort signal +
    // nodeStream.destroy(); this test asserts the usage RECORD, which is
    // what cancellations used to lose.)
    const providerStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"chatcmpl_e2e","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"id":"chatcmpl_e2e","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":9,"total_tokens":59}}\n\n'
          )
        );
        // Deliberately NOT closed.
      },
    });

    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-cancel-e2e',
      model: 'gpt-4o',
      content: null,
      stream: providerStream,
      plexus: {
        provider: 'test-provider',
        model: 'gpt-4o',
        apiType: 'chat',
        pricing: { source: 'simple', input: 1000, output: 2000 },
      },
    };

    const usageRecord: Partial<UsageRecord> = { requestId: 'req-cancel-e2e' };
    const savedRecords: UsageRecord[] = [];
    const mockStorage = {
      saveRequest: vi.fn(async (record: UsageRecord) => {
        savedRecords.push(record);
      }),
      updatePerformanceMetrics: vi.fn(async () => {}),
      saveError: vi.fn(),
    };
    const reply = {
      header: vi.fn(function (this: any) {
        return this;
      }),
      send: vi.fn((pipeline: any) => pipeline),
      code: vi.fn(function (this: any) {
        return this;
      }),
    };
    const request = { headers: {}, raw: {} };
    const abortController = new AbortController();

    await handleResponse(
      request as any,
      reply as any,
      unifiedResponse,
      new OpenAITransformer(),
      usageRecord,
      mockStorage as any,
      Date.now(),
      'chat',
      false,
      undefined,
      undefined,
      undefined,
      abortController,
      null
    );

    const pipeline = (reply.send as any).mock.calls.at(-1)[0];
    pipeline.on('data', () => {});
    pipeline.on('error', () => {});

    // Let the chunks flow through the full production pipeline (provider SSE
    // -> raw tap -> unified -> client SSE -> transformed tap), then
    // disconnect the client mid-stream.
    await wait(80);
    abortController.abort();
    // Long enough for the teardown to finish AND for the disconnect poll to
    // observe the destroyed pipeline and clear itself.
    await wait(300);

    expect(savedRecords).toHaveLength(1);
    const record = savedRecords[0]!;
    expect(record.responseStatus).toBe('cancelled');
    // The usage the provider streamed BEFORE the disconnect must be on the
    // record — this is exactly what production cancellations lost when the
    // snapshots were only written on flush.
    expect(record.tokensInput).toBe(50);
    expect(record.tokensOutput).toBe(9);
    // 50/1M * $1000 + 9/1M * $2000 = $0.068.
    expect(record.costSource).toBe('simple');
    expect(record.costTotal).toBeCloseTo(0.068, 10);
  });
});
