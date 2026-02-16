/**
 * GET /api/v1/metrics/stats route handler
 * Returns summary statistics for the dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UsageStorageService } from '../../../../services/usage-storage';
import { StatsResponse, TimeRange, VALID_TIME_RANGES } from '../types';
import { getCached, setCache, generateCacheKey } from '../cache';
import { fetchStats } from '../queries';

export function registerStatsRoute(
    fastify: FastifyInstance,
    usageStorage: UsageStorageService
): void {
    fastify.get('/api/v1/metrics/stats', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as Record<string, string>;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange as TimeRange)
            ? query.timeRange as TimeRange
            : 'day';

        const cacheKey = generateCacheKey('stats', { timeRange });
        const cached = getCached<{ timeRange: TimeRange; stats: Record<string, number>; generatedAt: string }>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        try {
            const row = await fetchStats(usageStorage, timeRange);

            const totalRequests = row.requests;
            const successCount = row.successCount;
            const durationCount = row.durationCount;

            const stats = {
                requests: totalRequests,
                tokens: row.inputTokens + row.outputTokens + row.reasoningTokens + row.cachedTokens,
                cost: row.cost,
                avgDuration: durationCount > 0 ? row.durationSum / durationCount : 0,
                successRate: totalRequests > 0 ? successCount / totalRequests : 1
            };

            const response = {
                timeRange,
                stats,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Internal Server Error';
            request.log.error(e, 'Failed to fetch stats');
            return reply.code(500).send({ error });
        }
    });
}
