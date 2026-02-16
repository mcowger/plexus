import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { and, gte, lte, sql, count, sum, avg, inArray } from 'drizzle-orm';
import { getCurrentDialect, getSchema } from '../../db/client';
import { UsageStorageService } from '../../services/usage-storage';

const USAGE_FIELDS = new Set([
    'requestId',
    'date',
    'sourceIp',
    'apiKey',
    'attribution',
    'incomingApiType',
    'provider',
    'incomingModelAlias',
    'canonicalModelName',
    'selectedModelName',
    'outgoingApiType',
    'tokensInput',
    'tokensOutput',
    'tokensReasoning',
    'tokensCached',
    'tokensCacheWrite',
    'tokensEstimated',
    'costInput',
    'costOutput',
    'costCached',
    'costCacheWrite',
    'costTotal',
    'costSource',
    'costMetadata',
    'startTime',
    'durationMs',
    'ttftMs',
    'tokensPerSec',
    'isStreamed',
    'isPassthrough',
    'responseStatus',
    'toolsDefined',
    'messageCount',
    'parallelToolCallsEnabled',
    'toolCallsCount',
    'finishReason',
    'hasDebug',
    'hasError'
]);

export async function registerUsageRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/usage', async (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        const rawFields = typeof query.fields === 'string' ? query.fields : '';
        const requestedFields = rawFields
            .split(',')
            .map((field: string) => field.trim())
            .filter((field: string) => USAGE_FIELDS.has(field));

        const filters: any = {
            startDate: query.startDate,
            endDate: query.endDate,
            incomingApiType: query.incomingApiType,
            provider: query.provider,
            incomingModelAlias: query.incomingModelAlias,
            selectedModelName: query.selectedModelName,
            outgoingApiType: query.outgoingApiType,
            responseStatus: query.responseStatus
        };

        if (query.minDurationMs) filters.minDurationMs = parseInt(query.minDurationMs);
        if (query.maxDurationMs) filters.maxDurationMs = parseInt(query.maxDurationMs);

        // Filter to exclude unknown (null) providers
        if (query.excludeUnknownProvider === 'true') {
            filters.excludeUnknownProvider = true;
        }

        // Filter to only enabled providers (comma-separated list)
        if (query.enabledProviders) {
            filters.enabledProviders = query.enabledProviders.split(',').map((p: string) => p.trim());
        }

        try {
            const result = await usageStorage.getUsage(filters, { limit, offset });
            if (requestedFields.length === 0) {
                return reply.send(result);
            }

            const filteredData = result.data.map((record: any) => {
                const filtered: Record<string, unknown> = {};
                for (const field of requestedFields) {
                    filtered[field] = record[field];
                }
                return filtered;
            });

            return reply.send({
                data: filteredData,
                total: result.total
            });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.get('/v0/management/usage/summary', async (request, reply) => {
        const query = request.query as any;
        const range = query.range || 'day';
        if (!['hour', 'day', 'week', 'month'].includes(range)) {
            return reply.code(400).send({ error: 'Invalid range' });
        }

        const now = new Date();
        now.setSeconds(0, 0);
        const rangeStart = new Date(now);
        const statsStart = new Date(now);
        statsStart.setDate(statsStart.getDate() - 7);
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        let stepSeconds = 60;
        switch (range) {
            case 'hour':
                rangeStart.setHours(rangeStart.getHours() - 1);
                stepSeconds = 60;
                break;
            case 'day':
                rangeStart.setHours(rangeStart.getHours() - 24);
                stepSeconds = 60 * 60;
                break;
            case 'week':
                rangeStart.setDate(rangeStart.getDate() - 7);
                stepSeconds = 60 * 60 * 24;
                break;
            case 'month':
                rangeStart.setDate(rangeStart.getDate() - 30);
                stepSeconds = 60 * 60 * 24;
                break;
        }

        const db = usageStorage.getDb();
        const schema = getSchema();
        const dialect = getCurrentDialect();
        const stepMs = stepSeconds * 1000;
        const nowMs = now.getTime();
        const rangeStartMs = rangeStart.getTime();
        const statsStartMs = statsStart.getTime();
        const todayStartMs = todayStart.getTime();

        // Build filter conditions (now that schema is available)
        const filterConditions: any[] = [];

        // Filter to exclude unknown (null) providers
        if (query.excludeUnknownProvider === 'true') {
            filterConditions.push(sql`${schema.requestUsage.provider} IS NOT NULL`);
        }

        // Filter to only enabled providers
        if (query.enabledProviders) {
            const enabledList = query.enabledProviders.split(',').map((p: string) => p.trim());
            filterConditions.push(inArray(schema.requestUsage.provider, enabledList));
        }

        const stepMsLiteral = sql.raw(String(stepMs));
        const bucketStartMs = dialect === 'sqlite'
            ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
            : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

        const toNumber = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

        try {
            const seriesWhereConditions = [
                gte(schema.requestUsage.startTime, rangeStartMs),
                lte(schema.requestUsage.startTime, nowMs),
                ...filterConditions
            ];

            const seriesRows = await db
                .select({
                    bucketStartMs,
                    requests: count(),
                    inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
                    outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
                    cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`
                })
                .from(schema.requestUsage)
                .where(and(...seriesWhereConditions))
                .groupBy(bucketStartMs)
                .orderBy(bucketStartMs);

            const statsWhereConditions = [
                gte(schema.requestUsage.startTime, statsStartMs),
                lte(schema.requestUsage.startTime, nowMs),
                ...filterConditions
            ];

            const statsRows = await db
                .select({
                    requests: count(),
                    inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
                    outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
                    avgDurationMs: sql<number>`COALESCE(${avg(schema.requestUsage.durationMs)}, 0)`
                })
                .from(schema.requestUsage)
                .where(and(...statsWhereConditions));

            const todayWhereConditions = [
                gte(schema.requestUsage.startTime, todayStartMs),
                lte(schema.requestUsage.startTime, nowMs),
                ...filterConditions
            ];

            const todayRows = await db
                .select({
                    requests: count(),
                    inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
                    outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
                    reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
                    cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
                    totalCost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`
                })
                .from(schema.requestUsage)
                .where(and(...todayWhereConditions));

            const statsRow = statsRows[0] || {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                cacheWriteTokens: 0,
                avgDurationMs: 0
            };

            const todayRow = todayRows[0] || {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cachedTokens: 0,
                cacheWriteTokens: 0,
                totalCost: 0
            };

            return reply.send({
                range,
                series: seriesRows.map(row => ({
                    bucketStartMs: toNumber(row.bucketStartMs),
                    requests: toNumber(row.requests),
                    inputTokens: toNumber(row.inputTokens),
                    outputTokens: toNumber(row.outputTokens),
                    cachedTokens: toNumber(row.cachedTokens),
                    cacheWriteTokens: toNumber(row.cacheWriteTokens),
                    tokens: toNumber(row.inputTokens) + toNumber(row.outputTokens) + toNumber(row.cachedTokens) + toNumber(row.cacheWriteTokens)
                })),
                stats: {
                    totalRequests: toNumber(statsRow.requests),
                    totalTokens: toNumber(statsRow.inputTokens) + toNumber(statsRow.outputTokens) + toNumber(statsRow.cachedTokens) + toNumber(statsRow.cacheWriteTokens),
                    avgDurationMs: toNumber(statsRow.avgDurationMs)
                },
                today: {
                    requests: toNumber(todayRow.requests),
                    inputTokens: toNumber(todayRow.inputTokens),
                    outputTokens: toNumber(todayRow.outputTokens),
                    reasoningTokens: toNumber(todayRow.reasoningTokens),
                    cachedTokens: toNumber(todayRow.cachedTokens),
                    cacheWriteTokens: toNumber(todayRow.cacheWriteTokens),
                    totalCost: toNumber(todayRow.totalCost)
                }
            });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/usage', async (request, reply) => {
        const query = request.query as any;
        const olderThanDays = query.olderThanDays;
        let beforeDate: Date | undefined;

        if (olderThanDays) {
            const days = parseInt(olderThanDays);
            if (!isNaN(days)) {
                beforeDate = new Date();
                beforeDate.setDate(beforeDate.getDate() - days);
            }
        }

        const success = await usageStorage.deleteAllUsageLogs(beforeDate);
        if (!success) return reply.code(500).send({ error: "Failed to delete usage logs" });
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/usage/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = await usageStorage.deleteUsageLog(requestId);
        if (!success) return reply.code(404).send({ error: "Usage log not found or could not be deleted" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/events', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const listener = async (record: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(encode({
                data: JSON.stringify(record),
                event: 'log',
                id: String(Date.now()),
            }));
        };

        usageStorage.on('created', listener);

        request.raw.on('close', () => {
            usageStorage.off('created', listener);
        });

        // Keep connection alive with periodic pings
        while (!request.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            if (!reply.raw.destroyed) {
                reply.raw.write(encode({
                    event: 'ping',
                    data: 'pong',
                    id: String(Date.now())
                }));
            }
        }
    });
}
