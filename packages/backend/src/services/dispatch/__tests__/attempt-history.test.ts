import { describe, expect, it } from 'vitest';
import {
  appendFailureAttempt,
  appendSkippedAttempt,
  buildAllTargetsFailedError,
  type ErrorSummaryFormatter,
  type FailureReasonFormatter,
} from '../attempt-history';
import { EMPTY_COMPLETION_REASON } from '../empty-completion';
import type { RouteResult } from '../../routing/router';
import type { RetryAttemptRecord } from '../dispatcher-types';

// Minimal RouteResult factory — attempt-history only reads `provider`/`model`,
// so `config` is stubbed out (mirrors adapter-resolver.test.ts's makeRoute).
function makeRoute(provider: string, model: string): RouteResult {
  return {
    provider,
    model,
    config: {} as any,
  } as RouteResult;
}

function httpError(statusCode: number, message: string) {
  const error = new Error(message) as any;
  error.routingContext = { statusCode };
  return error;
}

// Mirrors the failed attempt the empty-completion failover records in
// standard-attempt-request.ts: the HTTP call itself succeeded (statusCode
// 200) but the completion carried no visible output.
function emptyCompletionError() {
  const error = new Error(EMPTY_COMPLETION_REASON) as any;
  error.routingContext = { statusCode: 200, cooldownTriggered: false };
  return error;
}

// Pass-through stand-ins for the real Dispatcher.formatFailureReason /
// compactProviderErrorSummary — buildAllTargetsFailedError takes both as
// injected dependencies, so tests don't need the real implementations.
const formatFailureReason: FailureReasonFormatter = (error) =>
  error?.message ?? 'Unknown provider error';
const compactErrorSummary: ErrorSummaryFormatter = (value) => String(value);

describe('buildAllTargetsFailedError', () => {
  it('includes the HTTP status code recorded for each attempt in the provider list', () => {
    const retryHistory: RetryAttemptRecord[] = [];
    const routeA = makeRoute('openai', 'gpt-5.5');
    const routeB = makeRoute('OpenLimits/openai', 'gpt-5.5');

    appendFailureAttempt(retryHistory, routeA, httpError(400, 'bad request'), formatFailureReason);
    appendFailureAttempt(retryHistory, routeB, httpError(400, 'bad request'), formatFailureReason);

    const error = buildAllTargetsFailedError(
      httpError(400, 'bad request'),
      ['openai/gpt-5.5', 'OpenLimits/openai/gpt-5.5'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe(
      'All targets failed: openai/gpt-5.5 (400), OpenLimits/openai/gpt-5.5 (400). Last error: bad request'
    );
  });

  it('uses the status code recorded for each attempt, not just the last error', () => {
    const retryHistory: RetryAttemptRecord[] = [];
    const routeA = makeRoute('p1', 'model-1');
    const routeB = makeRoute('p2', 'model-2');

    appendFailureAttempt(retryHistory, routeA, httpError(400, 'first failed'), formatFailureReason);
    appendFailureAttempt(
      retryHistory,
      routeB,
      httpError(503, 'second failed'),
      formatFailureReason
    );

    const error = buildAllTargetsFailedError(
      httpError(503, 'second failed'),
      ['p1/model-1', 'p2/model-2'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe(
      'All targets failed: p1/model-1 (400), p2/model-2 (503). Last error: second failed'
    );
  });

  it('tags an empty-completion failover attempt as (empty), not the misleading (200)', () => {
    // A failed attempt whose HTTP status was 200 can only mean the call
    // succeeded but the completion was unusable — rendering the raw "(200)"
    // next to real failure codes reads like a contradiction to clients.
    const retryHistory: RetryAttemptRecord[] = [];
    const emptyRoute = makeRoute('p1', 'm1');
    const failedRoute = makeRoute('p2', 'm2');

    appendFailureAttempt(
      retryHistory,
      emptyRoute,
      emptyCompletionError(),
      formatFailureReason,
      undefined,
      true
    );
    appendFailureAttempt(retryHistory, failedRoute, httpError(500, 'boom'), formatFailureReason);

    const error = buildAllTargetsFailedError(
      httpError(500, 'boom'),
      ['p1/m1', 'p2/m2'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe('All targets failed: p1/m1 (empty), p2/m2 (500). Last error: boom');
  });

  it('tags a network/transport failure that has no status code as (network)', () => {
    const retryHistory: RetryAttemptRecord[] = [];
    const route = makeRoute('p1', 'model-1');
    const networkError = new Error('fetch failed');

    appendFailureAttempt(retryHistory, route, networkError, formatFailureReason);

    const error = buildAllTargetsFailedError(
      networkError,
      ['p1/model-1'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe(
      'All targets failed: p1/model-1 (network). Last error: fetch failed'
    );
  });

  it('tags a stalled attempt as (stall) instead of (network)', () => {
    const retryHistory: RetryAttemptRecord[] = [];
    const route = makeRoute('p1', 'model-1');
    // Em-dash matches the production stall message verbatim (see
    // standard-attempt-request.ts's "Stream stalled: TTFB timeout — ...").
    const stallError = new Error('Stream stalled: TTFB timeout — no response within 5000ms');

    appendFailureAttempt(retryHistory, route, stallError, formatFailureReason, undefined, true);

    const error = buildAllTargetsFailedError(
      stallError,
      ['p1/model-1'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe(
      'All targets failed: p1/model-1 (stall). Last error: Stream stalled: TTFB timeout — no response within 5000ms'
    );
  });

  it('excludes a skipped attempt from the summary, matching attemptedProviders as-is (current dispatch behavior)', () => {
    const retryHistory: RetryAttemptRecord[] = [];
    const skippedRoute = makeRoute('p1', 'model-1');
    const attemptedRoute = makeRoute('p2', 'model-2');

    appendSkippedAttempt(retryHistory, skippedRoute, 'Provider p1/model-1 is on cooldown');
    appendFailureAttempt(retryHistory, attemptedRoute, httpError(500, 'boom'), formatFailureReason);

    // Only p2/model-2 was actually attempted — the dispatch loop never adds
    // a skipped target (p1/model-1) to attemptedProviders, and the summary
    // must not grow to include it either.
    const error = buildAllTargetsFailedError(
      httpError(500, 'boom'),
      ['p2/model-2'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe('All targets failed: p2/model-2 (500). Last error: boom');
    expect(error.message).not.toContain('p1/model-1');
  });

  it('renders a joined-list entry untagged when its only recorded retryHistory attempt was a skip', () => {
    // Defensive/future-proofing case from the T6 brief: today's dispatch
    // loops never put a skipped target into attemptedProviders. Skipped
    // retryHistory entries are excluded from the FIFO provider/model queues
    // (see formatAttemptedProvidersSummary) precisely so a skip can never be
    // matched up with a LATER real attempt that shares its key. If a future
    // caller did list a skipped-only target in attemptedProviders, there is
    // now no matching queued record to tag it with, so it renders untagged
    // rather than mislabeled as the wrong outcome.
    const retryHistory: RetryAttemptRecord[] = [];
    const skippedRoute = makeRoute('p1', 'model-1');
    appendSkippedAttempt(retryHistory, skippedRoute, 'Provider p1/model-1 is on cooldown');

    const error = buildAllTargetsFailedError(
      new Error('boom'),
      ['p1/model-1'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe('All targets failed: p1/model-1. Last error: boom');
  });

  it('renders the real attempt tag, not (skipped), when a skip shares a provider/model key with a later real attempt', () => {
    // The bug this guards: formatAttemptedProvidersSummary used to build its
    // FIFO provider/model queues from ALL retryHistory entries, including
    // skips. A skip recorded for a key that a LATER real attempt reuses
    // (e.g. the same target skipped once via cooldown, then actually
    // dispatched — and rejected — as the final failover candidate) would
    // occupy the front of that queue, so the real attempt's `.shift()`
    // consumed the skip entry instead and rendered `(skipped)` in place of
    // the real HTTP status. Production only ever lists the REAL attempt in
    // `attemptedProviders` for this key (skips never reach it), so the
    // summary must reflect the real attempt's outcome.
    const retryHistory: RetryAttemptRecord[] = [];
    const route = makeRoute('p1', 'model-1');

    appendSkippedAttempt(retryHistory, route, 'Provider p1/model-1 is on cooldown');
    appendFailureAttempt(retryHistory, route, httpError(400, 'bad request'), formatFailureReason);

    const error = buildAllTargetsFailedError(
      httpError(400, 'bad request'),
      ['p1/model-1'],
      retryHistory,
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe('All targets failed: p1/model-1 (400). Last error: bad request');
  });

  it('keeps the "All targets failed: " prefix, ". Last error: " suffix, and the "none" fallback', () => {
    const error = buildAllTargetsFailedError(
      new Error('boom'),
      [],
      [],
      formatFailureReason,
      compactErrorSummary
    );

    expect(error.message).toBe('All targets failed: none. Last error: boom');
  });
});
