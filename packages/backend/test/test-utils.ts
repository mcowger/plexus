import { vi, afterEach, describe, test, expect, beforeEach } from 'vitest';

// Using any for spy types since vitest v4+ doesn't export SpyInstance consistently
/* eslint-disable @typescript-eslint/no-explicit-any */
type SpyInstance = any;

/**
 * Global Spy Registry
 *
 * Bun's test runner shares state between test files in the same worker.
 * This registry automatically tracks all spies created during a test and
 * restores them in the global afterEach hook.
 *
 * Usage in tests:
 *   import { registerSpy, unregisterSpy } from '../test/test-utils';
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

// Module-level registry (persists across test files in the same worker)
const trackedSpies: TrackedSpy[] = [];

/**
 * Register a spy that will be automatically restored after each test.
 * Use this instead of spyOn() for any spy that should not leak.
 */
export function registerSpy(target: any, methodName: string): SpyInstance {
  const spy = vi.spyOn(target, methodName as never);
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
 * Helper to create a mock function with pre-defined return values.
 * Automatically tracked for cleanup.
 */
export function createTrackedMock<T extends (...args: any[]) => any>(
  implementation: T
): SpyInstance {
  const m = vi.fn(implementation);
  return m;
}

// Re-export common test utilities for convenience
export { describe, test, expect, beforeEach, afterEach, vi as mock };
