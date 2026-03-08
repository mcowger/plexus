/**
 * Rate Limiter Test Harness Validation
 *
 * Tests that verify the rate-limit test helpers work correctly.
 * These tests validate the foundational test infrastructure before
 * it's used in actual rate-limiter tests.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  createClockController,
  advanceTime,
  timeUntilNextRefill,
  createLowRpmProvider,
  LowRpmFixtures,
  assertQueueState,
  assertQueueDepth,
  assertQueueEmpty,
  assertQueueHasWaiters,
  createIsolatedTestContext,
  createDeferred,
  calculateExpectedWaitTime,
  calculateRefilledPermits,
  createRateLimitResponse,
  createSuccessResponse,
  createTimeoutError,
} from './test-helpers/rate-limit';

// ============================================================================
// Clock Controller Tests
// ============================================================================

describe('ClockController', () => {
  let clock: ReturnType<typeof createClockController>;

  beforeEach(() => {
    clock = createClockController();
  });

  afterEach(() => {
    clock.reset();
  });

  test('starts at time 0', () => {
    expect(clock.now()).toBe(0);
  });

  test('advances time by specified amount', () => {
    advanceTime(clock, 1000);
    expect(clock.now()).toBe(1000);

    advanceTime(clock, 500);
    expect(clock.now()).toBe(1500);
  });

  test('can set time to specific value', () => {
    clock.setTime(5000);
    expect(clock.now()).toBe(5000);

    clock.setTime(1000);
    expect(clock.now()).toBe(1000);
  });

  test('reset returns to time 0', () => {
    advanceTime(clock, 10000);
    expect(clock.now()).toBe(10000);

    clock.reset();
    expect(clock.now()).toBe(0);
  });

  test('throws on negative advance', () => {
    expect(() => advanceTime(clock, -100)).toThrow('Cannot advance time by negative milliseconds');
  });

  test('throws on negative setTime', () => {
    expect(() => clock.setTime(-100)).toThrow('Cannot set time to negative value');
  });
});

// ============================================================================
// Refill Timing Tests
// ============================================================================

describe('timeUntilNextRefill', () => {
  test('calculates correct interval for 5 RPM', () => {
    // 5 RPM = 1 request per 12 seconds = 12000ms
    expect(timeUntilNextRefill(5)).toBe(12000);
  });

  test('calculates correct interval for 10 RPM', () => {
    // 10 RPM = 1 request per 6 seconds = 6000ms
    expect(timeUntilNextRefill(10)).toBe(6000);
  });

  test('calculates correct interval for 30 RPM', () => {
    // 30 RPM = 1 request per 2 seconds = 2000ms
    expect(timeUntilNextRefill(30)).toBe(2000);
  });

  test('calculates correct interval for 60 RPM', () => {
    // 60 RPM = 1 request per 1 second = 1000ms
    expect(timeUntilNextRefill(60)).toBe(1000);
  });
});

// ============================================================================
// Provider Config Fixture Tests
// ============================================================================

describe('createLowRpmProvider', () => {
  test('creates provider with default values', () => {
    const provider = createLowRpmProvider();

    expect(provider.provider).toBe('test-provider');
    expect(provider.model).toBe('test-model');
    expect(provider.rpm).toBe(10);
    expect(provider.burst).toBe(1);
    expect(provider.maxQueueDepth).toBe(10);
    expect(provider.queueTimeoutMs).toBe(30000);
  });

  test('allows overriding defaults', () => {
    const provider = createLowRpmProvider({
      provider: 'custom-provider',
      model: 'custom-model',
      rpm: 5,
      burst: 3,
      maxQueueDepth: 20,
      queueTimeoutMs: 60000,
    });

    expect(provider.provider).toBe('custom-provider');
    expect(provider.model).toBe('custom-model');
    expect(provider.rpm).toBe(5);
    expect(provider.burst).toBe(3);
    expect(provider.maxQueueDepth).toBe(20);
    expect(provider.queueTimeoutMs).toBe(60000);
  });

  test('allows partial overrides', () => {
    const provider = createLowRpmProvider({ rpm: 15 });

    expect(provider.rpm).toBe(15);
    expect(provider.provider).toBe('test-provider'); // default
    expect(provider.model).toBe('test-model'); // default
  });
});

describe('LowRpmFixtures', () => {
  test('ultraLow creates 5 RPM config', () => {
    const config = LowRpmFixtures.ultraLow();

    expect(config.rpm).toBe(5);
    expect(config.provider).toBe('ultra-low-provider');
    expect(config.maxQueueDepth).toBe(5);
    expect(config.queueTimeoutMs).toBe(60000);
  });

  test('low creates 10 RPM config', () => {
    const config = LowRpmFixtures.low();

    expect(config.rpm).toBe(10);
    expect(config.provider).toBe('low-rpm-provider');
    expect(config.maxQueueDepth).toBe(10);
    expect(config.queueTimeoutMs).toBe(30000);
  });

  test('medium creates 30 RPM config', () => {
    const config = LowRpmFixtures.medium();

    expect(config.rpm).toBe(30);
    expect(config.burst).toBe(2);
    expect(config.maxQueueDepth).toBe(20);
  });

  test('burst creates config with higher burst capacity', () => {
    const config = LowRpmFixtures.burst();

    expect(config.rpm).toBe(10);
    expect(config.burst).toBe(5);
  });

  test('strict creates 1 RPM config with short timeout', () => {
    const config = LowRpmFixtures.strict();

    expect(config.rpm).toBe(1);
    expect(config.queueTimeoutMs).toBe(5000);
    expect(config.maxQueueDepth).toBe(3);
  });
});

// ============================================================================
// Queue State Assertion Tests
// ============================================================================

describe('assertQueueState', () => {
  test('passes when all values match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    // Should not throw
    assertQueueState(state, { depth: 5, waiters: 3, hasTimeouts: false, availablePermits: 2 });
  });

  test('passes when partial values match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    // Should not throw
    assertQueueState(state, { depth: 5 });
    assertQueueState(state, { waiters: 3 });
  });

  test('throws when depth does not match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    expect(() => assertQueueState(state, { depth: 10 })).toThrow('depth: expected 10, got 5');
  });

  test('throws when waiters does not match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    expect(() => assertQueueState(state, { waiters: 10 })).toThrow('waiters: expected 10, got 3');
  });

  test('throws when hasTimeouts does not match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    expect(() => assertQueueState(state, { hasTimeouts: true })).toThrow(
      'hasTimeouts: expected true, got false'
    );
  });

  test('throws when availablePermits does not match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    expect(() => assertQueueState(state, { availablePermits: 10 })).toThrow(
      'availablePermits: expected 10, got 2'
    );
  });

  test('throws with multiple mismatches', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 2,
    };

    expect(() =>
      assertQueueState(state, { depth: 10, waiters: 10, hasTimeouts: true, availablePermits: 10 })
    ).toThrow(/depth: expected 10, got 5/);
  });
});

describe('assertQueueDepth', () => {
  test('passes when depth matches', () => {
    assertQueueDepth(5, 5);
  });

  test('throws when depth does not match', () => {
    expect(() => assertQueueDepth(5, 10)).toThrow();
  });
});

describe('assertQueueEmpty', () => {
  test('passes when queue is empty', () => {
    const state = {
      depth: 0,
      waiters: 0,
      hasTimeouts: false,
      availablePermits: 1,
    };

    assertQueueEmpty(state);
  });

  test('throws when depth > 0', () => {
    const state = {
      depth: 1,
      waiters: 0,
      hasTimeouts: false,
      availablePermits: 0,
    };

    expect(() => assertQueueEmpty(state)).toThrow();
  });

  test('throws when waiters > 0', () => {
    const state = {
      depth: 0,
      waiters: 1,
      hasTimeouts: false,
      availablePermits: 0,
    };

    expect(() => assertQueueEmpty(state)).toThrow();
  });
});

describe('assertQueueHasWaiters', () => {
  test('passes when waiter count matches', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 0,
    };

    assertQueueHasWaiters(state, 3);
  });

  test('throws when waiter count does not match', () => {
    const state = {
      depth: 5,
      waiters: 3,
      hasTimeouts: false,
      availablePermits: 0,
    };

    expect(() => assertQueueHasWaiters(state, 10)).toThrow();
  });
});

// ============================================================================
// Test Isolation Tests
// ============================================================================

describe('createIsolatedTestContext', () => {
  test('creates context with clock starting at 0', () => {
    const ctx = createIsolatedTestContext();

    expect(ctx.clock.now()).toBe(0);
    ctx.cleanup();
  });

  test('cleanup resets clock', () => {
    const ctx = createIsolatedTestContext();
    ctx.clock.advanceTime(1000);
    expect(ctx.clock.now()).toBe(1000);

    ctx.cleanup();
    expect(ctx.clock.now()).toBe(0);
  });

  test('onCleanup registers functions called during cleanup', () => {
    const ctx = createIsolatedTestContext();
    let called = false;
    const cleanupFn = () => {
      called = true;
    };

    ctx.onCleanup(cleanupFn);
    ctx.cleanup();

    expect(called).toBe(true);
  });

  test('cleanup runs in reverse order (LIFO)', () => {
    const ctx = createIsolatedTestContext();
    const order: number[] = [];

    ctx.onCleanup(() => order.push(1));
    ctx.onCleanup(() => order.push(2));
    ctx.onCleanup(() => order.push(3));

    ctx.cleanup();

    expect(order).toEqual([3, 2, 1]);
  });

  test('cleanup continues even if one cleanup throws', () => {
    const ctx = createIsolatedTestContext();
    const order: number[] = [];

    ctx.onCleanup(() => order.push(1));
    ctx.onCleanup(() => {
      throw new Error('Cleanup error');
    });
    ctx.onCleanup(() => order.push(3));

    // Should not throw
    ctx.cleanup();

    // All cleanups should have been attempted
    expect(order).toEqual([3, 1]);
  });
});

// ============================================================================
// Deferred Promise Tests
// ============================================================================

describe('createDeferred', () => {
  test('creates unresolved promise', async () => {
    const deferred = createDeferred<string>();

    let resolved = false;
    deferred.promise.then(() => {
      resolved = true;
    });

    // Wait a tick
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolved).toBe(false);
  });

  test('resolves with value', async () => {
    const deferred = createDeferred<string>();

    setTimeout(() => deferred.resolve('success'), 0);

    const result = await deferred.promise;
    expect(result).toBe('success');
  });

  test('rejects with error', async () => {
    const deferred = createDeferred<string>();
    const error = new Error('test error');

    setTimeout(() => deferred.reject(error), 0);

    await expect(deferred.promise).rejects.toBe(error);
  });
});

// ============================================================================
// Rate Limit Math Tests
// ============================================================================

describe('calculateExpectedWaitTime', () => {
  test('returns 0 when permits available', () => {
    expect(calculateExpectedWaitTime(10, 0, 1)).toBe(0);
    expect(calculateExpectedWaitTime(10, 5, 2)).toBe(0);
  });

  test('calculates wait for position 0 at 10 RPM', () => {
    // 10 RPM = 6000ms interval
    // Position 0, no permits = wait 1 interval
    expect(calculateExpectedWaitTime(10, 0, 0)).toBe(6000);
  });

  test('calculates wait for position 1 at 10 RPM', () => {
    // Position 1 = wait 2 intervals
    expect(calculateExpectedWaitTime(10, 1, 0)).toBe(12000);
  });

  test('calculates wait for position 0 at 5 RPM', () => {
    // 5 RPM = 12000ms interval
    expect(calculateExpectedWaitTime(5, 0, 0)).toBe(12000);
  });
});

describe('calculateRefilledPermits', () => {
  test('adds permits based on time advanced', () => {
    // 10 RPM = 6000ms per permit
    const result = calculateRefilledPermits(10, 12000, 10, 0);
    expect(result).toBe(2);
  });

  test('respects max permits cap', () => {
    const result = calculateRefilledPermits(10, 60000, 5, 0);
    expect(result).toBe(5); // capped at maxPermits
  });

  test('adds to existing permits', () => {
    const result = calculateRefilledPermits(10, 6000, 10, 2);
    expect(result).toBe(3); // 2 + 1
  });

  test('handles partial intervals', () => {
    // 10 RPM = 6000ms per permit
    // 3000ms = 0.5 permits = 0 full permits
    const result = calculateRefilledPermits(10, 3000, 10, 0);
    expect(result).toBe(0);
  });
});

// ============================================================================
// Mock Response Tests
// ============================================================================

describe('createRateLimitResponse', () => {
  test('returns 429 status', () => {
    const response = createRateLimitResponse(60);
    expect(response.status).toBe(429);
  });

  test('includes Retry-After header', () => {
    const response = createRateLimitResponse(60);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  test('includes rate limit error in body', async () => {
    const response = createRateLimitResponse(60);
    const body = await response.json();

    expect(body.error.type).toBe('rate_limit_exceeded');
    expect(body.error.message).toBe('Rate limit exceeded');
  });
});

describe('createSuccessResponse', () => {
  test('returns 200 status', () => {
    const response = createSuccessResponse();
    expect(response.status).toBe(200);
  });

  test('includes JSON content type', () => {
    const response = createSuccessResponse();
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  test('includes completion in body', async () => {
    const response = createSuccessResponse('Hello');
    const body = await response.json();

    expect(body.choices[0].message.content).toBe('Hello');
    expect(body.object).toBe('chat.completion');
  });

  test('uses default content when not specified', async () => {
    const response = createSuccessResponse();
    const body = await response.json();

    expect(body.choices[0].message.content).toBe('ok');
  });
});

describe('createTimeoutError', () => {
  test('creates error with custom message', () => {
    const error = createTimeoutError('Custom timeout');
    expect(error.message).toBe('Custom timeout');
    expect(error.name).toBe('QueueTimeoutError');
  });

  test('creates error with default message', () => {
    const error = createTimeoutError();
    expect(error.message).toBe('Queue timeout exceeded');
    expect(error.name).toBe('QueueTimeoutError');
  });
});

// ============================================================================
// Integration Test Pattern Example
// ============================================================================

describe('Test Isolation Pattern (Integration Example)', () => {
  // This test demonstrates the recommended pattern for using the test helpers
  // in actual rate-limiter tests

  let testCtx: ReturnType<typeof createIsolatedTestContext>;

  beforeEach(() => {
    testCtx = createIsolatedTestContext();
  });

  afterEach(() => {
    testCtx.cleanup();
  });

  test('demonstrates fake time advancement', () => {
    const clock = testCtx.clock;

    // Simulate request arriving at time 0
    const requestArrivalTime = clock.now();
    expect(requestArrivalTime).toBe(0);

    // Simulate waiting for rate limit
    advanceTime(clock, 6000); // 6 seconds for 10 RPM

    // Now time should be advanced
    expect(clock.now()).toBe(6000);
  });

  test('demonstrates provider fixture usage', () => {
    const provider = LowRpmFixtures.low();

    expect(provider.rpm).toBe(10);
    expect(provider.burst).toBe(1);

    // Calculate when next permit is available
    const nextRefill = timeUntilNextRefill(provider.rpm);
    expect(nextRefill).toBe(6000);
  });

  test('demonstrates queue state assertions', () => {
    const queueState = {
      depth: 3,
      waiters: 2,
      hasTimeouts: false,
      availablePermits: 0,
    };

    // Assert specific properties
    assertQueueState(queueState, { depth: 3, waiters: 2 });

    // Assert with utility functions
    assertQueueDepth(queueState.depth, 3);
    assertQueueHasWaiters(queueState, 2);
  });

  test('demonstrates wait time calculations', () => {
    const provider = createLowRpmProvider({ rpm: 10 });

    // If we're at position 0 and no permits available
    const waitTime = calculateExpectedWaitTime(provider.rpm, 0, 0);
    expect(waitTime).toBe(6000); // 6 seconds for 10 RPM

    // Advance time
    advanceTime(testCtx.clock, waitTime);

    // Now we should have permits
    const newPermits = calculateRefilledPermits(
      provider.rpm,
      testCtx.clock.now(),
      provider.burst ?? 1,
      0
    );
    expect(newPermits).toBe(1);
  });
});
