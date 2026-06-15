/**
 * Upstream request timeout utilities.
 *
 * Route-level timeout utilities.
 *
 * The route AbortController is reserved for client disconnects. Upstream
 * timeouts are resolved here but enforced per provider attempt in the
 * dispatcher so a timed-out provider can fail over without aborting the whole
 * route.
 */

import { getConfig } from '../config';
import { logger } from './logger';

/**
 * Resolve timeout settings for a route.
 *
 * The dispatcher calls `resolveTimeoutMs` after routing picks a provider.
 * Provider timeouts override the global default and may be shorter or longer.
 *
 * @param abortController The route's AbortController (the one passed to
 *   handleResponse for stream disconnect detection).
 * @param defaultTimeoutMs Override for the effective timeout in milliseconds.
 *   When null/undefined, the global default is used.
 * @returns The route signal plus a timeout resolver for provider attempts.
 */
export function wireUpstreamTimeout(
  abortController: AbortController,
  defaultTimeoutMs?: number | null
): { signal: AbortSignal; resolveTimeoutMs: (timeoutMs?: number | null) => number } {
  const config = getConfig();
  const globalTimeoutSeconds = config.timeout?.defaultSeconds ?? 300;
  const globalTimeoutMs = defaultTimeoutMs ?? globalTimeoutSeconds * 1000;

  return {
    signal: abortController.signal,
    resolveTimeoutMs: (providerTimeoutMs?: number | null) => providerTimeoutMs ?? globalTimeoutMs,
  };
}

/**
 * Start early client-disconnect detection before dispatch.
 *
 * Bun's node:http layer does NOT reliably fire close/abort events when a
 * client disconnects during streaming POST responses. The only working
 * detection mechanism is polling `bunHandle.closed` on the Socket object.
 *
 * The response-handler's polling only starts after the dispatcher returns,
 * so there's a gap: if the client disconnects while fetch() is still
 * pending (upstream hasn't responded yet), nothing detects the disconnect.
 * The fetch keeps running, wasting upstream API quota.
 *
 * This function starts the bunHandle.closed polling BEFORE the dispatch,
 * and aborts the route's AbortController when the client disconnects.
 * This propagates through the route signal to fetch(), causing it to
 * throw AbortError and the dispatcher to stop waiting.
 *
 * Callers must call cleanup() after the dispatch completes (whether success
 * or failure) to stop the polling interval.
 */
export function wireEarlyDisconnectDetection(
  request: any,
  abortController: AbortController
): { cleanup: () => void } {
  const rawSocket = request?.raw?.socket;
  const symHandle = rawSocket
    ? Object.getOwnPropertySymbols(rawSocket).find((s: Symbol) => s.toString() === 'Symbol(handle)')
    : undefined;
  const bunHandle = symHandle ? rawSocket[symHandle] : null;

  if (!bunHandle) {
    // Can't detect disconnect without bunHandle (non-Bun runtime or no socket)
    return { cleanup: () => {} };
  }

  let cleanedUp = false;
  let poll: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (cleanedUp) return;
    if (bunHandle.closed) {
      if (!abortController.signal.aborted) {
        logger.debug(`Early disconnect detected (bunHandle.closed), aborting upstream fetch`);
        abortController.abort(new DOMException('Client disconnected', 'AbortError'));
      }
      cleanedUp = true;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    }
  }, 250);

  return {
    cleanup: () => {
      cleanedUp = true;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    },
  };
}
