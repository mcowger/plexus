/**
 * GET /api/v1/metrics/aggregated route handler
 * Returns aggregated data by provider, model, apiKey, or status
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UsageStorageService } from '../../../../services/usage-storage';
import { AggregatedResponse, GroupBy, TimeRange, VALID_GROUP_BY, VALID_TIME_RANGES } from '../types';
import { getCached, setCache, generateCacheKey } from '../cache';
import { fetchAggregatedData } from '../queries';
import { aggregateGroupedData } from '../aggregation';

export function registerAggregatedRoute(
    fastify: FastifyInstance,
    usageStorage: UsageStorageService
): void {
    fastify.get('/api/v1/metrics/aggregated', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as Record<string, string>;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange as TimeRange)
            ? query.timeRange as TimeRange
            : 'day';
        const groupBy: GroupBy = VALID_GROUP_BY.includes(query.groupBy as GroupBy)
            ? query.groupBy as GroupBy
            : 'provider';

        const cacheKey = generateCacheKey('aggregated', { timeRange, groupBy });
        const cached = getCached<AggregatedResponse>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        try {
            const rows = await fetchAggregatedData(usageStorage, timeRange, groupBy);
            const data = aggregateGroupedData(rows, groupBy);

            const response: AggregatedResponse = {
                groupBy,
                timeRange,
                data,
                total: data.length,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Internal Server Error';
            request.log.error(e, 'Failed to fetch aggregated data');
            return reply.code(500).send({ error });
        }
    });
}
