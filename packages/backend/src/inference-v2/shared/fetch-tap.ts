/**
 * T2.7 — Global fetch tap for raw upstream response capture.
 *
 * Wraps globalThis.fetch with a body-tapping interceptor so pi-ai's raw HTTP
 * response body can be captured into the debug log.  pi-ai does not expose the
 * raw Response — it returns only AssistantMessage/Event — so this is the only
 * viable approach without modifying pi-ai itself.
 *
 * Design rules:
 *  - Only tap when DebugManager has an active log for the current requestId.
 *  - Thread the requestId via debugRequestIdStorage (AsyncLocalStorage) set
 *    in the onPayload callback so the tap fires in the same async context.
 *  - For non-streaming: clone + buffer the full response body.
 *  - For streaming: wrap via TransformStream (NOT tee() — avoids upstream backpressure).
 *  - installFetchTap() is idempotent — safe to call multiple times.
 *
 * Server-tool block capture (web_search etc.):
 *
 * pi-ai's Anthropic response parser only recognises `text`, `thinking`,
 * `redacted_thinking`, and `tool_use` content blocks — it silently drops
 * `server_tool_use` / `web_search_tool_result` (Anthropic's built-in
 * server-side tool blocks, e.g. web search). Since pi-ai never surfaces them
 * on AssistantMessage, this tap also reconstructs them directly from the raw
 * upstream bytes so the beta Anthropic response serialiser can splice them
 * back into the client-facing response. See pi-ai-executor.ts's onPayload
 * for where `watchForServerToolBlocks()` is armed, and
 * context-to-anthropic.ts for where `consumeServerToolBlocks()` is spliced in.
 *
 * Streaming capture correctness: extraction happens inside the
 * TransformStream's `transform()` callback (per chunk), NOT in `flush()`.
 * Bytes must pass through `transform()` before the downstream reader
 * (pi-ai) can observe them, so by construction our extraction of a given
 * `content_block_stop` always completes before pi-ai's own parser could
 * possibly react to that same byte — no race. `flush()` only handles the
 * defensive case of a block left open by a truncated stream.
 *
 * Non-streaming capture correctness: unlike the debug-only clone (which is
 * fire-and-forget since it doesn't gate anything), the server-tool-block
 * clone is awaited before tappedFetch returns the Response, so extraction
 * is guaranteed to finish before pi-ai's caller (runPiAiExecutor) reads the
 * body. This adds latency only to requests that actually armed the watch
 * (i.e. sent an Anthropic builtin tool).
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { DebugManager } from '../../services/debug-manager';
import { debugRequestIdStorage } from './pi-ai-executor';
import { ANTHROPIC_SERVER_TOOL_BLOCK_TYPES } from '../anthropic/builtin-tools';

let installed = false;
const originalFetch = globalThis.fetch;

/**
 * Per-request TTFB map: requestId → time-to-first-byte in ms.
 *
 * The fetch tap records the elapsed time between the call to originalFetch()
 * and the moment the Response object is returned (i.e. headers received /
 * first byte available).  The executor reads this after complete() or after
 * the first streaming chunk to populate ttftMs on the usage record.
 */
const ttfbMap = new Map<string, number>();

/** Called by the executor after consuming the result — prevents map growth. */
export function consumeTtfb(requestId: string): number | null {
  const v = ttfbMap.get(requestId) ?? null;
  ttfbMap.delete(requestId);
  return v;
}

// ─── Server-tool block capture ─────────────────────────────────────────────

/** RequestIds whose next upstream response should be scanned for server tool blocks. */
const serverToolWatchSet = new Set<string>();

/** Captured blocks per requestId, consumed once by the response serialiser. */
const serverToolBlocksMap = new Map<string, any[]>();

/**
 * Arms server-tool-block capture for this request. Called by the executor's
 * onPayload hook when the outgoing payload carries an Anthropic builtin tool
 * (e.g. web_search_20250305). Idempotent — safe to call once per attempt in
 * a failover loop.
 */
export function watchForServerToolBlocks(requestId: string): void {
  serverToolWatchSet.add(requestId);
}

/** Consumes (and clears) any server tool blocks captured for this request. */
export function consumeServerToolBlocks(requestId: string): any[] {
  const blocks = serverToolBlocksMap.get(requestId) ?? [];
  serverToolBlocksMap.delete(requestId);
  serverToolWatchSet.delete(requestId);
  return blocks;
}

/** Extracts server tool blocks from a non-streaming Anthropic JSON response body. */
function extractServerToolBlocksFromJson(text: string): any[] {
  try {
    const parsed = JSON.parse(text);
    const content = Array.isArray(parsed?.content) ? parsed.content : [];
    return content.filter((b: any) => b && ANTHROPIC_SERVER_TOOL_BLOCK_TYPES.has(b.type));
  } catch {
    return [];
  }
}

interface ServerToolBlockEntry {
  block: Record<string, any>;
  partialJson: string;
}

interface ServerToolBlockAccumulator {
  requestId: string;
  decoder: TextDecoder;
  /** Handles SSE framing (event boundaries, CRLF, multi-line data). */
  parser: ReturnType<typeof createParser>;
  /** Blocks currently open (content_block_start seen, content_block_stop not yet seen), by SSE index. */
  active: Map<number, ServerToolBlockEntry>;
}

function createServerToolBlockAccumulator(requestId: string): ServerToolBlockAccumulator {
  const acc: ServerToolBlockAccumulator = {
    requestId,
    decoder: new TextDecoder(),
    parser: undefined as unknown as ReturnType<typeof createParser>,
    active: new Map(),
  };
  acc.parser = createParser({
    onEvent: (event: EventSourceMessage) => processServerToolSseEvent(acc, event),
  });
  return acc;
}

/**
 * Finalizes a block and appends it to `serverToolBlocksMap` immediately —
 * NOT batched until stream end. This must happen synchronously within the
 * same `transform()` call that observed `content_block_stop`, which by
 * construction runs strictly before pi-ai's downstream reader can observe
 * that (or any later) chunk. Deferring this to `flush()` would race pi-ai's
 * own parser: `flush()` only fires at full-stream EOF, but pi-ai can emit
 * its `done` event as soon as it reads the chunk containing `message_stop`,
 * which is earlier.
 */
function finalizeServerToolBlock(
  acc: ServerToolBlockAccumulator,
  entry: ServerToolBlockEntry
): void {
  if (entry.partialJson) {
    try {
      entry.block.input = JSON.parse(entry.partialJson);
    } catch {
      // Keep whatever `input`/`content` content_block_start already provided.
    }
  }
  const existing = serverToolBlocksMap.get(acc.requestId) ?? [];
  existing.push(entry.block);
  serverToolBlocksMap.set(acc.requestId, existing);
}

/**
 * Handles one parsed SSE event. `createParser` invokes this synchronously
 * during `feed()`, so a `content_block_stop`'s finalize lands in
 * serverToolBlocksMap within the same `transform()` call that fed its bytes —
 * preserving the streaming-correctness guarantee in the module doc.
 */
function processServerToolSseEvent(
  acc: ServerToolBlockAccumulator,
  event: EventSourceMessage
): void {
  let evt: any;
  try {
    evt = JSON.parse(event.data);
  } catch {
    return;
  }

  if (evt.type === 'content_block_start') {
    const cb = evt.content_block;
    if (cb && ANTHROPIC_SERVER_TOOL_BLOCK_TYPES.has(cb.type)) {
      acc.active.set(evt.index, { block: { ...cb }, partialJson: '' });
    }
  } else if (evt.type === 'content_block_delta') {
    const entry = acc.active.get(evt.index);
    if (entry && evt.delta?.type === 'input_json_delta') {
      entry.partialJson += evt.delta.partial_json ?? '';
    }
  } else if (evt.type === 'content_block_stop') {
    const entry = acc.active.get(evt.index);
    if (entry) {
      finalizeServerToolBlock(acc, entry);
      acc.active.delete(evt.index);
    }
  }
}

/** Feeds one raw chunk into the SSE parser; complete events fire synchronously via onEvent. */
function feedServerToolBlockAccumulator(acc: ServerToolBlockAccumulator, chunk: Uint8Array): void {
  acc.parser.feed(acc.decoder.decode(chunk, { stream: true }));
}

/** Defensive: finalize any block left open by a truncated/aborted stream. */
function flushServerToolBlockAccumulator(acc: ServerToolBlockAccumulator): void {
  for (const entry of acc.active.values()) {
    finalizeServerToolBlock(acc, entry);
  }
  acc.active.clear();
}

export function installFetchTap(): void {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async function tappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const fetchStart = Date.now();
    const response = await originalFetch(input, init);
    const ttfb = Date.now() - fetchStart;

    // Always record TTFB when there is an active inference-v2 request context,
    // regardless of whether debug logging is enabled.
    const requestId = debugRequestIdStorage.getStore();

    if (!requestId) return response;

    ttfbMap.set(requestId, ttfb);

    const debug = DebugManager.getInstance();
    const debugEnabled = debug.isEnabled() || debug.isEnabledForKey(requestId);
    const watchingServerTools = serverToolWatchSet.has(requestId);

    if (!debugEnabled && !watchingServerTools) return response;

    if (debugEnabled) {
      // Capture response status and headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      debug.addResponseMeta(requestId, response.status, responseHeaders);
    }

    // Determine if the response is streaming (Transfer-Encoding: chunked or no Content-Length)
    const isStream =
      !response.headers.get('content-length') ||
      response.headers.get('transfer-encoding') === 'chunked' ||
      response.headers.get('content-type')?.includes('event-stream') ||
      response.headers.get('content-type')?.includes('stream');

    if (!response.body) return response;

    if (!isStream) {
      // Non-streaming: clone and buffer. When server-tool capture is armed,
      // extraction is awaited before returning so it completes before the
      // executor reads the (separate, un-cloned) body it gets back.
      const cloned = response.clone();
      const textPromise = cloned.text();
      if (debugEnabled) {
        textPromise
          .then((text) => {
            debug.addRawResponse(requestId, text);
            debug.addReconstructedRawResponse(requestId, text);
          })
          .catch(() => {
            /* non-fatal */
          });
      }
      if (watchingServerTools) {
        try {
          const text = await textPromise;
          const blocks = extractServerToolBlocksFromJson(text);
          if (blocks.length > 0) serverToolBlocksMap.set(requestId, blocks);
        } catch {
          /* non-fatal */
        }
      }
      return response;
    }

    // Streaming: wrap body in a TransformStream to copy chunks without backpressure
    const chunks: Uint8Array[] = [];
    const serverToolAcc = watchingServerTools ? createServerToolBlockAccumulator(requestId) : null;
    const ts = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (debugEnabled) chunks.push(chunk);
        if (serverToolAcc) {
          try {
            // Finalizes any completed blocks into serverToolBlocksMap synchronously,
            // strictly before this chunk (or any later one) reaches pi-ai's reader.
            feedServerToolBlockAccumulator(serverToolAcc, chunk);
          } catch {
            /* non-fatal */
          }
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (debugEnabled) {
          // On stream completion, decode the accumulated chunks and record
          try {
            const full = new TextDecoder().decode(
              chunks.reduce((acc, c) => {
                const merged = new Uint8Array(acc.length + c.length);
                merged.set(acc);
                merged.set(c, acc.length);
                return merged;
              }, new Uint8Array())
            );
            debug.addRawResponse(requestId, full);
            debug.addReconstructedRawResponse(requestId, full);
          } catch {
            /* non-fatal */
          }
        }
        // Defensive only: finalizes any block left open by a truncated/aborted
        // stream. In the normal case all blocks were already finalized by
        // transform() above, since content_block_stop always precedes stream EOF.
        if (serverToolAcc) {
          flushServerToolBlockAccumulator(serverToolAcc);
        }
      },
    });

    const tappedBody = response.body.pipeThrough(ts);

    // Reconstruct a new Response with the tapped body
    return new Response(tappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/** Exposed for testing: reset the tap so tests can reinstall with a fresh original. */
export function resetFetchTapForTesting(): void {
  if (!installed) return;
  globalThis.fetch = originalFetch;
  installed = false;
}
