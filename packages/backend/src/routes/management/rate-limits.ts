import { FastifyInstance } from 'fastify';
import { RequestShaper } from '../../services/request-shaper';
import { logger } from '../../utils/logger';

/**
 * Rate limit status read model for shaper observability.
 * Provides read-only access to rate-limit state, queue depth, waiters, and timeout counters.
 */

interface RateLimitStatus {
  provider: string;
  model: string;
  queueDepth: number;
  currentBudget: number;
  requestsPerMinute: number;
  oldestWaitMs: number | null;
  waitersCount: number;
  timeoutCount: number;
  dropCount: number;
}

interface RateLimitSummary {
  activeLimiters: number;
  totalQueueDepth: number;
  totalWaitersCount: number;
  oldestWaitMs: number | null;
  totalTimeoutCount: number;
  totalDropCount: number;
}

interface RateLimitsResponse {
  rateLimits: RateLimitStatus[];
  summary: RateLimitSummary;
  timestamp: string;
}

export const rateLimitStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'model',
    'queueDepth',
    'currentBudget',
    'requestsPerMinute',
    'oldestWaitMs',
    'waitersCount',
    'timeoutCount',
    'dropCount',
  ],
  properties: {
    provider: { type: 'string' },
    model: { type: 'string' },
    queueDepth: { type: 'number' },
    currentBudget: { type: 'number' },
    requestsPerMinute: { type: 'number' },
    oldestWaitMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    waitersCount: { type: 'number' },
    timeoutCount: { type: 'number' },
    dropCount: { type: 'number' },
  },
} as const;

export const rateLimitsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rateLimits', 'summary', 'timestamp'],
  properties: {
    rateLimits: {
      type: 'array',
      items: rateLimitStatusSchema,
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'activeLimiters',
        'totalQueueDepth',
        'totalWaitersCount',
        'oldestWaitMs',
        'totalTimeoutCount',
        'totalDropCount',
      ],
      properties: {
        activeLimiters: { type: 'number' },
        totalQueueDepth: { type: 'number' },
        totalWaitersCount: { type: 'number' },
        oldestWaitMs: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        totalTimeoutCount: { type: 'number' },
        totalDropCount: { type: 'number' },
      },
    },
    timestamp: { type: 'string' },
  },
} as const;

const rateLimitsErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: { type: 'string' },
  },
} as const;

function buildEmptyRateLimitsResponse(): RateLimitsResponse {
  return {
    rateLimits: [],
    summary: {
      activeLimiters: 0,
      totalQueueDepth: 0,
      totalWaitersCount: 0,
      oldestWaitMs: null,
      totalTimeoutCount: 0,
      totalDropCount: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildRateLimitsResponse(): RateLimitsResponse {
  const shaper = RequestShaper.getInstance();
  const status = shaper.getAllStatus();

  if (status.targets.length === 0) {
    return buildEmptyRateLimitsResponse();
  }

  const rateLimits: RateLimitStatus[] = status.targets.map((target) => ({
    provider: target.provider,
    model: target.model,
    queueDepth: target.currentQueueDepth,
    currentBudget: target.currentBudget,
    requestsPerMinute: target.requestsPerMinute,
    oldestWaitMs: target.oldestWaitMs,
    waitersCount: target.queueWaiters,
    timeoutCount: target.timeoutCount,
    dropCount: target.dropCount,
  }));

  const oldestWaitMs = rateLimits.reduce<number | null>((oldest, target) => {
    if (target.oldestWaitMs === null) {
      return oldest;
    }

    return oldest === null ? target.oldestWaitMs : Math.max(oldest, target.oldestWaitMs);
  }, null);

  return {
    rateLimits,
    summary: {
      activeLimiters: rateLimits.length,
      totalQueueDepth: rateLimits.reduce((sum, target) => sum + target.queueDepth, 0),
      totalWaitersCount: rateLimits.reduce((sum, target) => sum + target.waitersCount, 0),
      oldestWaitMs,
      totalTimeoutCount: rateLimits.reduce((sum, target) => sum + target.timeoutCount, 0),
      totalDropCount: rateLimits.reduce((sum, target) => sum + target.dropCount, 0),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Register rate-limits management routes.
 *
 * @param fastify - Fastify instance
 */
export async function registerRateLimitRoutes(fastify: FastifyInstance) {
  /**
   * GET /v0/management/rate-limits
   *
   * Returns current rate-limit state for all configured provider/model combinations.
   * Returns empty/zero values when no shaper state exists.
   */
  fastify.get(
    '/v0/management/rate-limits',
    {
      schema: {
        response: {
          200: rateLimitsResponseSchema,
          500: rateLimitsErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      void _request;

      try {
        const response = buildRateLimitsResponse();

        logger.debug('[RateLimits API] Retrieved rate-limit status');
        return reply.send(response);
      } catch (error) {
        logger.error(`[RateLimits API] Failed to get rate-limits: ${error}`);
        reply.statusCode = 500;
        return reply.send({ error: 'Failed to retrieve rate-limit status' });
      }
    }
  );
}
