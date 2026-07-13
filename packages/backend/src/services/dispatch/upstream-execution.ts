import { getConfig } from '../../config';
import type { StallConfig } from '../inspectors/stall-inspector';
import { probeStreamingStart as probeStreamStart } from '../probes/stream-probe';

export type AttemptTimeout = {
  signal: AbortSignal;
  isTimedOut: () => boolean;
  cleanup: () => void;
};

export type ResolveTimeoutMs = (timeoutMs?: number | null) => number;

/** Creates the per-provider timeout used by an upstream attempt. */
export function createAttemptTimeout(
  signal: AbortSignal | undefined,
  providerTimeoutMs: number | null | undefined,
  resolveTimeoutMs?: ResolveTimeoutMs
): AttemptTimeout {
  const timeoutMs = resolveTimeoutMs
    ? resolveTimeoutMs(providerTimeoutMs ?? null)
    : (providerTimeoutMs ?? (getConfig().timeout?.defaultSeconds ?? 300) * 1000);
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new DOMException('Upstream request timed out', 'TimeoutError'));
  }, timeoutMs);
  timeoutId.unref?.();

  return {
    signal: signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal,
    isTimedOut: () => timeoutController.signal.aborted,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/** Performs the HTTP request to an upstream provider. */
export async function executeUpstreamRequest(
  url: string,
  headers: Record<string, string>,
  payload: any,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

/** Probes a streaming response before it is committed to the client. */
export function probeStreamingStart(
  response: Response,
  stallConfig?: StallConfig | null
): Promise<{ ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }> {
  return probeStreamStart(response, stallConfig);
}
