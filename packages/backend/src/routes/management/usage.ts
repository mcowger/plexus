import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { and, eq, gte, lte, sql, isNull, isNotNull } from 'drizzle-orm';
import { getCurrentDialect, getSchema } from '../../db/client';
import {
  UsageStorageService,
  type UsageSortDirection,
  type UsageSortField,
} from '../../services/usage-storage';
import { isLimited, scopedKeyName } from './_principal';

const USAGE_FIELDS = new Set([
  'requestId',
  'date',
  'sourceIp',
  'apiKey',
  'attribution',
  'incomingApiType',
  'provider',
  'attemptCount',
  'retryHistory',
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
  'kwhUsed',
  'isStreamed',
  'isPassthrough',
  'responseStatus',
  'toolsDefined',
  'messageCount',
  'parallelToolCallsEnabled',
  'toolCallsCount',
  'finishReason',
  'hasDebug',
  'hasError',
]);

export async function registerUsageRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  const sortableFields = new Set<UsageSortField>([
    'date',
    'apiKey',
    'provider',
    'incomingModelAlias',
    'costTotal',
    'durationMs',
  ]);

  fastify.get('/v0/management/usage', async (request, reply) => {
    const query = request.query as any;
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');
    const sortBy = sortableFields.has(query.sortBy as UsageSortField)
      ? (query.sortBy as UsageSortField)
      : 'date';
    const sortDir: UsageSortDirection = query.sortDir === 'asc' ? 'asc' : 'desc';
    const rawFields = typeof query.fields === 'string' ? query.fields : '';
    const requestedFields = rawFields
      .split(',')
      .map((field: string) => field.trim())
      .filter((field: string) => USAGE_FIELDS.has(field));

    const filters: any = {
      startDate: query.startDate,
      endDate: query.endDate,
      apiKey: query.apiKey,
      incomingApiType: query.incomingApiType,
      provider: query.provider,
      incomingModelAlias: query.incomingModelAlias,
      selectedModelName: query.selectedModelName,
      outgoingApiType: query.outgoingApiType,
      responseStatus: query.responseStatus,
    };

    if (query.minDurationMs) filters.minDurationMs = parseInt(query.minDurationMs);
    if (query.maxDurationMs) filters.maxDurationMs = parseInt(query.maxDurationMs);

    // Limited users are force-scoped to their own key (exact match), regardless
    // of any client-supplied apiKey filter.
    const scopeKey = scopedKeyName(request);
    if (scopeKey) {
      filters.apiKey = scopeKey;
      filters.apiKeyMatch = 'exact';
    }

    try {
      const result = await usageStorage.getUsage(filters, { limit, offset, sortBy, sortDir });
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
        total: result.total,
      });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/v0/management/usage/summary', async (request, reply) => {
    const query = request.query as any;
    const range = query.range || 'day';
    const startDateStr = query.startDate;
    const endDateStr = query.endDate;

    // Validate custom date range if provided
    if (range === 'custom') {
      if (!startDateStr || !endDateStr) {
        return reply
          .code(400)
          .send({ error: 'startDate and endDate are required for custom range' });
      }
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid date format' });
      }
      if (endDate < startDate) {
        return reply.code(400).send({ error: 'endDate must be after startDate' });
      }
    } else if (!['hour', 'day', 'week', 'month'].includes(range)) {
      return reply.code(400).send({ error: 'Invalid range' });
    }

    const now = new Date();
    now.setSeconds(0, 0);
    let rangeStart = new Date(now);
    let rangeEnd = new Date(now);

    if (range === 'custom' && startDateStr && endDateStr) {
      rangeStart = new Date(startDateStr);
      rangeEnd = new Date(endDateStr);
    } else {
      switch (range as 'hour' | 'day' | 'week' | 'month') {
        case 'hour':
          rangeStart.setHours(rangeStart.getHours() - 1);
          break;
        case 'day':
          rangeStart.setHours(rangeStart.getHours() - 24);
          break;
        case 'week':
          rangeStart.setDate(rangeStart.getDate() - 7);
          break;
        case 'month':
          rangeStart.setDate(rangeStart.getDate() - 30);
          break;
      }
    }

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const statsStart = new Date(now);
    statsStart.setDate(statsStart.getDate() - 7);

    let stepSeconds = 60;
    if (range === 'custom') {
      // Calculate appropriate step based on range duration (adaptive bucketing)
      const durationMs = rangeEnd.getTime() - rangeStart.getTime();
      const durationMinutes = durationMs / (1000 * 60);
      const durationSeconds = durationMs / 1000;

      // Adaptive bucketing thresholds (matching frontend LiveTab)
      const useMinuteBuckets = durationMinutes <= 30;
      const use5MinuteBuckets = durationMinutes <= 24 * 60;
      const useHourlyBuckets = durationMinutes <= 7 * 24 * 60;

      if (useMinuteBuckets) {
        stepSeconds = 60; // 1-minute buckets
      } else if (use5MinuteBuckets) {
        stepSeconds = 300; // 5-minute buckets
      } else if (useHourlyBuckets) {
        stepSeconds = 3600; // 1-hour buckets
      } else {
        stepSeconds = 21600; // 6-hour buckets for very long ranges
      }

      // Ensure maximum 100 buckets to prevent performance issues
      const maxBuckets = 100;
      const calculatedBuckets = Math.ceil(durationSeconds / stepSeconds);
      if (calculatedBuckets > maxBuckets) {
        stepSeconds = Math.ceil(durationSeconds / maxBuckets);
      }
    } else {
      switch (range) {
        case 'hour':
          stepSeconds = 60;
          break;
        case 'day':
          stepSeconds = 60 * 60;
          break;
        case 'week':
        case 'month':
          stepSeconds = 60 * 60 * 24;
          break;
      }
    }

    const db = usageStorage.getDb();
    const schema = getSchema();
    const dialect = getCurrentDialect();
    const stepMs = stepSeconds * 1000;
    const nowMs = now.getTime();
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();
    const statsStartMs = statsStart.getTime();
    const todayStartMs = todayStart.getTime();

    const stepMsLiteral = sql.raw(String(stepMs));
    const bucketStartMs =
      dialect === 'sqlite'
        ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
        : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

    const toNumber = (value: unknown) =>
      value === null || value === undefined ? 0 : Number(value);

    // Scope by the limited user's key if applicable.
    const summaryScopeKey = scopedKeyName(request);
    const keyFilter = summaryScopeKey ? eq(schema.requestUsage.apiKey, summaryScopeKey) : undefined;

    try {
      const seriesRows = await db
        .select({
          bucketStartMs,
          requests: sql<number>`COUNT(*)`,
          inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            gte(schema.requestUsage.startTime, rangeStartMs),
            lte(schema.requestUsage.startTime, rangeEndMs),
            ...(keyFilter ? [keyFilter] : [])
          )
        )
        .groupBy(bucketStartMs)
        .orderBy(bucketStartMs);

      const statsRows = await db
        .select({
          requests: sql<number>`COUNT(*)`,
          inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          avgDurationMs: sql<number>`COALESCE(AVG(${schema.requestUsage.durationMs}), 0)`,
          totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            gte(schema.requestUsage.startTime, statsStartMs),
            lte(schema.requestUsage.startTime, nowMs),
            ...(keyFilter ? [keyFilter] : []),
            gte(schema.requestUsage.startTime, rangeStartMs),
            lte(schema.requestUsage.startTime, rangeEndMs)
          )
        );

      const todayRows = await db
        .select({
          requests: sql<number>`COUNT(*)`,
          inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
          cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            gte(schema.requestUsage.startTime, todayStartMs),
            lte(schema.requestUsage.startTime, nowMs),
            ...(keyFilter ? [keyFilter] : [])
          )
        );

      const statsRow = statsRows[0] || {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        kwhUsed: 0,
        avgDurationMs: 0,
        totalDurationMs: 0,
      };

      const todayRow = todayRows[0] || {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        kwhUsed: 0,
        totalCost: 0,
      };

      return reply.send({
        range,
        series: seriesRows.map((row: any) => ({
          bucketStartMs: toNumber(row.bucketStartMs),
          requests: toNumber(row.requests),
          inputTokens: toNumber(row.inputTokens),
          outputTokens: toNumber(row.outputTokens),
          cachedTokens: toNumber(row.cachedTokens),
          cacheWriteTokens: toNumber(row.cacheWriteTokens),
          kwhUsed: toNumber(row.kwhUsed),
          tokens:
            toNumber(row.inputTokens) +
            toNumber(row.outputTokens) +
            toNumber(row.cachedTokens) +
            toNumber(row.cacheWriteTokens),
        })),
        stats: {
          totalRequests: toNumber(statsRow.requests),
          totalTokens:
            toNumber(statsRow.inputTokens) +
            toNumber(statsRow.outputTokens) +
            toNumber(statsRow.cachedTokens) +
            toNumber(statsRow.cacheWriteTokens),
          totalKwhUsed: toNumber(statsRow.kwhUsed),
          avgDurationMs: toNumber(statsRow.avgDurationMs),
          totalDurationMs: toNumber(statsRow.totalDurationMs),
        },
        today: {
          requests: toNumber(todayRow.requests),
          inputTokens: toNumber(todayRow.inputTokens),
          outputTokens: toNumber(todayRow.outputTokens),
          reasoningTokens: toNumber(todayRow.reasoningTokens),
          cachedTokens: toNumber(todayRow.cachedTokens),
          cacheWriteTokens: toNumber(todayRow.cacheWriteTokens),
          kwhUsed: toNumber(todayRow.kwhUsed),
          totalCost: toNumber(todayRow.totalCost),
        },
      });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.delete('/v0/management/usage', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({
        error: { message: 'Admin privileges required', type: 'forbidden', code: 403 },
      });
    }
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
    if (!success) return reply.code(500).send({ error: 'Failed to delete usage logs' });
    return reply.send({ success: true });
  });

  fastify.delete('/v0/management/usage/:requestId', async (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({
        error: { message: 'Admin privileges required', type: 'forbidden', code: 403 },
      });
    }
    const params = request.params as any;
    const requestId = params.requestId;
    const success = await usageStorage.deleteUsageLog(requestId);
    if (!success)
      return reply.code(404).send({ error: 'Usage log not found or could not be deleted' });
    return reply.send({ success: true });
  });

  fastify.get('/v0/management/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Limited users must only observe activity for their own key. Admins
    // (scopeKey === null) continue to receive every event.
    const scopeKey = scopedKeyName(request);

    // Helper to send events to the client
    const sendEvent = (eventType: string, record: any) => {
      if (reply.raw.destroyed) return;
      if (scopeKey && record?.apiKey !== scopeKey) return;
      reply.raw.write(
        encode({
          data: JSON.stringify(record),
          event: eventType,
          id: String(Date.now()),
        })
      );
    };

    // Listen for all event types: started, updated, and completed
    const startedListener = (record: any) => sendEvent('started', record);
    const updatedListener = (record: any) => sendEvent('updated', record);
    const completedListener = (record: any) => sendEvent('completed', record);

    usageStorage.on('started', startedListener);
    usageStorage.on('updated', updatedListener);
    usageStorage.on('completed', completedListener);
    // Also listen for 'created' for backward compatibility
    usageStorage.on('created', completedListener);

    // Periodic progress updates for in-flight requests (every 1s, fire-and-forget)
    const progressInterval = setInterval(() => {
      if (reply.raw.destroyed) return;
      const updates = usageStorage.getProgressUpdates();
      for (const update of updates) {
        if (scopeKey && update.apiKey !== scopeKey) continue;
        try {
          reply.raw.write(
            encode({
              data: JSON.stringify(update),
              event: 'progress',
              id: String(Date.now()),
            })
          );
        } catch {
          // Fire-and-forget: ignore write errors
        }
      }
    }, 1000);
    progressInterval.unref?.();

    // Cleanup on server shutdown (closeAllConnections destroys sockets → 'close' fires)
    // and as a fallback for other disconnect scenarios.
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(progressInterval);
      usageStorage.off('started', startedListener);
      usageStorage.off('updated', updatedListener);
      usageStorage.off('completed', completedListener);
      usageStorage.off('created', completedListener);
    };

    reply.raw.on('close', cleanup);

    // Keep connection alive with periodic pings
    while (!reply.raw.destroyed) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      if (!reply.raw.destroyed) {
        reply.raw.write(
          encode({
            event: 'ping',
            data: 'pong',
            id: String(Date.now()),
          })
        );
      }
    }

    // Cleanup: socket destroyed (client disconnect or server shutdown)
    cleanup();
  });
}
