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
        series: seriesRows.map((row) => ({
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

    request.raw.on('close', () => {
      usageStorage.off('started', startedListener);
      usageStorage.off('updated', updatedListener);
      usageStorage.off('completed', completedListener);
      usageStorage.off('created', completedListener);
    });

    // Keep connection alive with periodic pings
    while (!request.raw.destroyed) {
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
  });

  /**
   * GET /v0/management/concurrency
   *
   * Dual-mode concurrency endpoint:
   *   - mode=live (default): Returns currently in-flight requests (durationMs IS NULL)
   *     for the Live Metrics dashboard card.
   *   - mode=timeline: Returns bucketed historical counts for Usage Analytics charts.
   *
   * Query parameters:
   *   - mode: 'live' | 'timeline' (default: 'live')
   *   - timeRange: 'hour' | 'day' | 'week' | 'month' (default: 'hour', timeline mode only)
   *   - groupBy: 'provider' | 'model' (default: 'provider', timeline mode only)
   */
  fastify.get('/v0/management/concurrency', async (request, reply) => {
    const query = request.query as any;
    const mode = query.mode || 'live';

    try {
      const db = usageStorage.getDb();
      const schema = getSchema();
      const dialect = getCurrentDialect();

      if (mode === 'timeline') {
        // Timeline mode: bucketed request counts over time for Usage Analytics charts
        const timeRange = query.timeRange || 'hour';
        const groupBy = query.groupBy || 'provider'; // 'provider' or 'model'
        const startDateStr = query.startDate;
        const endDateStr = query.endDate;
        const now = Date.now();

        let startTime: number;
        let endTime: number = now;

        if (timeRange === 'custom' && startDateStr && endDateStr) {
          const startDate = new Date(startDateStr);
          const endDate = new Date(endDateStr);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            startTime = startDate.getTime();
            endTime = endDate.getTime();
          } else {
            return reply.code(400).send({ error: 'Invalid date format' });
          }
        } else {
          const ranges: Record<string, number> = {
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
          };
          const windowMs = ranges[timeRange] ?? ranges.hour ?? 60 * 60 * 1000;
          startTime = now - windowMs;
        }

        // Adaptive bucketing based on duration (prevent millions of rows for long ranges)
        const durationMs = endTime - startTime;
        const durationMinutes = durationMs / (1000 * 60);

        // Use same adaptive thresholds as summary endpoint
        const useMinuteBuckets = durationMinutes <= 30;
        const use5MinuteBuckets = durationMinutes <= 24 * 60;
        const useHourlyBuckets = durationMinutes <= 7 * 24 * 60;

        let bucketSizeMs: number;
        if (useMinuteBuckets) {
          bucketSizeMs = 60000; // 1 minute
        } else if (use5MinuteBuckets) {
          bucketSizeMs = 300000; // 5 minutes
        } else if (useHourlyBuckets) {
          bucketSizeMs = 3600000; // 1 hour
        } else {
          bucketSizeMs = 21600000; // 6 hours
        }

        // Ensure maximum 100 buckets
        const maxBuckets = 100;
        const calculatedBuckets = Math.ceil(durationMs / bucketSizeMs);
        if (calculatedBuckets > maxBuckets) {
          bucketSizeMs = Math.ceil(durationMs / maxBuckets);
        }

        const bucketSizeMsLiteral = sql.raw(String(bucketSizeMs));
        const bucketSql =
          dialect === 'sqlite'
            ? sql<number>`(CAST(${schema.requestUsage.startTime} AS INTEGER) / ${bucketSizeMsLiteral}) * ${bucketSizeMsLiteral}`
            : sql<number>`(FLOOR(${schema.requestUsage.startTime}::double precision / ${bucketSizeMsLiteral}) * ${bucketSizeMsLiteral})`;

        // Group by either provider or model (not both) to prevent Cartesian explosion
        const groupField =
          groupBy === 'model'
            ? schema.requestUsage.canonicalModelName
            : schema.requestUsage.provider;

        const timelineScopeKey = scopedKeyName(request);
        const results = await db
          .select({
            timestamp: bucketSql,
            key: groupField,
            count: sql<number>`count(*)`,
          })
          .from(schema.requestUsage)
          .where(
            and(
              isNotNull(groupField),
              gte(schema.requestUsage.startTime, startTime),
              lte(schema.requestUsage.startTime, endTime),
              ...(timelineScopeKey ? [eq(schema.requestUsage.apiKey, timelineScopeKey)] : [])
            )
          )
          .groupBy(groupField, bucketSql)
          .orderBy(bucketSql);

        // Map 'key' back to 'provider' or 'model' for frontend compatibility
        const mappedResults = results.map((row) => ({
          timestamp: row.timestamp,
          [groupBy]: row.key,
          count: row.count,
        }));

        return reply.send({ data: mappedResults });
      }

      // Live mode (default): currently in-flight requests for Live Metrics card
      const liveNow = Date.now();
      const liveScopeKey = scopedKeyName(request);
      const results = await db
        .select({
          provider: schema.requestUsage.provider,
          model: schema.requestUsage.canonicalModelName,
          count: sql<number>`COALESCE(count(*), 0)`,
          timestamp: sql<number>`${liveNow}`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            isNull(schema.requestUsage.durationMs),
            isNotNull(schema.requestUsage.provider),
            gte(schema.requestUsage.startTime, liveNow - 60 * 60 * 1000),
            ...(liveScopeKey ? [eq(schema.requestUsage.apiKey, liveScopeKey)] : [])
          )
        )
        .groupBy(schema.requestUsage.provider, schema.requestUsage.canonicalModelName);

      return reply.send({ data: results });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
