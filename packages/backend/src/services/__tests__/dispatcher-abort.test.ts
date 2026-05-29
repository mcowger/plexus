import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Dispatcher } from '../dispatcher';

// Prevent real network calls
global.fetch = vi.fn(async () => new Response('', { status: 200 })) as any;

describe('Dispatcher — AbortSignal / cancellation', () => {
  let dispatcher: Dispatcher;

  beforeEach(() => {
    dispatcher = new Dispatcher();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('buildCancelledError returns 499 and client_disconnected for a plain abort', () => {
    const controller = new AbortController();
    controller.abort();

    const err = (dispatcher as any).buildCancelledError(controller.signal);
    expect(err.message).toBe('Client disconnected');
    expect(err.routingContext.statusCode).toBe(499);
    expect(err.routingContext.code).toBe('client_disconnected');
  });

  test('buildCancelledError returns 504 and upstream_timeout for a TimeoutError', () => {
    // AbortSignal.timeout() aborts with a reason whose name is 'TimeoutError'
    const signal = AbortSignal.timeout(1);
    // Force the signal into the aborted state synchronously via a dedicated controller
    const controller = new AbortController();
    const timeoutReason = new DOMException('signal timed out', 'TimeoutError');
    controller.abort(timeoutReason);

    const err = (dispatcher as any).buildCancelledError(controller.signal);
    expect(err.message).toBe('Upstream timeout');
    expect(err.routingContext.statusCode).toBe(504);
    expect(err.routingContext.code).toBe('upstream_timeout');
  });

  test('per-attempt timeout does not abort the route signal', async () => {
    vi.useFakeTimers();
    const routeController = new AbortController();

    const attemptTimeout = (dispatcher as any).createAttemptTimeout(
      routeController.signal,
      35_000,
      () => 4_000
    );

    await vi.advanceTimersByTimeAsync(4_000);

    expect(attemptTimeout.isTimedOut()).toBe(true);
    expect(attemptTimeout.signal.aborted).toBe(true);
    expect(routeController.signal.aborted).toBe(false);
  });

  test('buildTimeoutError returns retryable upstream timeout metadata', () => {
    const err = (dispatcher as any).buildTimeoutError();

    expect(err.message).toBe('Upstream timeout');
    expect(err.routingContext.statusCode).toBe(504);
    expect(err.routingContext.code).toBe('upstream_timeout');
  });

  test('executeProviderRequest forwards AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = mockFetch as any;

    await (dispatcher as any).executeProviderRequest(
      'https://example.com/v1/test',
      { 'content-type': 'application/json' },
      { model: 'test' },
      controller.signal
    );

    // When config is not initialized (test env), the signal is passed through as-is
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/v1/test',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  test('buildCancelledError produces 499 for a plain abort (via abort loop guard)', () => {
    // Verifies the helper that is called by the top-of-loop abort guard
    // and per-attempt catch blocks inside dispatch().
    const controller = new AbortController();
    controller.abort('client closed connection');

    const err = (dispatcher as any).buildCancelledError(controller.signal);
    expect(err.routingContext.statusCode).toBe(499);
    expect(err.routingContext.code).toBe('client_disconnected');
    // Should not be retried — 499 is intentionally outside retryable status codes
    expect(err.routingContext.statusCode).not.toBe(500);
    expect(err.routingContext.statusCode).not.toBe(503);
  });
});
