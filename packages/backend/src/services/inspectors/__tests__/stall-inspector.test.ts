import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StallInspector, type StallConfig } from '../stall-inspector';
import { PassThrough } from 'stream';

function createConfig(overrides: Partial<StallConfig> = {}): StallConfig {
  return {
    ttfbMs: 5000,
    ttfbBytes: 100,
    minBytesPerSecond: 500,
    windowMs: 10000,
    gracePeriodMs: 3000,
    ...overrides,
  };
}

function createChunk(size: number): Buffer {
  return Buffer.alloc(size, 'a');
}

describe('StallInspector', () => {
  let abortController: AbortController;
  let abortReason: DOMException | null = null;

  beforeEach(() => {
    abortController = new AbortController();
    abortReason = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TTFB is handled at dispatcher level', () => {
    it("does NOT start a TTFB timer — that is the dispatcher probe's job", () => {
      vi.useFakeTimers();

      const config = createConfig({ ttfbMs: 5000, ttfbBytes: 100, minBytesPerSecond: null });
      const inspector = new StallInspector('req-1', config, abortController);

      // Write only 50 bytes (below the 100-byte threshold)
      inspector.write(createChunk(50));

      // Advance past TTFB timeout — the StallInspector should NOT abort
      // because TTFB detection is handled by the dispatcher's probe
      vi.advanceTimersByTime(5001);

      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });

    it('does not abort even when ttfbMs expires with no bytes', () => {
      vi.useFakeTimers();

      const config = createConfig({ ttfbMs: 5000, ttfbBytes: 100, minBytesPerSecond: null });
      const inspector = new StallInspector('req-2', config, abortController);

      // Advance past TTFB timeout without any bytes
      vi.advanceTimersByTime(6000);

      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });
  });

  describe('Throughput stall detection', () => {
    it('detects throughput stall after grace period when stream is too slow', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({
        ttfbMs: null,
        minBytesPerSecond: 500,
        windowMs: 3000,
        gracePeriodMs: 1000,
      });
      const inspector = new StallInspector('req-5', config, abortController);

      abortController.signal.addEventListener('abort', () => {
        abortReason = abortController.signal.reason;
      });

      // Write initial bytes to transition past DISPATCHED state
      inspector.write(createChunk(100));

      // Advance through grace period
      vi.advanceTimersByTime(1100);

      // Write a very small amount (10 bytes)
      inspector.write(createChunk(10));

      // Advance past the window so throughput is clearly below 500 B/s
      vi.advanceTimersByTime(3100);

      expect(abortController.signal.aborted).toBe(true);
      expect(abortReason?.name).toBe('TimeoutError');
      expect(abortReason?.message).toContain('throughput');

      inspector.destroy();
    });

    it('does not abort when throughput is above threshold', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({
        ttfbMs: null,
        minBytesPerSecond: 100,
        windowMs: 2000,
        gracePeriodMs: 500,
      });
      const inspector = new StallInspector('req-6', config, abortController);

      // Write initial bytes to trigger monitoring
      inspector.write(createChunk(100));

      // Advance through grace period
      vi.advanceTimersByTime(600);

      // Write enough bytes to stay above 100 B/s
      // 100 bytes over 2 seconds = 50 B/s, so we need more
      inspector.write(createChunk(500));

      // Not enough time for a stall yet
      expect(abortController.signal.aborted).toBe(false);

      // Continue writing enough data
      vi.advanceTimersByTime(1000);
      inspector.write(createChunk(500));

      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });

    it('catches fully stalled stream via periodic check (no chunks arriving)', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({
        ttfbMs: 5000,
        ttfbBytes: 100,
        minBytesPerSecond: 500,
        windowMs: 3000,
        gracePeriodMs: 1000,
      });
      const inspector = new StallInspector('req-7', config, abortController);

      abortController.signal.addEventListener('abort', () => {
        abortReason = abortController.signal.reason;
      });

      // Write enough bytes to transition out of DISPATCHED state
      inspector.write(createChunk(200));

      // Advance through grace period + some monitoring time
      // The periodic check fires every windowMs/2 = 1500ms
      vi.advanceTimersByTime(2000); // Past grace period (1000ms) + into monitoring

      // Write a tiny chunk to create a second data point
      inspector.write(createChunk(5));

      // Now advance far enough that throughput over the window is below threshold.
      // With 205 total bytes over 5+ seconds, throughput is ~40 B/s, well below 500.
      vi.advanceTimersByTime(4000);

      expect(abortController.signal.aborted).toBe(true);
      expect(abortReason?.message).toContain('throughput');

      inspector.destroy();
    });
  });

  describe('State machine', () => {
    it('transitions from DISPATCHED to GRACE_PERIOD on first chunk when throughput monitoring is active', () => {
      vi.useFakeTimers();

      const config = createConfig({
        ttfbMs: 10000,
        ttfbBytes: 50,
        minBytesPerSecond: 100,
        gracePeriodMs: 5000,
      });
      const inspector = new StallInspector('req-8', config, abortController);

      // Write first chunk — should transition to GRACE_PERIOD
      inspector.write(createChunk(60));

      // TTFB timer no longer exists — should not abort
      vi.advanceTimersByTime(11000);
      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });

    it('transitions from GRACE_PERIOD to MONITORING after grace period', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({
        ttfbMs: 5000,
        ttfbBytes: 50,
        minBytesPerSecond: 100,
        windowMs: 3000,
        gracePeriodMs: 2000,
      });
      const inspector = new StallInspector('req-9', config, abortController);

      // First chunk triggers transition to GRACE_PERIOD
      inspector.write(createChunk(60));

      // During grace period — no abort even if throughput is low
      vi.advanceTimersByTime(1000);
      expect(abortController.signal.aborted).toBe(false);

      // Advance past grace period but keep sending data
      vi.advanceTimersByTime(1500);
      inspector.write(createChunk(1000)); // Plenty of throughput
      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });

    it('stays in DISPATCHED if no throughput monitoring is configured', () => {
      vi.useFakeTimers();

      const config = createConfig({ ttfbMs: 5000, minBytesPerSecond: null });
      const inspector = new StallInspector('req-dispatched', config, abortController);

      // Write bytes — but no throughput monitoring, so should stay in DISPATCHED
      inspector.write(createChunk(100));

      // Advance time — should not abort (no TTFB timer, no throughput check)
      vi.advanceTimersByTime(10000);
      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });
  });

  describe('updateConfig', () => {
    it('updates config but does not start TTFB timer (dispatcher handles TTFB)', () => {
      vi.useFakeTimers();

      const config = createConfig({ ttfbMs: 10000, ttfbBytes: 100, minBytesPerSecond: null });
      const inspector = new StallInspector('req-10', config, abortController);

      // Per-provider override with shorter TTFB — but the inspector should NOT
      // start a TTFB timer because TTFB detection is handled by the dispatcher probe
      inspector.updateConfig({
        ...config,
        ttfbMs: 5000,
      });

      // Advance well past the 5000ms TTFB — should NOT abort
      vi.advanceTimersByTime(6000);

      expect(abortController.signal.aborted).toBe(false);

      inspector.destroy();
    });

    it('enables throughput monitoring when updateConfig adds minBytesPerSecond', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({ ttfbMs: 5000, minBytesPerSecond: null });
      const inspector = new StallInspector('req-10b', config, abortController);

      abortController.signal.addEventListener('abort', () => {
        abortReason = abortController.signal.reason;
      });

      // Write initial data while no throughput monitoring
      inspector.write(createChunk(50));

      // Update config to enable throughput monitoring
      inspector.updateConfig({
        ...config,
        minBytesPerSecond: 1000,
        gracePeriodMs: 500,
        windowMs: 2000,
      });

      // Write a chunk to trigger state transition (DISPATCHED → GRACE_PERIOD)
      inspector.write(createChunk(5));

      // Advance through grace period + monitoring window + periodic check
      vi.advanceTimersByTime(5000);

      expect(abortController.signal.aborted).toBe(true);
      expect(abortReason?.message).toContain('throughput');

      inspector.destroy();
    });
  });

  describe('Cleanup', () => {
    it('cleans up timers on destroy', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({ minBytesPerSecond: 500, gracePeriodMs: 1000 });
      const inspector = new StallInspector('req-11', config, abortController);

      // Start monitoring
      inspector.write(createChunk(100));

      inspector.destroy();

      // Timer should be cleared — no abort after the timeout
      vi.advanceTimersByTime(6000);
      expect(abortController.signal.aborted).toBe(false);
    });

    it('cleans up timers on flush (normal stream end)', () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const config = createConfig({ minBytesPerSecond: 500, gracePeriodMs: 1000 });
      const inspector = new StallInspector('req-12', config, abortController);

      // Start monitoring
      inspector.write(createChunk(100));

      // Simulate a normal stream end
      inspector.end();

      vi.advanceTimersByTime(6000);
      expect(abortController.signal.aborted).toBe(false);
    });
  });

  describe('Passthrough behavior', () => {
    it('passes chunks through unchanged', () => {
      const config = createConfig({ ttfbMs: 5000, minBytesPerSecond: null });
      const inspector = new StallInspector('req-13', config, abortController);

      const received: Buffer[] = [];
      inspector.on('data', (chunk: Buffer) => received.push(chunk));

      const chunk1 = createChunk(50);
      const chunk2 = createChunk(75);

      inspector.write(chunk1);
      inspector.write(chunk2);

      expect(received.length).toBe(2);
      expect(received[0]!.length).toBe(50);
      expect(received[1]!.length).toBe(75);

      inspector.destroy();
    });
  });
});
