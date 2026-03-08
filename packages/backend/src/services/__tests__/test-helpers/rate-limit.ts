/**
 * Rate Limit Test Helpers
 *
 * Deterministic test utilities for low-RPM provider testing.
 * Provides fake time control, provider config fixtures, and queue state assertions.
 *
 * IMPORTANT: These helpers are designed for test isolation. Do NOT use global mock.module
 * for time control - instead use the ClockController pattern below.
 */

import { expect } from 'bun:test';

// ============================================================================
// Types
// ============================================================================

/**
 * Low-RPM provider configuration for testing
 */
export interface LowRpmProviderConfig {
  /** Provider identifier */
  provider: string;
  /** Model identifier */
  model: string;
  /** Requests per minute limit */
  rpm: number;
  /** Optional burst capacity (defaults to 1) */
  burst?: number;
  /** Optional queue depth limit */
  maxQueueDepth?: number;
  /** Optional queue timeout in milliseconds */
  queueTimeoutMs?: number;
}

/**
 * Expected queue state for assertions
 */
export interface ExpectedQueueState {
  /** Current depth of the queue */
  depth: number;
  /** Number of waiters blocked on permits */
  waiters: number;
  /** Whether queue has timed-out requests */
  hasTimeouts: boolean;
  /** Number of permits currently available */
  availablePermits: number;
}

/**
 * Represents a queued request in tests
 */
export interface QueuedRequest {
  id: string;
  provider: string;
  model: string;
  queuedAt: number;
  timeoutAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// ============================================================================
// Clock Controller - Fake Time Control
// ============================================================================

/**
 * ClockController provides deterministic fake time for tests.
 * Uses performance.now() as the underlying clock source.
 *
 * Example usage:
 * ```typescript
 * const clock = createClockController();
 * const now = clock.now(); // 0
 * clock.advanceTime(1000);   // Advance by 1 second
 * const later = clock.now(); // 1000
 * ```
 */
export interface ClockController {
  /** Get current fake time in milliseconds */
  now(): number;
  /** Advance time by specified milliseconds */
  advanceTime(ms: number): void;
  /** Set time to a specific value */
  setTime(ms: number): void;
  /** Reset to initial state */
  reset(): void;
}

/**
 * Creates a fake clock controller for deterministic time-based tests.
 * Starts at time 0 and can be advanced arbitrarily.
 */
export function createClockController(): ClockController {
  let currentTime = 0;

  return {
    now: () => currentTime,
    advanceTime: (ms: number) => {
      if (ms < 0) {
        throw new Error('Cannot advance time by negative milliseconds');
      }
      currentTime += ms;
    },
    setTime: (ms: number) => {
      if (ms < 0) {
        throw new Error('Cannot set time to negative value');
      }
      currentTime = ms;
    },
    reset: () => {
      currentTime = 0;
    },
  };
}

/**
 * Advance time by specified milliseconds using a clock controller.
 * Convenience wrapper for clock.advanceTime().
 */
export function advanceTime(clock: ClockController, ms: number): void {
  clock.advanceTime(ms);
}

/**
 * Calculate time until next permit refill for a given RPM.
 * Useful for testing rate limiter timing calculations.
 */
export function timeUntilNextRefill(rpm: number): number {
  return Math.ceil(60000 / rpm); // milliseconds between refills
}

// ============================================================================
// Provider Config Fixtures
// ============================================================================

/**
 * Creates a low-RPM provider configuration for testing.
 *
 * @param config - Partial config to override defaults
 * @returns Complete LowRpmProviderConfig
 *
 * Example:
 * ```typescript
 * const provider = createLowRpmProvider({ rpm: 5 });
 * // { provider: 'test', model: 'model-1', rpm: 5, burst: 1, maxQueueDepth: 10, queueTimeoutMs: 30000 }
 * ```
 */
export function createLowRpmProvider(
  config: Partial<LowRpmProviderConfig> = {}
): LowRpmProviderConfig {
  return {
    provider: config.provider ?? 'test-provider',
    model: config.model ?? 'test-model',
    rpm: config.rpm ?? 10,
    burst: config.burst ?? 1,
    maxQueueDepth: config.maxQueueDepth ?? 10,
    queueTimeoutMs: config.queueTimeoutMs ?? 30000,
  };
}

/**
 * Pre-configured provider fixtures for common test scenarios.
 */
export const LowRpmFixtures = {
  /** Ultra-low RPM (5 RPM = 1 request per 12 seconds) */
  ultraLow: (): LowRpmProviderConfig =>
    createLowRpmProvider({
      provider: 'ultra-low-provider',
      model: 'ultra-model',
      rpm: 5,
      burst: 1,
      maxQueueDepth: 5,
      queueTimeoutMs: 60000,
    }),

  /** Low RPM (10 RPM = 1 request per 6 seconds) */
  low: (): LowRpmProviderConfig =>
    createLowRpmProvider({
      provider: 'low-rpm-provider',
      model: 'low-model',
      rpm: 10,
      burst: 1,
      maxQueueDepth: 10,
      queueTimeoutMs: 30000,
    }),

  /** Medium-low RPM (30 RPM = 1 request per 2 seconds) */
  medium: (): LowRpmProviderConfig =>
    createLowRpmProvider({
      provider: 'medium-rpm-provider',
      model: 'medium-model',
      rpm: 30,
      burst: 2,
      maxQueueDepth: 20,
      queueTimeoutMs: 15000,
    }),

  /** Burst configuration for testing burst capacity */
  burst: (): LowRpmProviderConfig =>
    createLowRpmProvider({
      provider: 'burst-provider',
      model: 'burst-model',
      rpm: 10,
      burst: 5, // Allow 5 requests immediately
      maxQueueDepth: 10,
      queueTimeoutMs: 30000,
    }),

  /** Strict single-request (1 RPM) for timeout testing */
  strict: (): LowRpmProviderConfig =>
    createLowRpmProvider({
      provider: 'strict-provider',
      model: 'strict-model',
      rpm: 1,
      burst: 1,
      maxQueueDepth: 3,
      queueTimeoutMs: 5000, // Short timeout for fast tests
    }),
} as const;

// ============================================================================
// Queue State Assertions
// ============================================================================

/**
 * Asserts that queue state matches expected values.
 * Provides clear error messages on mismatch.
 *
 * @param actual - The actual queue state
 * @param expected - The expected queue state
 *
 * Example:
 * ```typescript
 * const state = getQueueState(provider);
 * assertQueueState(state, { depth: 2, waiters: 1, hasTimeouts: false, availablePermits: 0 });
 * ```
 */
export function assertQueueState(
  actual: ExpectedQueueState,
  expected: Partial<ExpectedQueueState>
): void {
  const assertions: string[] = [];

  if (expected.depth !== undefined && actual.depth !== expected.depth) {
    assertions.push(`depth: expected ${expected.depth}, got ${actual.depth}`);
  }

  if (expected.waiters !== undefined && actual.waiters !== expected.waiters) {
    assertions.push(`waiters: expected ${expected.waiters}, got ${actual.waiters}`);
  }

  if (expected.hasTimeouts !== undefined && actual.hasTimeouts !== expected.hasTimeouts) {
    assertions.push(`hasTimeouts: expected ${expected.hasTimeouts}, got ${actual.hasTimeouts}`);
  }

  if (
    expected.availablePermits !== undefined &&
    actual.availablePermits !== expected.availablePermits
  ) {
    assertions.push(
      `availablePermits: expected ${expected.availablePermits}, got ${actual.availablePermits}`
    );
  }

  if (assertions.length > 0) {
    throw new Error(`Queue state mismatch:\n${assertions.join('\n')}`);
  }
}

/**
 * Asserts that queue depth is exactly the expected value.
 */
export function assertQueueDepth(actual: number, expected: number): void {
  expect(actual).toBe(expected);
}

/**
 * Asserts that no requests are queued (depth = 0, waiters = 0).
 */
export function assertQueueEmpty(state: ExpectedQueueState): void {
  assertQueueState(state, { depth: 0, waiters: 0, hasTimeouts: false });
}

/**
 * Asserts that queue has waiting requests (waiters > 0).
 */
export function assertQueueHasWaiters(state: ExpectedQueueState, expectedCount: number): void {
  expect(state.waiters).toBe(expectedCount);
}

// ============================================================================
// Test Isolation Helpers
// ============================================================================

/**
 * Creates an isolated test context that won't pollute global state.
 * Each test should create its own context.
 *
 * @returns Test context with clock and cleanup utilities
 *
 * Example:
 * ```typescript
 * let testCtx: ReturnType<typeof createIsolatedTestContext>;
 *
 * beforeEach(() => {
 *   testCtx = createIsolatedTestContext();
 * });
 *
 * afterEach(() => {
 *   testCtx.cleanup();
 * });
 * ```
 */
export function createIsolatedTestContext() {
  const clock = createClockController();
  const cleanups: Array<() => void> = [];

  return {
    clock,
    /**
     * Register a cleanup function to run after test.
     * Cleanups run in reverse order (LIFO).
     */
    onCleanup: (fn: () => void) => {
      cleanups.push(fn);
    },
    /**
     * Run all registered cleanup functions.
     * Called automatically in afterEach.
     */
    cleanup: () => {
      // Run cleanups in reverse order
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try {
          cleanups[i]();
        } catch (e) {
          // Ignore cleanup errors to ensure all cleanups run
        }
      }
      cleanups.length = 0;
      clock.reset();
    },
  };
}

// ============================================================================
// Async Test Helpers
// ============================================================================

/**
 * Creates a deferred promise that can be resolved/rejected externally.
 * Useful for simulating async operations in tests.
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Waits for a condition to be met, polling at intervals.
 * Uses fake clock for deterministic timing.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait (uses fake clock)
 * @param intervalMs - Polling interval
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 10
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Flushes all pending promises immediately.
 * Useful after advancing fake timers to resolve any pending microtasks.
 */
export async function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ============================================================================
// Rate Limit Math Helpers
// ============================================================================

/**
 * Calculates the expected wait time for a request given current state.
 *
 * @param rpm - Rate limit in requests per minute
 * @param queuePosition - Position in queue (0 = next to be served)
 * @param availablePermits - Number of permits currently available
 * @returns Expected wait time in milliseconds
 */
export function calculateExpectedWaitTime(
  rpm: number,
  queuePosition: number,
  availablePermits: number
): number {
  if (availablePermits > 0) {
    return 0;
  }

  const intervalMs = 60000 / rpm;
  return Math.ceil((queuePosition + 1) * intervalMs);
}

/**
 * Calculates how many permits should be available after time advances.
 *
 * @param rpm - Rate limit in requests per minute
 * @param timeAdvancedMs - Amount of time that passed
 * @param maxPermits - Maximum permit capacity
 * @param currentPermits - Current available permits
 * @returns New permit count
 */
export function calculateRefilledPermits(
  rpm: number,
  timeAdvancedMs: number,
  maxPermits: number,
  currentPermits: number
): number {
  const intervalMs = 60000 / rpm;
  const permitsToAdd = Math.floor(timeAdvancedMs / intervalMs);
  return Math.min(maxPermits, currentPermits + permitsToAdd);
}

// ============================================================================
// Mock Response Helpers
// ============================================================================

/**
 * Creates a mock rate limit response for testing dispatcher integration.
 */
export function createRateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: 'Rate limit exceeded',
        type: 'rate_limit_exceeded',
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
      },
    }
  );
}

/**
 * Creates a successful response for testing normal flows.
 */
export function createSuccessResponse(content: string = 'ok'): Response {
  return new Response(
    JSON.stringify({
      id: 'test-response',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Creates a mock timeout error for testing timeout scenarios.
 */
export function createTimeoutError(message: string = 'Queue timeout exceeded'): Error {
  const error = new Error(message);
  error.name = 'QueueTimeoutError';
  return error;
}
