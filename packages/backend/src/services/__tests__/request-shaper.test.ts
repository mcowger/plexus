/**
 * Request Shaper Service Tests
 *
 * Tests for T6 (lifecycle), T7 (budget accounting), and T8 (queue).
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { RequestShaper, QueueFullError } from '../request-shaper';

describe('RequestShaper', () => {
  beforeEach(() => {
    // Reset singleton state before each test
    RequestShaper.resetInstance();
  });

  afterEach(() => {
    // Clean up after each test
    RequestShaper.resetInstance();
  });

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe('initialization', () => {
    test('initializes with providers that have rate_limit config', async () => {
      const config = createTestConfig({
        providers: {
          'shaped-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: {
              requests_per_minute: 10,
              queue_depth: 5,
              queue_timeout_ms: 30000,
            },
            models: ['model-a', 'model-b'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Should have 2 targets (provider x models)
      expect(shaper.getShapedCount()).toBe(2);
      expect(shaper.isShaped('shaped-provider', 'model-a')).toBe(true);
      expect(shaper.isShaped('shaped-provider', 'model-b')).toBe(true);
    });

    test('initializes with no targets when no providers have rate_limit', async () => {
      const config = createTestConfig({
        providers: {
          'normal-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            // No rate_limit config
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      expect(shaper.getShapedCount()).toBe(0);
      expect(shaper.isShaped('normal-provider', 'default')).toBe(false);
    });

    test('applies provider defaults and model overrides on the same provider', async () => {
      const config = createTestConfig({
        providers: {
          'mixed-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: {
              requests_per_minute: 10,
              queue_depth: 5,
              queue_timeout_ms: 30000,
            },
            models: {
              'model-a': {},
              'model-b': {
                rate_limit: {
                  requests_per_minute: 2,
                  queue_depth: 1,
                  queue_timeout_ms: 1500,
                },
              },
            },
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      expect(shaper.getShapedCount()).toBe(2);
      expect(shaper.getStatus('mixed-provider', 'model-a')).toMatchObject({
        requestsPerMinute: 10,
        queueDepth: 5,
        queueTimeoutMs: 30000,
      });
      expect(shaper.getStatus('mixed-provider', 'model-b')).toMatchObject({
        requestsPerMinute: 2,
        queueDepth: 1,
        queueTimeoutMs: 1500,
      });
    });
  });

  // ============================================================================
  // Budget Accounting Tests (T7)
  // ============================================================================

  describe('budget accounting', () => {
    test('consumeBudget decrements budget on success', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      expect(shaper.getRemainingBudget('test-provider', 'test-model')).toBe(5);
      expect(shaper.consumeBudget('test-provider', 'test-model')).toBe(true);
      expect(shaper.getRemainingBudget('test-provider', 'test-model')).toBe(4);
    });

    test('consumeBudget returns false when budget exhausted', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 2 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume all 2 permits
      expect(shaper.consumeBudget('test-provider', 'test-model')).toBe(true);
      expect(shaper.consumeBudget('test-provider', 'test-model')).toBe(true);
      expect(shaper.getRemainingBudget('test-provider', 'test-model')).toBe(0);

      // Third consume should fail
      expect(shaper.consumeBudget('test-provider', 'test-model')).toBe(false);
    });
  });

  // ============================================================================
  // Queue Tests (T8)
  // ============================================================================

  describe('queue', () => {
    test('acquirePermit returns immediate when budget available', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      const result = await shaper.acquirePermit('test-provider', 'test-model');
      expect(result.type).toBe('immediate');
      expect(shaper.getRemainingBudget('test-provider', 'test-model')).toBe(4);
    });

    test('acquirePermit returns immediate for unshaped providers', async () => {
      const config = createTestConfig({
        providers: {
          'unshaped-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            // No rate_limit
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      const result = await shaper.acquirePermit('unshaped-provider', 'any-model');
      expect(result.type).toBe('immediate');
    });

    test('acquirePermit queues request when budget exhausted', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');
      expect(shaper.getRemainingBudget('test-provider', 'test-model')).toBe(0);

      // Second request should be queued
      const promise = shaper.acquirePermit('test-provider', 'test-model');
      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(1);

      // Release to admit the queued request
      shaper.releasePermit('test-provider', 'test-model');

      const result = await promise;
      expect(result.type).toBe('queued');
      expect((result as { type: 'queued'; waitTimeMs: number }).waitTimeMs).toBeGreaterThanOrEqual(
        0
      );
    });

    test('acquirePermit throws QueueFullError when queue full', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 1 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      // Queue one request
      shaper.acquirePermit('test-provider', 'test-model');

      // Third request should throw QueueFullError
      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(1);
      await expect(shaper.acquirePermit('test-provider', 'test-model')).rejects.toThrow(
        QueueFullError
      );
    });

    test('releasePermit admits queued requests in FIFO order', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      // Queue two requests
      const promise1 = shaper.acquirePermit('test-provider', 'test-model');
      const promise2 = shaper.acquirePermit('test-provider', 'test-model');

      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(2);

      // Release permits to admit queued requests
      shaper.releasePermit('test-provider', 'test-model');
      await promise1;

      shaper.releasePermit('test-provider', 'test-model');
      await promise2;

      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(0);
    });

    test('cleanupExpiredRequests removes timed-out entries', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: {
              requests_per_minute: 1,
              queue_depth: 5,
              queue_timeout_ms: 100, // Short timeout for testing
            },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      // Queue a request
      const promise = shaper.acquirePermit('test-provider', 'test-model');
      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(1);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Run cleanup
      shaper.cleanupExpiredRequests();

      // Should have timed out
      const result = await promise;
      expect(result.type).toBe('timeout');
      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(0);
    });

    test('getQueueDepth returns correct queue size', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(0);

      // Queue requests (don't await, just queue)
      shaper.acquirePermit('test-provider', 'test-model');
      shaper.acquirePermit('test-provider', 'test-model');
      shaper.acquirePermit('test-provider', 'test-model');

      expect(shaper.getQueueDepth('test-provider', 'test-model')).toBe(3);
    });

    test('getQueueWaiters returns same as getQueueDepth', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      // Queue requests
      shaper.acquirePermit('test-provider', 'test-model');
      shaper.acquirePermit('test-provider', 'test-model');

      expect(shaper.getQueueWaiters('test-provider', 'test-model')).toBe(
        shaper.getQueueDepth('test-provider', 'test-model')
      );
    });

    test('status API includes queue wait age and counters', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit and queue a request
      await shaper.acquirePermit('test-provider', 'test-model');
      shaper.acquirePermit('test-provider', 'test-model');

      const status = shaper.getStatus('test-provider', 'test-model');
      expect(status).not.toBeNull();
      expect(status!.queueWaiters).toBe(1);
      expect(status!.oldestWaitMs).not.toBeNull();
      expect(status!.timeoutCount).toBe(0);
      expect(status!.dropCount).toBe(0);
    });

    test('queue timeout and full queue update counters', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: {
              requests_per_minute: 1,
              queue_depth: 1,
              queue_timeout_ms: 50,
            },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      await shaper.acquirePermit('test-provider', 'test-model');
      const queuedRequest = shaper.acquirePermit('test-provider', 'test-model');
      await expect(shaper.acquirePermit('test-provider', 'test-model')).rejects.toThrow(
        QueueFullError
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      shaper.cleanupExpiredRequests();
      await queuedRequest;

      const status = shaper.getStatus('test-provider', 'test-model');
      expect(status).not.toBeNull();
      expect(status!.timeoutCount).toBe(1);
      expect(status!.dropCount).toBe(1);
      expect(status!.oldestWaitMs).toBeNull();
    });

    test('simultaneous queue operations on different targets', async () => {
      const config = createTestConfig({
        providers: {
          'provider-a': {
            api_base_url: 'https://a.com/v1',
            api_key: 'key-a',
            rate_limit: { requests_per_minute: 1, queue_depth: 3 },
            models: ['model-a'],
          },
          'provider-b': {
            api_base_url: 'https://b.com/v1',
            api_key: 'key-b',
            rate_limit: { requests_per_minute: 1, queue_depth: 3 },
            models: ['model-b'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume permits from both
      await shaper.acquirePermit('provider-a', 'model-a');
      await shaper.acquirePermit('provider-b', 'model-b');

      // Queue requests on both
      shaper.acquirePermit('provider-a', 'model-a');
      shaper.acquirePermit('provider-a', 'model-a');
      shaper.acquirePermit('provider-b', 'model-b');

      expect(shaper.getQueueDepth('provider-a', 'model-a')).toBe(2);
      expect(shaper.getQueueDepth('provider-b', 'model-b')).toBe(1);

      // Release permits
      shaper.releasePermit('provider-a', 'model-a');
      shaper.releasePermit('provider-b', 'model-b');

      expect(shaper.getQueueDepth('provider-a', 'model-a')).toBe(1);
      expect(shaper.getQueueDepth('provider-b', 'model-b')).toBe(0);
    });

    test('stop clears pending queue entries', async () => {
      const config = createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Consume the only permit
      await shaper.acquirePermit('test-provider', 'test-model');

      // Queue a request
      const promise = shaper.acquirePermit('test-provider', 'test-model');

      // Stop should clear queue (resolving pending requests with timeout)
      shaper.stop();

      // Request should resolve with timeout result
      const result = await promise;
      expect(result.type).toBe('timeout');
    });

    test('releasePermit does nothing for unshaped providers', async () => {
      const config = createTestConfig({
        providers: {
          'unshaped-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      // Should not throw
      shaper.releasePermit('unshaped-provider', 'any-model');
    });

    test('getQueueDepth returns 0 for unshaped providers', async () => {
      const config = createTestConfig({
        providers: {
          'unshaped-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
          },
        },
      });

      const shaper = RequestShaper.getInstance();
      await shaper.initialize(config);

      expect(shaper.getQueueDepth('unshaped-provider', 'any-model')).toBe(0);
    });
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  function createTestConfig(overrides: {
    shaper?: Partial<{
      queueTimeoutMs: number;
      cleanupIntervalMs: number;
      defaultRpm: number;
    }>;
    providers?: Record<string, any>;
  }): any {
    return {
      providers: overrides.providers ?? {},
      models: {},
      keys: {},
      adminKey: 'test-admin-key',
      failover: {
        enabled: false,
        retryableStatusCodes: [],
        retryableErrors: [],
      },
      quotas: [],
      shaper: {
        queueTimeoutMs: 30000,
        cleanupIntervalMs: 60000,
        defaultRpm: 60,
        ...overrides.shaper,
      },
    };
  }
});
