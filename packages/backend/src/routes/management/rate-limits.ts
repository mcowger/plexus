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
  alias?: string;
  scope: 'provider' | 'model' | 'alias';
  isExplicit: boolean;
  targetCount?: number;
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
    'scope',
    'isExplicit',
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
    alias: { type: 'string' },
    scope: { type: 'string', enum: ['provider', 'model', 'alias'] },
    isExplicit: { type: 'boolean' },
    targetCount: { type: 'number' },
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
  const providerScopeTargets = status.targets.filter((target) => target.scope === 'provider');
  const explicitTargets = status.targets.filter((target) => target.isExplicit);
  const providerGroups = new Map<string, (typeof providerScopeTargets)[number][]>();

  for (const target of providerScopeTargets) {
    const existing = providerGroups.get(target.provider) || [];
    existing.push(target);
    providerGroups.set(target.provider, existing);
  }

  const aggregatedProviderTargets: RateLimitStatus[] = Array.from(providerGroups.entries()).map(
    ([provider, targets]) => {
      const firstTarget = targets[0];
      const oldestWaitMs = targets.reduce<number | null>((oldest, target) => {
        if (target.oldestWaitMs === null) {
          return oldest;
        }

        return oldest === null ? target.oldestWaitMs : Math.max(oldest, target.oldestWaitMs);
      }, null);
      const currentBudget = targets.reduce(
        (lowest, target) => Math.min(lowest, target.currentBudget),
        firstTarget?.currentBudget ?? 0
      );

      return {
        provider,
        model: '*',
        scope: 'provider',
        isExplicit: true,
        targetCount: targets.length,
        queueDepth: targets.reduce((sum, target) => sum + target.currentQueueDepth, 0),
        currentBudget,
        requestsPerMinute: firstTarget?.requestsPerMinute ?? 0,
        oldestWaitMs,
        waitersCount: targets.reduce((sum, target) => sum + target.queueWaiters, 0),
        timeoutCount: targets.reduce((sum, target) => sum + target.timeoutCount, 0),
        dropCount: targets.reduce((sum, target) => sum + target.dropCount, 0),
      };
    }
  );
  const visibleTargets = [
    ...aggregatedProviderTargets,
    ...explicitTargets.map((target) => ({
      provider: target.provider,
      model: target.model,
      ...(target.alias ? { alias: target.alias } : {}),
      scope: target.scope,
      isExplicit: target.isExplicit,
      queueDepth: target.currentQueueDepth,
      currentBudget: target.currentBudget,
      requestsPerMinute: target.requestsPerMinute,
      oldestWaitMs: target.oldestWaitMs,
      waitersCount: target.queueWaiters,
      timeoutCount: target.timeoutCount,
      dropCount: target.dropCount,
    })),
  ];

  if (visibleTargets.length === 0) {
    return buildEmptyRateLimitsResponse();
  }

  const rateLimits: RateLimitStatus[] = visibleTargets;

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
