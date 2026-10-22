import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';

// Using any for spy types since the concrete Mock type varies per target
/* eslint-disable @typescript-eslint/no-explicit-any */
type SpyInstance = any;

/**
 * Global Spy Registry
 *
 * Tracks all spies created via registerSpy during a test and restores them
 * in the global afterEach hook, so spies never leak across tests.
 *
 * Usage in tests:
 *   import { registerSpy } from '../test/test-utils';
 *
 *   // Instead of:
 *   const spy = spyOn(obj, 'method');
 *
 *   // Use:
 *   const spy = registerSpy(obj, 'method');
 *
 *   // The spy will be automatically restored after each test.
 */

interface TrackedSpy {
  spy: SpyInstance;
  target: any;
  methodName: string;
}

// Module-level registry (persists across tests in the same process)
const trackedSpies: TrackedSpy[] = [];

/**
 * Register a spy that will be automatically restored after each test.
 * Use this instead of spyOn() for any spy that should not leak.
 */
export function registerSpy(target: any, methodName: string): SpyInstance {
  const spy = spyOn(target, methodName as never);
  trackedSpies.push({ spy, target, methodName });
  return spy;
}

/**
 * Unregister a specific spy (stop tracking it for auto-restore).
 * Call this if you want to manage the spy's lifecycle manually.
 */
export function unregisterSpy(spy: SpyInstance): void {
  const index = trackedSpies.findIndex((t) => t.spy === spy);
  if (index !== -1) {
    trackedSpies.splice(index, 1);
  }
}

/**
 * Restore all tracked spies. Called automatically after each test.
 */
export function restoreAllSpies(): void {
  for (const tracked of trackedSpies) {
    try {
      tracked.spy.mockRestore();
    } catch {
      // Ignore restore errors
    }
  }
  trackedSpies.length = 0;
}

/**
 * Get the count of currently tracked spies (useful for debugging).
 */
export function getTrackedSpyCount(): number {
  return trackedSpies.length;
}

// Global afterEach - runs after EVERY test to restore any lingering spies
// This is a safety net in case tests forget to clean up
afterEach(() => {
  restoreAllSpies();
});

/**
 * Helper to create a mock function with a pre-defined implementation.
 */
export function createTrackedMock<T extends (...args: any[]) => any>(implementation: T) {
  return mock(implementation);
}

/**
 * Adapt a plain async function for `spyOn(globalThis, 'fetch').mockImplementation(...)`.
 * Bun types `fetch` as `typeof fetch`, which also carries `preconnect`; a bare
 * function is not assignable to it even though tests never call `preconnect`.
 */
export function asFetch(impl: (input: any, init?: RequestInit) => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

/**
 * Advance fake timers the way `vi.advanceTimersByTimeAsync` did: in small
 * steps, flushing microtasks between steps so code that awaits timers in a
 * loop (polling, retries, grace periods) can schedule its next timer.
 *
 * A single synchronous `jest.advanceTimersByTime(ms)` only fires timers
 * scheduled at call time — continuations queued as microtasks never run
 * until it returns, so poll loops deadlock. Never substitute the sync
 * version where the code under test awaits a timer and then arms another.
 *
 * Two details matter:
 * - Yield to microtasks BEFORE moving the clock, so the code under test
 *   arms its timers at the current fake time. Advancing first shifts every
 *   timer late and the horizon no longer covers them.
 * - Stop based on elapsed fake time (`Date.now()`, which fake timers move),
 *   not on step counts, so late-armed timers still fall inside the window.
 *
 * Throws (failing the test fast) if the horizon is never reached, rather
 * than looping forever on a timer that keeps re-arming itself.
 */
export async function advanceTimersByTimeAsync(ms: number, step = 25): Promise<void> {
  // Let the code under test run to its first await before moving the clock.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const start = Date.now();
  let guard = Math.ceil(ms / step) + 100;
  for (;;) {
    const elapsed = Date.now() - start;
    if (elapsed >= ms) break;
    if (guard-- <= 0) {
      throw new Error(
        `advanceTimersByTimeAsync(${ms}): fake clock did not reach the horizon (possible infinite timer loop)`
      );
    }
    jest.advanceTimersByTime(Math.min(step, ms - elapsed));
    // Let timer continuations run so the next iteration can arm timers.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  // Final flush for continuations scheduled by the last timers.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Poll an assertion until it passes or the timeout elapses.
 * Bun's expect has no polling mode, so this is the explicit equivalent:
 * the last assertion error is rethrown when the deadline passes.
 *
 * Never use under fake timers — the real-`setTimeout` polling loop never
 * fires while time is faked. Advance the clock explicitly instead.
 */
export async function waitFor(
  assertion: () => void | Promise<void>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 1000;
  const interval = options.interval ?? 20;
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

// Re-export common test utilities for convenience
export { describe, test, expect, beforeEach, afterEach };
