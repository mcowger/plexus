import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import Fastify from 'fastify';
import { registerMetricsRoutes } from '../metrics';
import { UsageStorageService } from '../../../services/usage-storage';

// Mock the database and usage storage
const mockDb = {
    select: () => ({
        from: () => ({
            where: () => ({
                groupBy: () => ({
                    orderBy: () => Promise.resolve([
                        {
                            bucketStartMs: Date.now() - 3600000,
                            requests: 10,
                            inputTokens: 100,
                            outputTokens: 200,
                            cachedTokens: 50,
                            cost: 0.5,
                            durationSum: 5000,
                            durationCount: 10,
                            ttftSum: 1000,
                            ttftCount: 10
                        }
                    ])
                }),
                orderBy: () => Promise.resolve([
                    {
                        groupKey: 'test-provider',
                        requests: 10,
                        inputTokens: 100,
                        outputTokens: 200,
                        cachedTokens: 50,
                        cost: 0.5,
                        durationSum: 5000,
                        durationCount: 10,
                        ttftSum: 1000,
                        ttftCount: 10
                    }
                ])
            })
        })
    })
};

const mockSchema = {
    requestUsage: {
        startTime: 'start_time',
        provider: 'provider',
        incomingModelAlias: 'incoming_model_alias',
        selectedModelName: 'selected_model_name',
        apiKey: 'api_key',
        responseStatus: 'response_status',
        tokensInput: 'tokens_input',
        tokensOutput: 'tokens_output',
        tokensReasoning: 'tokens_reasoning',
        tokensCached: 'tokens_cached',
        costTotal: 'cost_total',
        durationMs: 'duration_ms',
        ttftMs: 'ttft_ms'
    }
};

// Mock the db client module
mock.module('../../../db/client', () => ({
    getCurrentDialect: () => 'sqlite',
    getSchema: () => mockSchema,
    getDatabase: () => mockDb,
    initializeDatabase: () => {},
    closeDatabase: () => {}
}));

describe('Metrics Routes', () => {
    let fastify: ReturnType<typeof Fastify>;
    let usageStorage: UsageStorageService;

    beforeEach(async () => {
        fastify = Fastify();
        usageStorage = new UsageStorageService();

        // Mock the getDb method
        usageStorage.getDb = () => mockDb as any;

        await registerMetricsRoutes(fastify, usageStorage);
    });

    afterEach(async () => {
        await fastify.close();
    });

    describe('GET /api/v1/metrics/chart-data', () => {
        it('returns chart data with valid time range', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/chart-data?timeRange=day'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('timeRange', 'day');
            expect(body).toHaveProperty('granularity');
            expect(body).toHaveProperty('data');
            expect(body).toHaveProperty('total');
            expect(body).toHaveProperty('generatedAt');
            expect(Array.isArray(body.data)).toBe(true);
        });

        it('returns 200 with default time range', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/chart-data'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.timeRange).toBe('day');
        });

        it('respects metrics parameter', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/chart-data?timeRange=hour&metrics=requests,tokens'
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /api/v1/metrics/aggregated', () => {
        it('returns aggregated data with valid groupBy', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/aggregated?groupBy=provider&timeRange=day'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('groupBy', 'provider');
            expect(body).toHaveProperty('timeRange');
            expect(body).toHaveProperty('data');
            expect(body).toHaveProperty('total');
            expect(body).toHaveProperty('generatedAt');
            expect(Array.isArray(body.data)).toBe(true);
        });

        it('supports all groupBy options', async () => {
            const groupByOptions = ['time', 'provider', 'model', 'apiKey', 'status'];

            for (const groupBy of groupByOptions) {
                const response = await fastify.inject({
                    method: 'GET',
                    url: `/api/v1/metrics/aggregated?groupBy=${groupBy}&timeRange=day`
                });

                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.body);
                expect(body.groupBy).toBe(groupBy);
            }
        });

        it('returns default groupBy when invalid', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/aggregated?groupBy=invalid&timeRange=day'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.groupBy).toBe('provider');
        });
    });

    describe('GET /api/v1/metrics/stats', () => {
        it('returns stats with valid time range', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/stats?timeRange=day'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('timeRange', 'day');
            expect(body).toHaveProperty('stats');
            expect(body).toHaveProperty('generatedAt');
            expect(body.stats).toHaveProperty('requests');
            expect(body.stats).toHaveProperty('tokens');
            expect(body.stats).toHaveProperty('cost');
            expect(body.stats).toHaveProperty('avgDuration');
            expect(body.stats).toHaveProperty('successRate');
        });

        it('returns 200 with default time range', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/v1/metrics/stats'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.timeRange).toBe('day');
        });
    });
});
