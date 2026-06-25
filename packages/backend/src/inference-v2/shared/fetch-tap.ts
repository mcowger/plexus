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
 */

import { DebugManager } from '../../services/debug-manager';
import { debugRequestIdStorage } from './pi-ai-executor';

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
    if (!debug.isEnabled() && !debug.isEnabledForKey(requestId)) return response;

    // Capture response status and headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    debug.addResponseMeta(requestId, response.status, responseHeaders);

    // Determine if the response is streaming (Transfer-Encoding: chunked or no Content-Length)
    const isStream =
      !response.headers.get('content-length') ||
      response.headers.get('transfer-encoding') === 'chunked' ||
      response.headers.get('content-type')?.includes('event-stream') ||
      response.headers.get('content-type')?.includes('stream');

    if (!response.body) return response;

    if (!isStream) {
      // Non-streaming: clone and buffer
      const cloned = response.clone();
      cloned
        .text()
        .then((text) => {
          debug.addRawResponse(requestId, text);
          debug.addReconstructedRawResponse(requestId, text);
        })
        .catch(() => {
          /* non-fatal */
        });
      return response;
    }

    // Streaming: wrap body in a TransformStream to copy chunks without backpressure
    const chunks: Uint8Array[] = [];
    const ts = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        chunks.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
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
