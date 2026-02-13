import { FastifyInstance } from 'fastify';
import { and, gte, lte, sql } from 'drizzle-orm';
import { encode } from 'eventsource-encoder';
import { getCurrentDialect, getSchema } from '../../db/client';
import { UsageStorageService } from '../../services/usage-storage';
import { CooldownManager } from '../../services/cooldown-manager';

const CACHE_TTL_MS = 30000; // 30 seconds cache TTL

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

// Simple in-memory cache for aggregated data
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
        return entry.data as T;
    }
    cache.delete(key);
    return null;
}

function setCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL_MS): void {
    cache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs
    });
}

function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `${prefix}:${sortedParams}`;
}

type TimeRange = 'hour' | 'day' | 'week' | 'month';
type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';
type MetricKey = 'requests' | 'tokens' | 'cost' | 'duration' | 'ttft';

interface ChartDataPoint {
    name: string;
    requests: number;
    tokens: number;
    cost: number;
    duration: number;
    ttft: number;
    fill?: string;
}

interface AggregatedDataPoint {
    name: string;
    requests: number;
    tokens: number;
    cost: number;
    duration: number;
    ttft: number;
}

interface ChartDataResponse {
    timeRange: TimeRange;
    granularity: 'minute' | 'hour' | 'day';
    data: ChartDataPoint[];
    total: number;
    generatedAt: string;
}

interface AggregatedResponse {
    groupBy: GroupBy;
    timeRange: TimeRange;
    data: AggregatedDataPoint[];
    total: number;
    generatedAt: string;
}

const VALID_TIME_RANGES: TimeRange[] = ['hour', 'day', 'week', 'month'];
const VALID_GROUP_BY: GroupBy[] = ['time', 'provider', 'model', 'apiKey', 'status'];
const VALID_METRICS: MetricKey[] = ['requests', 'tokens', 'cost', 'duration', 'ttft'];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#f43f5e'];

function getTimeRangeBounds(range: TimeRange): { startTime: number; endTime: number; granularity: 'minute' | 'hour' | 'day' } {
    const now = new Date();
    now.setSeconds(0, 0);
    const endTime = now.getTime();
    const startTime = new Date(now);

    let granularity: 'minute' | 'hour' | 'day' = 'hour';

    switch (range) {
        case 'hour':
            startTime.setHours(startTime.getHours() - 1);
            granularity = 'minute';
            break;
        case 'day':
            startTime.setHours(startTime.getHours() - 24);
            granularity = 'hour';
            break;
        case 'week':
            startTime.setDate(startTime.getDate() - 7);
            granularity = 'day';
            break;
        case 'month':
            startTime.setDate(startTime.getDate() - 30);
            granularity = 'day';
            break;
    }

    return { startTime: startTime.getTime(), endTime, granularity };
}

function getBucketFormat(range: TimeRange): (timestamp: number) => string {
    switch (range) {
        case 'hour':
            return (ts: number) => {
                const date = new Date(ts);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };
        case 'day':
            return (ts: number) => {
                const date = new Date(ts);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };
        case 'week':
        case 'month':
        default:
            return (ts: number) => {
                const date = new Date(ts);
                return date.toLocaleDateString();
            };
    }
}

export async function registerMetricsRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    // GET /api/v1/metrics/chart-data - Returns pre-aggregated data for charts
    fastify.get('/api/v1/metrics/chart-data', async (request, reply) => {
        const query = request.query as any;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange)
            ? query.timeRange
            : 'day';

        const metrics: MetricKey[] = query.metrics
            ? query.metrics.split(',').filter((m: string) => VALID_METRICS.includes(m as MetricKey))
            : ['requests', 'tokens', 'cost'];

        const cacheKey = generateCacheKey('chart-data', { timeRange, metrics: metrics.join(',') });
        const cached = getCached<ChartDataResponse>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        const { startTime, endTime, granularity } = getTimeRangeBounds(timeRange);
        const db = usageStorage.getDb();
        const schema = getSchema();
        const dialect = getCurrentDialect();

        try {
            // Build bucket SQL based on granularity
            let bucketSql: ReturnType<typeof sql<number>>;
            const stepMs = granularity === 'minute' ? 60 * 1000 : granularity === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
            const stepMsLiteral = sql.raw(String(stepMs));

            bucketSql = dialect === 'sqlite'
                ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
                : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

            const rows = await db
                .select({
                    bucketStartMs: bucketSql,
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
                    cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
                    cost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
                    durationSum: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
                    durationCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.durationMs} > 0 THEN 1 END)`,
                    ttftSum: sql<number>`COALESCE(SUM(${schema.requestUsage.ttftMs}), 0)`,
                    ttftCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.ttftMs} > 0 THEN 1 END)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, startTime),
                    lte(schema.requestUsage.startTime, endTime)
                ))
                .groupBy(bucketSql)
                .orderBy(bucketSql);

            const bucketFormat = getBucketFormat(timeRange);
            const data: ChartDataPoint[] = rows.map(row => {
                const bucketStartMs = Number(row.bucketStartMs) || 0;
                const requests = Number(row.requests) || 0;
                const tokens = Number(row.inputTokens) + Number(row.outputTokens) + Number(row.reasoningTokens) + Number(row.cachedTokens);
                const cost = Number(row.cost) || 0;
                const durationCount = Number(row.durationCount) || 0;
                const ttftCount = Number(row.ttftCount) || 0;

                return {
                    name: bucketFormat(bucketStartMs),
                    requests,
                    tokens,
                    cost,
                    duration: durationCount > 0 ? (Number(row.durationSum) || 0) / durationCount : 0,
                    ttft: ttftCount > 0 ? (Number(row.ttftSum) || 0) / ttftCount : 0
                };
            });

            const response: ChartDataResponse = {
                timeRange,
                granularity,
                data,
                total: data.length,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: any) {
            request.log.error('Failed to fetch chart data', e);
            return reply.code(500).send({ error: e.message || 'Internal Server Error' });
        }
    });

    // GET /api/v1/metrics/aggregated - Returns aggregated data by provider, model, apiKey, or status
    fastify.get('/api/v1/metrics/aggregated', async (request, reply) => {
        const query = request.query as any;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange)
            ? query.timeRange
            : 'day';
        const groupBy: GroupBy = VALID_GROUP_BY.includes(query.groupBy)
            ? query.groupBy
            : 'provider';

        const cacheKey = generateCacheKey('aggregated', { timeRange, groupBy });
        const cached = getCached<AggregatedResponse>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        const { startTime, endTime } = getTimeRangeBounds(timeRange);
        const db = usageStorage.getDb();
        const schema = getSchema();

        try {
            let groupByColumn: ReturnType<typeof sql<string>>;

            switch (groupBy) {
                case 'provider':
                    groupByColumn = sql<string>`COALESCE(${schema.requestUsage.provider}, 'unknown')`;
                    break;
                case 'model':
                    groupByColumn = sql<string>`COALESCE(${schema.requestUsage.incomingModelAlias}, ${schema.requestUsage.selectedModelName}, 'unknown')`;
                    break;
                case 'apiKey':
                    groupByColumn = sql<string>`COALESCE(${schema.requestUsage.apiKey}, 'unknown')`;
                    break;
                case 'status':
                    groupByColumn = sql<string>`COALESCE(${schema.requestUsage.responseStatus}, 'unknown')`;
                    break;
                case 'time':
                default:
                    groupByColumn = sql<string>`'time'`;
                    break;
            }

            const rows = await db
                .select({
                    groupKey: groupByColumn,
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
                    cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
                    cost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
                    durationSum: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
                    durationCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.durationMs} > 0 THEN 1 END)`,
                    ttftSum: sql<number>`COALESCE(SUM(${schema.requestUsage.ttftMs}), 0)`,
                    ttftCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.ttftMs} > 0 THEN 1 END)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, startTime),
                    lte(schema.requestUsage.startTime, endTime)
                ))
                .groupBy(groupByColumn)
                .orderBy(sql`COUNT(*) DESC`);

            const data: AggregatedDataPoint[] = rows.map((row, index) => {
                let name = String(row.groupKey || 'unknown');

                // Truncate API key for display
                if (groupBy === 'apiKey' && name.length > 8) {
                    name = name.slice(0, 8) + '...';
                }

                const requests = Number(row.requests) || 0;
                const tokens = Number(row.inputTokens) + Number(row.outputTokens) + Number(row.reasoningTokens) + Number(row.cachedTokens);
                const cost = Number(row.cost) || 0;
                const durationCount = Number(row.durationCount) || 0;
                const ttftCount = Number(row.ttftCount) || 0;

                return {
                    name,
                    requests,
                    tokens,
                    cost,
                    duration: durationCount > 0 ? (Number(row.durationSum) || 0) / durationCount : 0,
                    ttft: ttftCount > 0 ? (Number(row.ttftSum) || 0) / ttftCount : 0
                };
            });

            // Limit to top 10 for non-time groupings
            const limitedData = groupBy === 'time' ? data : data.slice(0, 10);

            // Add colors for pie chart
            const dataWithColors = limitedData.map((item, index) => ({
                ...item,
                fill: COLORS[index % COLORS.length]
            }));

            const response: AggregatedResponse = {
                groupBy,
                timeRange,
                data: dataWithColors,
                total: dataWithColors.length,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: any) {
            request.log.error('Failed to fetch aggregated data', e);
            return reply.code(500).send({ error: e.message || 'Internal Server Error' });
        }
    });

    // GET /api/v1/metrics/stats - Returns summary statistics for the dashboard
    fastify.get('/api/v1/metrics/stats', async (request, reply) => {
        const query = request.query as any;
        const timeRange: TimeRange = VALID_TIME_RANGES.includes(query.timeRange)
            ? query.timeRange
            : 'day';

        const cacheKey = generateCacheKey('stats', { timeRange });
        const cached = getCached<{ timeRange: TimeRange; stats: Record<string, number>; generatedAt: string }>(cacheKey);
        if (cached) {
            return reply.send(cached);
        }

        const { startTime, endTime } = getTimeRangeBounds(timeRange);
        const db = usageStorage.getDb();
        const schema = getSchema();

        try {
            const rows = await db
                .select({
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
                    cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
                    cost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
                    durationSum: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
                    durationCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.durationMs} > 0 THEN 1 END)`,
                    successCount: sql<number>`COUNT(CASE WHEN ${schema.requestUsage.responseStatus} = 'success' THEN 1 END)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, startTime),
                    lte(schema.requestUsage.startTime, endTime)
                ));

            const row = rows[0];
            const totalRequests = Number(row?.requests) || 0;
            const successCount = Number(row?.successCount) || 0;
            const durationCount = Number(row?.durationCount) || 0;

            const stats = {
                requests: totalRequests,
                tokens: (Number(row?.inputTokens) || 0) + (Number(row?.outputTokens) || 0) +
                        (Number(row?.reasoningTokens) || 0) + (Number(row?.cachedTokens) || 0),
                cost: Number(row?.cost) || 0,
                avgDuration: durationCount > 0 ? (Number(row?.durationSum) || 0) / durationCount : 0,
                successRate: totalRequests > 0 ? successCount / totalRequests : 1
            };

            const response = {
                timeRange,
                stats,
                generatedAt: new Date().toISOString()
            };

            setCache(cacheKey, response);
            return reply.send(response);
        } catch (e: any) {
            request.log.error('Failed to fetch stats', e);
            return reply.code(500).send({ error: e.message || 'Internal Server Error' });
        }
    });

    // GET /api/v1/metrics/stream - Unified SSE endpoint for real-time metrics
    fastify.get('/api/v1/metrics/stream', async (request, reply) => {
        const query = request.query as any;
        const windowMinutes = Math.min(60, Math.max(1, parseInt(query.windowMinutes || '5', 10)));
        const limit = Math.min(5000, Math.max(50, parseInt(query.limit || '1200', 10)));

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Send connected event
        reply.raw.write(encode({
            event: 'connected',
            data: JSON.stringify({
                type: 'connected',
                timestamp: Date.now(),
                data: { message: 'Connected to metrics stream', timestamp: Date.now() }
            }),
            id: String(Date.now())
        }));

        let isActive = true;
        const clients = new Set<() => void>();

        /**
         * Send an event to the client
         */
        const sendEvent = (eventType: string, data: unknown) => {
            if (!isActive || reply.raw.destroyed) return;
            try {
                reply.raw.write(encode({
                    event: eventType,
                    data: JSON.stringify({
                        type: eventType,
                        timestamp: Date.now(),
                        data
                    }),
                    id: String(Date.now())
                }));
            } catch (e: any) {
                request.log.error('Failed to send SSE event', e?.message || String(e));
                isActive = false;
            }
        };

        /**
         * Build live dashboard snapshot
         */
        const buildLiveSnapshot = async (): Promise<{
            windowMinutes: number;
            requestCount: number;
            successCount: number;
            errorCount: number;
            successRate: number;
            totalTokens: number;
            totalCost: number;
            tokensPerMinute: number;
            costPerMinute: number;
            avgDurationMs: number;
            avgTtftMs: number;
            avgTokensPerSec: number;
            providers: Array<{
                provider: string;
                requests: number;
                successes: number;
                errors: number;
                successRate: number;
                totalTokens: number;
                totalCost: number;
                avgDurationMs: number;
                avgTtftMs: number;
                avgTokensPerSec: number;
            }>;
            recentRequests: unknown[];
        }> => {
            const windowStartMs = Date.now() - (windowMinutes * 60 * 1000);
            const db = usageStorage.getDb();
            const schema = getSchema();

            const rows = await db
                .select({
                    requestId: schema.requestUsage.requestId,
                    date: schema.requestUsage.date,
                    provider: schema.requestUsage.provider,
                    incomingModelAlias: schema.requestUsage.incomingModelAlias,
                    selectedModelName: schema.requestUsage.selectedModelName,
                    responseStatus: schema.requestUsage.responseStatus,
                    tokensInput: schema.requestUsage.tokensInput,
                    tokensOutput: schema.requestUsage.tokensOutput,
                    tokensReasoning: schema.requestUsage.tokensReasoning,
                    tokensCached: schema.requestUsage.tokensCached,
                    costTotal: schema.requestUsage.costTotal,
                    durationMs: schema.requestUsage.durationMs,
                    ttftMs: schema.requestUsage.ttftMs,
                    tokensPerSec: schema.requestUsage.tokensPerSec
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, windowStartMs)
                ))
                .orderBy(sql`${schema.requestUsage.startTime} DESC`)
                .limit(limit);

            let requestCount = 0;
            let successCount = 0;
            let errorCount = 0;
            let totalTokens = 0;
            let totalCost = 0;
            let durationSum = 0;
            let durationSamples = 0;
            let ttftSum = 0;
            let ttftSamples = 0;
            let tokensPerSecSum = 0;
            let tokensPerSecSamples = 0;

            const providerStats = new Map<string, {
                requests: number;
                successes: number;
                errors: number;
                totalTokens: number;
                totalCost: number;
                durationSum: number;
                durationSamples: number;
                ttftSum: number;
                ttftSamples: number;
                tokensPerSecSum: number;
                tokensPerSecSamples: number;
            }>();

            for (const record of rows) {
                requestCount++;
                const provider = String(record.provider || 'unknown');
                const status = String(record.responseStatus || 'unknown').toLowerCase();
                const isSuccess = status === 'success';

                if (isSuccess) {
                    successCount++;
                } else {
                    errorCount++;
                }

                const inputTokens = Number(record.tokensInput) || 0;
                const outputTokens = Number(record.tokensOutput) || 0;
                const reasoningTokens = Number(record.tokensReasoning) || 0;
                const cachedTokens = Number(record.tokensCached) || 0;
                const requestTokens = inputTokens + outputTokens + reasoningTokens + cachedTokens;
                const requestCost = Number(record.costTotal) || 0;
                const durationMs = Number(record.durationMs) || 0;
                const ttftMs = Number(record.ttftMs) || 0;
                const tps = Number(record.tokensPerSec) || 0;

                totalTokens += requestTokens;
                totalCost += requestCost;

                if (durationMs > 0) {
                    durationSum += durationMs;
                    durationSamples++;
                }
                if (ttftMs > 0) {
                    ttftSum += ttftMs;
                    ttftSamples++;
                }
                if (tps > 0) {
                    tokensPerSecSum += tps;
                    tokensPerSecSamples++;
                }

                const existing = providerStats.get(provider) ?? {
                    requests: 0, successes: 0, errors: 0,
                    totalTokens: 0, totalCost: 0,
                    durationSum: 0, durationSamples: 0,
                    ttftSum: 0, ttftSamples: 0,
                    tokensPerSecSum: 0, tokensPerSecSamples: 0
                };

                existing.requests++;
                existing.successes += isSuccess ? 1 : 0;
                existing.errors += isSuccess ? 0 : 1;
                existing.totalTokens += requestTokens;
                existing.totalCost += requestCost;

                if (durationMs > 0) {
                    existing.durationSum += durationMs;
                    existing.durationSamples++;
                }
                if (ttftMs > 0) {
                    existing.ttftSum += ttftMs;
                    existing.ttftSamples++;
                }
                if (tps > 0) {
                    existing.tokensPerSecSum += tps;
                    existing.tokensPerSecSamples++;
                }

                providerStats.set(provider, existing);
            }

            const providers = Array.from(providerStats.entries())
                .map(([provider, stats]) => ({
                    provider,
                    requests: stats.requests,
                    successes: stats.successes,
                    errors: stats.errors,
                    successRate: stats.requests > 0 ? stats.successes / stats.requests : 1,
                    totalTokens: stats.totalTokens,
                    totalCost: stats.totalCost,
                    avgDurationMs: stats.durationSamples > 0 ? stats.durationSum / stats.durationSamples : 0,
                    avgTtftMs: stats.ttftSamples > 0 ? stats.ttftSum / stats.ttftSamples : 0,
                    avgTokensPerSec: stats.tokensPerSecSamples > 0 ? stats.tokensPerSecSum / stats.tokensPerSecSamples : 0
                }))
                .sort((a, b) => b.requests - a.requests);

            const recentRequests = rows.slice(0, 20).map(record => {
                const inputTokens = Number(record.tokensInput) || 0;
                const outputTokens = Number(record.tokensOutput) || 0;
                const reasoningTokens = Number(record.tokensReasoning) || 0;
                const cachedTokens = Number(record.tokensCached) || 0;

                return {
                    requestId: String(record.requestId || ''),
                    date: String(record.date || ''),
                    provider: String(record.provider || 'unknown'),
                    model: String(record.selectedModelName || record.incomingModelAlias || 'unknown'),
                    responseStatus: String(record.responseStatus || 'unknown'),
                    totalTokens: inputTokens + outputTokens + reasoningTokens + cachedTokens,
                    costTotal: Number(record.costTotal) || 0,
                    durationMs: Number(record.durationMs) || 0,
                    ttftMs: Number(record.ttftMs) || 0,
                    tokensPerSec: Number(record.tokensPerSec) || 0
                };
            });

            return {
                windowMinutes,
                requestCount,
                successCount,
                errorCount,
                successRate: requestCount > 0 ? successCount / requestCount : 1,
                totalTokens,
                totalCost,
                tokensPerMinute: totalTokens / windowMinutes,
                costPerMinute: totalCost / windowMinutes,
                avgDurationMs: durationSamples > 0 ? durationSum / durationSamples : 0,
                avgTtftMs: ttftSamples > 0 ? ttftSum / ttftSamples : 0,
                avgTokensPerSec: tokensPerSecSamples > 0 ? tokensPerSecSum / tokensPerSecSamples : 0,
                providers,
                recentRequests
            };
        };

        /**
         * Build dashboard data
         */
        const buildDashboardData = async (timeRange: TimeRange) => {
            const { startTime } = getTimeRangeBounds(timeRange);
            const db = usageStorage.getDb();
            const schema = getSchema();
            const now = new Date();
            now.setSeconds(0, 0);

            // Get usage data
            const stepSeconds = timeRange === 'hour' ? 60 : 60 * 60;
            const stepMs = stepSeconds * 1000;
            const dialect = getCurrentDialect();

            const stepMsLiteral = sql.raw(String(stepMs));
            const bucketSql = dialect === 'sqlite'
                ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
                : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

            const [seriesRows, statsRows, todayRows] = await Promise.all([
                db.select({
                    bucketStartMs: bucketSql,
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, startTime),
                    lte(schema.requestUsage.startTime, now.getTime())
                ))
                .groupBy(bucketSql)
                .orderBy(bucketSql),

                db.select({
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    avgDurationMs: sql<number>`COALESCE(AVG(${schema.requestUsage.durationMs}), 0)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime()),
                    lte(schema.requestUsage.startTime, now.getTime())
                )),

                db.select({
                    requests: sql<number>`COUNT(*)`,
                    inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
                    outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
                    reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
                    cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
                    totalCost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, new Date(now.setHours(0, 0, 0, 0)).getTime()),
                    lte(schema.requestUsage.startTime, Date.now())
                ))
            ]);

            const statsRow = statsRows[0];
            const todayRow = todayRows[0];

            const bucketFormat = getBucketFormat(timeRange);

            return {
                stats: [
                    { label: 'Total Requests', value: String(statsRow?.requests || 0) },
                    { label: 'Active Providers', value: '-' },
                    { label: 'Total Tokens', value: String((statsRow?.inputTokens || 0) + (statsRow?.outputTokens || 0)) },
                    { label: 'Avg. Duration', value: String(Math.round(statsRow?.avgDurationMs || 0)) + 'ms' }
                ],
                usageData: seriesRows.map(row => ({
                    timestamp: bucketFormat(Number(row.bucketStartMs)),
                    requests: Number(row.requests) || 0,
                    tokens: (Number(row.inputTokens) || 0) + (Number(row.outputTokens) || 0) + (Number(row.cachedTokens) || 0),
                    inputTokens: Number(row.inputTokens) || 0,
                    outputTokens: Number(row.outputTokens) || 0,
                    cachedTokens: Number(row.cachedTokens) || 0
                })),
                cooldowns: [],
                todayMetrics: {
                    requests: Number(todayRow?.requests) || 0,
                    inputTokens: Number(todayRow?.inputTokens) || 0,
                    outputTokens: Number(todayRow?.outputTokens) || 0,
                    reasoningTokens: Number(todayRow?.reasoningTokens) || 0,
                    cachedTokens: Number(todayRow?.cachedTokens) || 0,
                    totalCost: Number(todayRow?.totalCost) || 0
                },
                timeRange
            };
        };

        /**
         * Get provider performance data
         */
        const getProviderPerformance = async () => {
            const db = usageStorage.getDb();
            const schema = getSchema();

            const rows = await db
                .select({
                    provider: schema.requestUsage.provider,
                    incomingModelAlias: schema.requestUsage.incomingModelAlias,
                    selectedModelName: schema.requestUsage.selectedModelName,
                    ttftMs: schema.requestUsage.ttftMs,
                    tokensPerSec: schema.requestUsage.tokensPerSec
                })
                .from(schema.requestUsage)
                .where(and(
                    gte(schema.requestUsage.startTime, Date.now() - 7 * 24 * 60 * 60 * 1000),
                    sql`${schema.requestUsage.ttftMs} > 0 OR ${schema.requestUsage.tokensPerSec} > 0`
                ));

            const grouped = new Map<string, {
                ttftWeighted: number;
                tpsWeighted: number;
                samples: number;
            }>();

            for (const row of rows) {
                const provider = String(row.provider || 'unknown');
                const model = String(row.incomingModelAlias || row.selectedModelName || 'unknown');
                const key = `${provider}:${model}`;

                const current = grouped.get(key) ?? { ttftWeighted: 0, tpsWeighted: 0, samples: 0 };
                const weight = 1;

                current.samples += weight;
                current.ttftWeighted += (Number(row.ttftMs) || 0) * weight;
                current.tpsWeighted += (Number(row.tokensPerSec) || 0) * weight;

                grouped.set(key, current);
            }

            return Array.from(grouped.entries()).map(([key, metrics]) => {
                const [provider, model] = key.split(':');
                const samples = Math.max(1, metrics.samples);

                return {
                    provider,
                    model,
                    avg_ttft_ms: metrics.ttftWeighted / samples,
                    min_ttft_ms: 0,
                    max_ttft_ms: 0,
                    avg_tokens_per_sec: metrics.tpsWeighted / samples,
                    min_tokens_per_sec: 0,
                    max_tokens_per_sec: 0,
                    sample_count: metrics.samples,
                    last_updated: Date.now()
                };
            });
        };

        /**
         * Send initial data
         */
        const sendInitialData = async () => {
            try {
                const [snapshot, dashboard] = await Promise.all([
                    buildLiveSnapshot(),
                    buildDashboardData('day')
                ]);

                sendEvent('live_snapshot', snapshot);
                sendEvent('dashboard', dashboard);

                const performance = await getProviderPerformance();
                sendEvent('provider_performance', performance);
            } catch (e: any) {
                request.log.error('Failed to send initial data', e?.message || String(e));
            }
        };

        // Send initial data
        await sendInitialData();

        // Set up periodic data refresh
        const refreshInterval = setInterval(async () => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(refreshInterval);
                return;
            }

            try {
                const snapshot = await buildLiveSnapshot();
                sendEvent('live_snapshot', snapshot);
            } catch (e: any) {
                request.log.error('Failed to refresh live snapshot', e?.message || String(e));
            }
        }, 5000); // Refresh every 5 seconds

        // Set up dashboard refresh (less frequent)
        const dashboardInterval = setInterval(async () => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(dashboardInterval);
                return;
            }

            try {
                const dashboard = await buildDashboardData('day');
                sendEvent('dashboard', dashboard);

                const performance = await getProviderPerformance();
                sendEvent('provider_performance', performance);
            } catch (e: any) {
                request.log.error('Failed to refresh dashboard', e?.message || String(e));
            }
        }, 30000); // Refresh every 30 seconds

        // Keep connection alive with pings
        const pingInterval = setInterval(() => {
            if (!isActive || reply.raw.destroyed) {
                clearInterval(pingInterval);
                return;
            }
            sendEvent('ping', {});
        }, 10000); // Ping every 10 seconds

        // Listen for new usage records
        const usageListener = (record: unknown) => {
            sendEvent('usage_update', record);
        };

        usageStorage.on('created', usageListener);
        clients.add(() => usageStorage.off('created', usageListener));

        // Clean up on close
        request.raw.on('close', () => {
            isActive = false;
            clearInterval(refreshInterval);
            clearInterval(dashboardInterval);
            clearInterval(pingInterval);
            clients.forEach(cleanup => cleanup());
            clients.clear();
            usageStorage.off('created', usageListener);
        });

        // Keep connection open
        while (isActive && !reply.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });
}
