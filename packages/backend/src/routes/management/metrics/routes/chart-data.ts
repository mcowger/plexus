/**
 * GET /api/v1/metrics/chart-data route handler
 * Returns pre-aggregated data for charts
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UsageStorageService } from '../../../../services/usage-storage';
import { ChartDataResponse, MetricKey, TimeRange, VALID_METRICS, VALID_TIME_RANGES } from '../types';
import { getCached, setCache, generateCacheKey } from '../cache';
import { getTimeRangeBounds } from '../time';
import { fetchChartData } from '../queries';
import { aggregateChartData } from '../aggregation';

export function registerChartDataRoute(
    fastify: FastifyInstance,
    usageStorage: UsageStorageService
): void {
    fastify.get('/api/v1/metrics/chart-data', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as Record<string, string>;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange as TimeRange)
            ? query.timeRange as TimeRange
            : 'day';

        const metrics: MetricKey[] = query.metrics
            ? query.metrics.split(',').filter((m: string): m is MetricKey => VALID_METRICS.includes(m as MetricKey))
            : ['requests', 'tokens', 'cost'];

        const cacheKey = generateCacheKey('chart-data', { timeRange, metrics: metrics.join(',') });
        const cached = getCached<ChartDataResponse>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        const { granularity } = getTimeRangeBounds(timeRange);

        try {
            const rows = await fetchChartData(usageStorage, timeRange, granularity);
            const data = aggregateChartData(rows, timeRange);

            const response: ChartDataResponse = {
                timeRange,
                granularity,
                data,
                total: data.length,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Internal Server Error';
            request.log.error(e, 'Failed to fetch chart data');
            return reply.code(500).send({ error });
        }
    });
}
