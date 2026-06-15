import { PassThrough } from 'stream';
import { logger } from '../../utils/logger';

/**
 * Stall detection states.
 *
 * State machine (pipeline-level throughput monitoring only):
 *   DISPATCHED ──[first chunk]──→ GRACE_PERIOD ──[grace timer expires]──→ MONITORING
 *                                        │
 *                                        └─[stall detected]──→ THROUGHPUT_STALLED (abort)
 *
 * TTFB stall detection is handled at the dispatcher level via probeStreamingStartWithStallCheck,
 * which runs within the failover loop and can retry with a different provider.
 */
enum StallState {
  /** Waiting for first bytes from upstream. */
  DISPATCHED = 'DISPATCHED',
  /** First bytes received; grace period before throughput enforcement. */
  GRACE_PERIOD = 'GRACE_PERIOD',
  /** Actively monitoring throughput via sliding window. */
  MONITORING = 'MONITORING',
  /** Throughput fell below minBytesPerSecond in the sliding window. */
  THROUGHPUT_STALLED = 'THROUGHPUT_STALLED',
}

/** Ring buffer entry for sliding window throughput calculation. */
interface ByteSample {
  /** Monotonic timestamp (Date.now()). */
  timestamp: number;
  /** Cumulative bytes received at this point. */
  cumulativeBytes: number;
}

/**
 * Resolved stall configuration with all values in milliseconds/bytes.
 * Null fields mean that dimension of stall detection is disabled.
 */
export interface StallConfig {
  /** Time allowed (ms) to receive ttfbBytes. null = disabled. */
  ttfbMs: number | null;
  /** Byte threshold for the TTFB timer. */
  ttfbBytes: number;
  /** Throughput floor (bytes/sec) after grace period. null = disabled. */
  minBytesPerSecond: number | null;
  /** Sliding window width (ms) for throughput calculation. */
  windowMs: number;
  /** Time (ms) after TTFB threshold met before enforcement begins. */
  gracePeriodMs: number;
}

/**
 * StallInspector — a PassThrough stream that monitors upstream response
 * throughput and aborts the request if a throughput stall is detected.
 *
 * TTFB stall detection is handled at the dispatcher level via
 * probeStreamingStartWithStallCheck(), which runs within the failover loop
 * and can retry with a different provider. This inspector only handles
 * throughput stalls (slow streaming after bytes have started flowing),
 * since those occur after response headers have been sent to the client
 * and cannot be retried by the dispatcher.
 *
 * Inserted into the pipeline: fetch body → nodeStream → StallInspector → UsageInspector → reply
 */
export class StallInspector extends PassThrough {
  private requestId: string;
  private config: StallConfig;
  private abortController: AbortController;

  private state: StallState = StallState.DISPATCHED;
  private totalBytes = 0;
  private startTime: number;

  // Ring buffer for sliding window: entries of { timestamp, cumulativeBytes }
  private samples: ByteSample[] = [];
  private readonly MAX_SAMPLES = 500; // Bound memory usage

  // Timers
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicCheck: ReturnType<typeof setInterval> | null = null;

  constructor(requestId: string, config: StallConfig, abortController: AbortController) {
    super();
    this.requestId = requestId;
    this.config = config;
    this.abortController = abortController;
    this.startTime = Date.now();

    // NOTE: TTFB stall detection is handled at the dispatcher level via
    // probeStreamingStartWithStallCheck, which runs within the failover loop
    // and can retry with a different provider. The StallInspector only handles
    // throughput stalls (slow streaming after bytes have started flowing),
    // since those occur after response headers have been sent to the client
    // and cannot be retried by the dispatcher.
    //
    // We do NOT start a TTFB timer here. If ttfbMs is set, the dispatcher's
    // probe will enforce it. The inspector transitions to GRACE_PERIOD on
    // the first chunk, and then to MONITORING for throughput enforcement.
  }

  /**
   * Update the stall configuration (e.g. after per-provider overrides are applied).
   * Only safe to call before any data has flowed through the inspector.
   */
  updateConfig(config: StallConfig): void {
    this.config = config;

    logger.debug(
      `StallInspector.updateConfig: ${this.requestId} state=${this.state} ` +
        `ttfbMs=${config.ttfbMs} minBps=${config.minBytesPerSecond} ` +
        `totalBytes=${this.totalBytes} elapsed=${Date.now() - this.startTime}ms`
    );

    // NOTE: We do NOT start/restart the TTFB timer here. TTFB stall detection
    // is handled by the dispatcher's probeStreamingStartWithStallCheck, which
    // runs within the failover loop and can retry with a different provider.
    // The StallInspector only handles throughput stalls.
  }

  /** Set the request ID (called after pipeline construction). */
  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  /** Get the current stall config. */
  getConfig(): StallConfig {
    return this.config;
  }

  override _transform(chunk: any, encoding: BufferEncoding, callback: Function) {
    if (this.state === StallState.THROUGHPUT_STALLED) {
      // Already stalled — just pass through (abort is already triggered)
      callback(null, chunk);
      return;
    }

    const chunkSize = Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, encoding as BufferEncoding);
    this.totalBytes += chunkSize;
    const now = Date.now();

    // Record sample in ring buffer
    this.samples.push({ timestamp: now, cumulativeBytes: this.totalBytes });
    if (this.samples.length > this.MAX_SAMPLES) {
      this.samples = this.samples.slice(-this.MAX_SAMPLES);
    }

    // State machine transitions
    if (this.state === StallState.DISPATCHED) {
      // TTFB stall is handled at the dispatcher level via probeStreamingStartWithStallCheck.
      // When data reaches here, the dispatcher probe has already verified TTFB.
      // Transition to grace period on first chunk for throughput monitoring.
      if (this.config.minBytesPerSecond != null) {
        this.transitionToGracePeriod(now);
      }
    }

    // Check throughput in MONITORING state (per-chunk check)
    if (this.state === StallState.MONITORING) {
      this.checkThroughput(now);
    }

    // Always pass the chunk through
    callback(null, chunk);
  }

  override _destroy(err: Error | null, callback: (error?: Error | null) => void) {
    this.cleanup();
    callback(err);
  }

  override _flush(callback: Function) {
    this.cleanup();
    callback();
  }

  // ─── State transitions ───────────────────────────────────────────

  private transitionToGracePeriod(now: number): void {
    this.state = StallState.GRACE_PERIOD;
    logger.debug(
      `StallInspector: TTFB threshold met for ${this.requestId} ` +
        `(${this.totalBytes} bytes in ${now - this.startTime}ms), ` +
        `starting grace period (${this.config.gracePeriodMs}ms)`
    );

    if (this.config.gracePeriodMs > 0) {
      this.graceTimer = setTimeout(() => this.onGracePeriodEnd(), this.config.gracePeriodMs);
      this.graceTimer.unref?.();
    } else {
      // Zero grace period — start monitoring immediately
      this.onGracePeriodEnd();
    }
  }

  private onGracePeriodEnd(): void {
    if (this.state !== StallState.GRACE_PERIOD) return;
    this.state = StallState.MONITORING;
    logger.debug(
      `StallInspector: Grace period ended for ${this.requestId}, ` +
        `starting throughput monitoring (minBps=${this.config.minBytesPerSecond}, window=${this.config.windowMs}ms)`
    );

    // Start periodic throughput check. This catches the case where the stream
    // is truly stalled (no chunks at all), since _transform is never called.
    if (this.config.minBytesPerSecond != null) {
      const checkInterval = Math.max(1000, Math.floor(this.config.windowMs / 2));
      this.periodicCheck = setInterval(() => {
        if (this.state === StallState.MONITORING) {
          this.checkThroughput(Date.now());
        }
      }, checkInterval);
      this.periodicCheck.unref?.();
    }
  }

  // ─── Throughput checking ─────────────────────────────────────────

  private checkThroughput(now: number): void {
    if (this.config.minBytesPerSecond == null) return;

    // Prune samples older than the window
    const windowStart = now - this.config.windowMs;
    while (this.samples.length > 1 && this.samples[0]!.timestamp < windowStart) {
      this.samples.shift();
    }

    if (this.samples.length < 2) {
      // Not enough samples yet — need at least 2 data points
      return;
    }

    // Find the sample closest to (now - windowSeconds)
    const oldestSample = this.samples[0]!;
    const bytesInWindow = this.totalBytes - oldestSample.cumulativeBytes;
    const timeSpanMs = now - oldestSample.timestamp;

    if (timeSpanMs <= 0) {
      // All samples are at the same timestamp — can't compute throughput
      return;
    }

    const throughput = (bytesInWindow / timeSpanMs) * 1000; // bytes/sec

    if (throughput < this.config.minBytesPerSecond) {
      this.state = StallState.THROUGHPUT_STALLED;
      this.cleanup();

      logger.info(
        `StallInspector: Throughput stall detected for ${this.requestId} ` +
          `(throughput: ${throughput.toFixed(0)} B/s over last ${timeSpanMs}ms, ` +
          `threshold: ${this.config.minBytesPerSecond} B/s)`
      );

      this.abortController.abort(
        new DOMException(
          `Stream stalled: throughput ${throughput.toFixed(0)} B/s below ` +
            `threshold ${this.config.minBytesPerSecond} B/s`,
          'TimeoutError'
        )
      );
    }
  }

  // ─── Public stats ─────────────────────────────────────────────────

  /**
   * Return a snapshot of the current throughput state for live progress reporting.
   * Safe to call from any goroutine — reads only primitive fields.
   */
  getStats(): {
    state: 'DISPATCHED' | 'GRACE_PERIOD' | 'MONITORING' | 'THROUGHPUT_STALLED';
    bytesReceived: number;
    bytesPerSec: number | null;
    elapsedMs: number;
  } {
    const now = Date.now();
    let bytesPerSec: number | null = null;

    if (this.samples.length >= 2) {
      const windowStart = now - this.config.windowMs;
      // Find oldest sample within the window
      let oldest = this.samples[0]!;
      for (let i = 1; i < this.samples.length; i++) {
        if (this.samples[i]!.timestamp >= windowStart) {
          oldest = this.samples[i - 1]!;
          break;
        }
      }
      const bytesInWindow = this.totalBytes - oldest.cumulativeBytes;
      const timeSpanMs = now - oldest.timestamp;
      if (timeSpanMs > 0) {
        bytesPerSec = (bytesInWindow / timeSpanMs) * 1000;
      }
    }

    return {
      state: this.state as 'DISPATCHED' | 'GRACE_PERIOD' | 'MONITORING' | 'THROUGHPUT_STALLED',
      bytesReceived: this.totalBytes,
      bytesPerSec,
      elapsedMs: now - this.startTime,
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  private cleanup(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.periodicCheck) {
      clearInterval(this.periodicCheck);
      this.periodicCheck = null;
    }
  }
}
