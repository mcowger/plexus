import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import Fastify from 'fastify';
import { RequestShaper } from '../../../services/request-shaper';
import {
  rateLimitsResponseSchema,
  rateLimitStatusSchema,
  registerRateLimitRoutes,
} from '../rate-limits';

describe('Rate limits management routes', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    RequestShaper.resetInstance();
    fastify = Fastify();
    await registerRateLimitRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
    RequestShaper.resetInstance();
  });

  it('returns a stable baseline payload', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');

    const json = response.json() as {
      rateLimits: unknown[];
      summary: {
        activeLimiters: number;
        totalQueueDepth: number;
        totalWaitersCount: number;
        oldestWaitMs: number | null;
        totalTimeoutCount: number;
        totalDropCount: number;
      };
      timestamp: string;
    };

    expect(json).toEqual({
      rateLimits: [],
      summary: {
        activeLimiters: 0,
        totalQueueDepth: 0,
        totalWaitersCount: 0,
        oldestWaitMs: null,
        totalTimeoutCount: 0,
        totalDropCount: 0,
      },
      timestamp: json.timestamp,
    });
    expect(Number.isNaN(Date.parse(json.timestamp))).toBe(false);
  });

  it('exports a stable response schema for future shaper integration', () => {
    expect(rateLimitsResponseSchema.required).toEqual(['rateLimits', 'summary', 'timestamp']);
    expect(rateLimitStatusSchema.required).toEqual([
      'provider',
      'model',
      'scope',
      'isExplicit',
      'queueDepth',
      'currentBudget',
      'requestsPerMinute',
      'oldestWaitMs',
      'waitersCount',
      'timeoutCount',
      'dropCount',
    ]);
    expect(rateLimitsResponseSchema.properties.summary.required).toEqual([
      'activeLimiters',
      'totalQueueDepth',
      'totalWaitersCount',
      'oldestWaitMs',
      'totalTimeoutCount',
      'totalDropCount',
    ]);
  });

  it('returns live request shaper state for explicit model overrides', async () => {
    const shaper = RequestShaper.getInstance();
    await shaper.initialize(
      createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            models: {
              inherited: {},
              'test-model': {
                rate_limit: { requests_per_minute: 1, queue_depth: 5 },
              },
            },
          },
        },
      })
    );

    await shaper.acquirePermit('test-provider', 'test-model');
    const queuedRequest = shaper.acquirePermit('test-provider', 'test-model');

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as {
      rateLimits: Array<{
        provider: string;
        model: string;
        scope: 'provider' | 'model' | 'alias';
        isExplicit: boolean;
        queueDepth: number;
        currentBudget: number;
        requestsPerMinute: number;
        oldestWaitMs: number | null;
        waitersCount: number;
        timeoutCount: number;
        dropCount: number;
      }>;
      summary: {
        activeLimiters: number;
        totalQueueDepth: number;
        totalWaitersCount: number;
        oldestWaitMs: number | null;
        totalTimeoutCount: number;
        totalDropCount: number;
      };
    };

    const firstRateLimit = json.rateLimits[0];

    expect(json.rateLimits).toHaveLength(1);
    expect(firstRateLimit).toBeDefined();
    expect(firstRateLimit).toMatchObject({
      provider: 'test-provider',
      model: 'test-model',
      scope: 'model',
      isExplicit: true,
      queueDepth: 1,
      currentBudget: 0,
      requestsPerMinute: 1,
      waitersCount: 1,
      timeoutCount: 0,
      dropCount: 0,
    });
    expect(firstRateLimit?.oldestWaitMs).not.toBeNull();
    expect(json.summary).toEqual({
      activeLimiters: 1,
      totalQueueDepth: 1,
      totalWaitersCount: 1,
      oldestWaitMs: json.summary.oldestWaitMs,
      totalTimeoutCount: 0,
      totalDropCount: 0,
    });

    shaper.releasePermit('test-provider', 'test-model');
    await queuedRequest;
  });

  it('exports provider-default shapers as a single provider card', async () => {
    const shaper = RequestShaper.getInstance();
    await shaper.initialize(
      createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 1, queue_depth: 5 },
            models: ['test-model'],
          },
        },
      })
    );

    await shaper.acquirePermit('test-provider', 'test-model');
    const queuedRequest = shaper.acquirePermit('test-provider', 'test-model');

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as {
      rateLimits: Array<{
        provider: string;
        model: string;
        scope: 'provider' | 'model' | 'alias';
        isExplicit: boolean;
        targetCount?: number;
        queueDepth: number;
        currentBudget: number;
        requestsPerMinute: number;
        waitersCount: number;
      }>;
      summary: {
        activeLimiters: number;
        totalQueueDepth: number;
        totalWaitersCount: number;
        oldestWaitMs: number | null;
        totalTimeoutCount: number;
        totalDropCount: number;
      };
    };

    expect(json.rateLimits).toHaveLength(1);
    expect(json.rateLimits[0]).toMatchObject({
      provider: 'test-provider',
      model: '*',
      scope: 'provider',
      isExplicit: true,
      targetCount: 1,
      queueDepth: 1,
      currentBudget: 0,
      requestsPerMinute: 1,
      waitersCount: 1,
    });
    expect(json.summary).toMatchObject({
      activeLimiters: 1,
      totalQueueDepth: 1,
      totalWaitersCount: 1,
      totalTimeoutCount: 0,
      totalDropCount: 0,
    });

    shaper.releasePermit('test-provider', 'test-model');
    await queuedRequest;
  });

  it('does not sum currentBudget across provider-default models', async () => {
    const shaper = RequestShaper.getInstance();
    await shaper.initialize(
      createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            rate_limit: { requests_per_minute: 2, queue_depth: 5 },
            models: ['model-a', 'model-b'],
          },
        },
      })
    );

    await shaper.acquirePermit('test-provider', 'model-a');

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as {
      rateLimits: Array<{
        provider: string;
        model: string;
        scope: 'provider' | 'model' | 'alias';
        currentBudget: number;
        requestsPerMinute: number;
        targetCount?: number;
      }>;
    };

    expect(json.rateLimits).toHaveLength(1);
    expect(json.rateLimits[0]).toMatchObject({
      provider: 'test-provider',
      model: '*',
      scope: 'provider',
      targetCount: 2,
      requestsPerMinute: 2,
      currentBudget: 1,
    });
  });

  it('reports timeout and drop counters', async () => {
    const shaper = RequestShaper.getInstance();
    await shaper.initialize(
      createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            models: {
              'test-model': {
                rate_limit: {
                  requests_per_minute: 1,
                  queue_depth: 1,
                  queue_timeout_ms: 50,
                },
              },
            },
          },
        },
      })
    );

    await shaper.acquirePermit('test-provider', 'test-model');
    const queuedRequest = shaper.acquirePermit('test-provider', 'test-model');
    let queueFullError: unknown;

    try {
      await shaper.acquirePermit('test-provider', 'test-model');
    } catch (error) {
      queueFullError = error;
    }

    expect(queueFullError).toBeInstanceOf(Error);

    await new Promise((resolve) => setTimeout(resolve, 80));
    shaper.cleanupExpiredRequests();
    await queuedRequest;

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as {
      rateLimits: Array<{
        queueDepth: number;
        waitersCount: number;
        timeoutCount: number;
        dropCount: number;
      }>;
      summary: {
        totalQueueDepth: number;
        totalWaitersCount: number;
        totalTimeoutCount: number;
        totalDropCount: number;
      };
    };

    expect(json.rateLimits[0]).toMatchObject({
      queueDepth: 0,
      waitersCount: 0,
      timeoutCount: 1,
      dropCount: 1,
    });
    expect(json.summary).toMatchObject({
      totalQueueDepth: 0,
      totalWaitersCount: 0,
      totalTimeoutCount: 1,
      totalDropCount: 1,
    });
  });

  it('includes alias information for alias-specific shapers', async () => {
    const shaper = RequestShaper.getInstance();
    await shaper.initialize(
      createTestConfig({
        providers: {
          'test-provider': {
            api_base_url: 'https://example.com/v1',
            api_key: 'test-key',
            models: ['test-model'],
          },
        },
        models: {
          coder: {
            rate_limit: { requests_per_minute: 1, queue_depth: 2 },
            targets: [{ provider: 'test-provider', model: 'test-model' }],
          },
        },
      })
    );

    await shaper.acquirePermit('test-provider', 'test-model', 'coder');

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/rate-limits',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as {
      rateLimits: Array<{
        alias?: string;
        provider: string;
        model: string;
        scope: 'provider' | 'model' | 'alias';
        isExplicit: boolean;
      }>;
    };

    expect(json.rateLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'coder',
          provider: 'test-provider',
          model: 'test-model',
          scope: 'alias',
          isExplicit: true,
        }),
      ])
    );
  });

  it('rejects unsupported mutation methods', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await fastify.inject({
        method,
        url: '/v0/management/rate-limits',
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  function createTestConfig(overrides: {
    shaper?: Partial<{
      queueTimeoutMs: number;
      cleanupIntervalMs: number;
      defaultRpm: number;
    }>;
    providers?: Record<string, unknown>;
    models?: Record<string, unknown>;
  }): any {
    return {
      providers: overrides.providers ?? {},
      models: overrides.models ?? {},
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
