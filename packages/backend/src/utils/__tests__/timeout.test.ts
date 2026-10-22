import { describe, expect, test, vi } from 'vitest';

import { registerSpy } from '../../../test/test-utils';
import { logger } from '../logger';

vi.mock('../../config', () => ({
  getConfig: () => ({ timeout: { defaultSeconds: 4 } }),
}));

import { wireEarlyDisconnectDetection, wireUpstreamTimeout } from '../timeout';

describe('wireUpstreamTimeout', () => {
  test('per-provider timeout can be longer than global timeout', () => {
    const abortController = new AbortController();
    const { resolveTimeoutMs, signal } = wireUpstreamTimeout(abortController);

    expect(resolveTimeoutMs(35_000)).toBe(35_000);
    expect(signal.aborted).toBe(false);
  });

  test('null provider timeout resolves to global timeout', () => {
    const abortController = new AbortController();
    const { resolveTimeoutMs } = wireUpstreamTimeout(abortController);

    expect(resolveTimeoutMs(null)).toBe(4_000);
  });

  test('defers cancellation when bunHandle.closed is observed before dispatch', () => {
    vi.useFakeTimers();
    try {
      const infoSpy = registerSpy(logger, 'info');
      infoSpy.mockClear();
      const abortController = new AbortController();
      const socket = { [Symbol('handle')]: { closed: true } };
      const { cleanup } = wireEarlyDisconnectDetection(
        { raw: { socket } },
        abortController,
        'request-with-deferred-socket-close',
        true
      );

      vi.advanceTimersByTime(1_000);

      expect(abortController.signal.aborted).toBe(false);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        'Socket close observed for request request-with-deferred-socket-close before dispatch ' +
          '(source=bunHandle.closed); deferring upstream cancellation'
      );
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps aborting on bunHandle.closed when cancellation is not deferred', () => {
    vi.useFakeTimers();
    try {
      const abortController = new AbortController();
      const socket = { [Symbol('handle')]: { closed: true } };
      const { cleanup } = wireEarlyDisconnectDetection(
        { raw: { socket } },
        abortController,
        'request-with-immediate-socket-close'
      );

      vi.advanceTimersByTime(250);

      expect(abortController.signal.aborted).toBe(true);
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
