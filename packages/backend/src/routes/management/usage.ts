import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { and, eq, gte, lte, sql, isNull, isNotNull } from 'drizzle-orm';
import { getCurrentDialect, getSchema } from '../../db/client';
import {
  UsageStorageService,
  type UsageSortDirection,
  type UsageSortField,
} from '../../services/observability/usage-storage';
import { isLimited, scopedKeyName } from './_principal';
import { logger } from '../../utils/logger';

const USAGE_FIELDS = new Set([
  'requestId',
  'clientRequestId',
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
  'reasoningEffort',
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

type UsageStreamEventName = 'started' | 'updated' | 'completed' | 'created';

type UsageStreamClient = {
  scopeKey: string | null;
  send: (eventType: UsageStreamEventName, record: any) => void;
};

const SUMMARY_CACHE_TTL_MS = 10_000;
const HISTORICAL_SUMMARY_CACHE_TTL_MS = 60_000;
const MAX_CUSTOM_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_BREAKDOWN_DIMENSIONS = 3;
const DEFAULT_BREAKDOWN_LIMIT = 10;
const MAX_BREAKDOWN_LIMIT = 50;
const MAX_SUMMARY_RESPONSE_BYTES = 128 * 1024;
const MAX_BASIC_SUMMARY_RESPONSE_BYTES = 16 * 1024;
const MAX_SUMMARY_CACHE_ENTRIES = 100;

const BREAKDOWN_DIMENSIONS = ['provider', 'modelAlias', 'apiKey', 'status'] as const;
type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
const SUMMARY_EXCLUSIONS = ['directModels', 'probe'] as const;
type SummaryExclusion = (typeof SUMMARY_EXCLUSIONS)[number];

type SummaryAggregate = {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  avgDurationMs: number;
  totalDurationMs: number;
  totalTtftMs: number;
  totalTokensPerSec: number;
  avgTtftMs: number;
  avgTokensPerSec: number;
};

type SummaryGroup = {
  name: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  avgDurationMs: number;
  totalDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSec: number;
  successRate: number;
};

type SummaryResponse = {
  range: string;
  series: Array<{
    bucketStartMs: number;
    requests: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    tokens: number;
    totalCost: number;
    avgDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
  }>;
  stats: {
    totalRequests: number;
    totalErrors: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    totalCost: number;
    avgDurationMs: number;
    totalDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
    successRate: number;
  };
  today: Record<string, number>;
  grouped?: Partial<
    Record<
      BreakdownDimension,
      {
        items: SummaryGroup[];
        totalDimensions: number;
        truncated: boolean;
      }
    >
  >;
};

class SummaryResponseTooLargeError extends Error {}

const toNumber = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const toSummaryAggregate = (row: any): SummaryAggregate => {
  const inputTokens = toNumber(row.inputTokens);
  const outputTokens = toNumber(row.outputTokens);
  const reasoningTokens = toNumber(row.reasoningTokens);
  const cachedTokens = toNumber(row.cachedTokens);
  const cacheWriteTokens = toNumber(row.cacheWriteTokens);

  return {
    requests: toNumber(row.requests),
    errors: toNumber(row.errors),
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens + cachedTokens + cacheWriteTokens,
    totalCost: toNumber(row.totalCost),
    avgDurationMs: toNumber(row.avgDurationMs),
    totalDurationMs: toNumber(row.totalDurationMs),
    totalTtftMs: toNumber(row.totalTtftMs),
    totalTokensPerSec: toNumber(row.totalTokensPerSec),
    avgTtftMs: toNumber(row.avgTtftMs),
    avgTokensPerSec: toNumber(row.avgTokensPerSec),
  };
};

const withSuccessRate = <T extends SummaryAggregate>(aggregate: T) => ({
  ...aggregate,
  successRate:
    aggregate.requests > 0
      ? ((aggregate.requests - aggregate.errors) / aggregate.requests) * 100
      : 0,
});

const toSummaryGroup = (name: string, aggregate: SummaryAggregate): SummaryGroup => ({
  name,
  requests: aggregate.requests,
  errors: aggregate.errors,
  inputTokens: aggregate.inputTokens,
  outputTokens: aggregate.outputTokens,
  reasoningTokens: aggregate.reasoningTokens,
  cachedTokens: aggregate.cachedTokens,
  cacheWriteTokens: aggregate.cacheWriteTokens,
  totalTokens: aggregate.totalTokens,
  totalCost: aggregate.totalCost,
  avgDurationMs: aggregate.avgDurationMs,
  totalDurationMs: aggregate.totalDurationMs,
  avgTtftMs: aggregate.avgTtftMs,
  avgTokensPerSec: aggregate.avgTokensPerSec,
  successRate:
    aggregate.requests > 0
      ? ((aggregate.requests - aggregate.errors) / aggregate.requests) * 100
      : 0,
});

const subtractAggregates = (
  total: SummaryAggregate,
  included: SummaryAggregate
): SummaryAggregate => ({
  requests: Math.max(0, total.requests - included.requests),
  errors: Math.max(0, total.errors - included.errors),
  inputTokens: Math.max(0, total.inputTokens - included.inputTokens),
  outputTokens: Math.max(0, total.outputTokens - included.outputTokens),
  reasoningTokens: Math.max(0, total.reasoningTokens - included.reasoningTokens),
  cachedTokens: Math.max(0, total.cachedTokens - included.cachedTokens),
  cacheWriteTokens: Math.max(0, total.cacheWriteTokens - included.cacheWriteTokens),
  totalTokens: Math.max(0, total.totalTokens - included.totalTokens),
  totalCost: Math.max(0, total.totalCost - included.totalCost),
  avgDurationMs:
    total.requests > included.requests
      ? Math.max(0, total.totalDurationMs - included.totalDurationMs) /
        (total.requests - included.requests)
      : 0,
  totalDurationMs: Math.max(0, total.totalDurationMs - included.totalDurationMs),
  totalTtftMs: Math.max(0, total.totalTtftMs - included.totalTtftMs),
  totalTokensPerSec: Math.max(0, total.totalTokensPerSec - included.totalTokensPerSec),
  avgTtftMs:
    total.requests > included.requests
      ? Math.max(0, total.totalTtftMs - included.totalTtftMs) / (total.requests - included.requests)
      : 0,
  avgTokensPerSec:
    total.requests > included.requests
      ? Math.max(0, total.totalTokensPerSec - included.totalTokensPerSec) /
        (total.requests - included.requests)
      : 0,
});

export class UsageEventsBroadcaster {
  private readonly clients = new Set<UsageStreamClient>();
  private listening = false;
  private readonly startedListener = (record: any) => this.broadcast('started', record);
  private readonly updatedListener = (record: any) => this.broadcast('updated', record);
  private readonly completedListener = (record: any) => this.broadcast('completed', record);
  private readonly createdListener = (record: any) => this.broadcast('completed', record);

  constructor(readonly usageStorage: UsageStorageService) {}

  subscribe(client: UsageStreamClient): () => void {
    // Attach storage listeners lazily so constructing the broadcaster has no
    // side effects until the first SSE client connects.
    if (!this.listening) {
      this.listening = true;
      this.usageStorage.on('started', this.startedListener);
      this.usageStorage.on('updated', this.updatedListener);
      this.usageStorage.on('completed', this.completedListener);
      // Also listen for 'created' for backward compatibility
      this.usageStorage.on('created', this.createdListener);
    }

    this.clients.add(client);

    return () => {
      this.clients.delete(client);
    };
  }

  dispose(): void {
    if (this.listening) {
      this.listening = false;
      this.usageStorage.off('started', this.startedListener);
      this.usageStorage.off('updated', this.updatedListener);
      this.usageStorage.off('completed', this.completedListener);
      this.usageStorage.off('created', this.createdListener);
    }
    this.clients.clear();
  }

  private broadcast(eventType: UsageStreamEventName, record: any): void {
    for (const client of this.clients) {
      if (client.scopeKey && record?.apiKey !== client.scopeKey) continue;
      client.send(eventType, record);
    }
  }
}

export async function registerUsageRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  const usageEventsBroadcaster = new UsageEventsBroadcaster(usageStorage);

  fastify.addHook('onClose', async () => {
    usageEventsBroadcaster.dispose();
  });

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
      requestId: query.requestId,
      clientRequestId: query.clientRequestId,
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
        return reply.send({ ...result, limit, offset });
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
        limit,
        offset,
      });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  const summaryCache = new Map<string, { expiresAt: number; promise: Promise<SummaryResponse> }>();

  fastify.get('/v0/management/usage/summary', async (request, reply) => {
    const requestStartedAt = performance.now();
    const query = request.query as any;
    const range = query.range || 'day';
    const startDateStr = query.startDate;
    const endDateStr = query.endDate;

    if (range === 'custom') {
      if (!startDateStr || !endDateStr) {
        return reply
          .code(400)
          .send({ error: 'startDate and endDate are required for custom range' });
      }
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid date format' });
      }
      if (endDate < startDate) {
        return reply.code(400).send({ error: 'endDate must be after startDate' });
      }
    } else if (!['hour', 'day', 'week', 'month'].includes(range)) {
      return reply.code(400).send({ error: 'Invalid range' });
    }

    const requestedBreakdowns = String(query.breakdowns || '')
      .split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);
    const breakdowns = Array.from(new Set(requestedBreakdowns)) as BreakdownDimension[];
    const invalidBreakdown = breakdowns.find((value) => !BREAKDOWN_DIMENSIONS.includes(value));
    if (invalidBreakdown) {
      return reply.code(400).send({ error: `Unsupported breakdown: ${invalidBreakdown}` });
    }
    if (breakdowns.length > MAX_BREAKDOWN_DIMENSIONS) {
      return reply
        .code(400)
        .send({ error: `At most ${MAX_BREAKDOWN_DIMENSIONS} breakdowns are supported` });
    }

    const requestedExclusions = String(query.exclude || '')
      .split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);
    const exclusions = Array.from(new Set(requestedExclusions)) as SummaryExclusion[];
    const invalidExclusion = exclusions.find((value) => !SUMMARY_EXCLUSIONS.includes(value));
    if (invalidExclusion) {
      return reply.code(400).send({ error: `Unsupported exclusion: ${invalidExclusion}` });
    }

    const parsedLimit =
      query.breakdownLimit === undefined ? DEFAULT_BREAKDOWN_LIMIT : Number(query.breakdownLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_BREAKDOWN_LIMIT) {
      return reply.code(400).send({
        error: `breakdownLimit must be an integer between 1 and ${MAX_BREAKDOWN_LIMIT}`,
      });
    }

    const currentTime = new Date();
    const now = new Date(currentTime);
    now.setSeconds(0, 0);
    let rangeStart = new Date(now);
    let rangeEnd = new Date(now);

    if (range === 'custom') {
      rangeStart = new Date(startDateStr);
      rangeEnd = new Date(endDateStr);
      if (rangeEnd > currentTime) {
        return reply.code(400).send({ error: 'endDate cannot be in the future' });
      }
      if (rangeEnd.getTime() - rangeStart.getTime() > MAX_CUSTOM_RANGE_MS) {
        return reply.code(400).send({ error: 'custom range cannot exceed 12 months' });
      }
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

    const normalizedBreakdowns = BREAKDOWN_DIMENSIONS.filter((value) => breakdowns.includes(value));
    const principalKey = scopedKeyName(request);
    const scopeKey = principalKey ? `limited:${principalKey}` : 'admin';
    const cacheKey = JSON.stringify({
      scopeKey,
      range,
      startDate: rangeStart.toISOString(),
      endDate: rangeEnd.toISOString(),
      breakdowns: normalizedBreakdowns,
      exclusions: SUMMARY_EXCLUSIONS.filter((value) => exclusions.includes(value)),
      breakdownLimit: parsedLimit,
    });
    const cached = summaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      reply.header('X-Usage-Summary-Cache', 'HIT');
      logger.debug('Usage summary cache hit', {
        range,
        breakdownCount: normalizedBreakdowns.length,
        durationMs: Math.round(performance.now() - requestStartedAt),
      });
      try {
        return reply.send(await cached.promise);
      } catch (e: any) {
        if (e instanceof SummaryResponseTooLargeError) {
          return reply.code(413).send({ error: e.message });
        }
        return reply.code(500).send({ error: e.message });
      }
    }

    const summaryPromise = (async (): Promise<SummaryResponse> => {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      let stepSeconds = 60;
      if (range === 'custom') {
        const durationMs = rangeEnd.getTime() - rangeStart.getTime();
        const durationMinutes = durationMs / (1000 * 60);
        const durationSeconds = durationMs / 1000;
        if (durationMinutes <= 30) stepSeconds = 60;
        else if (durationMinutes <= 24 * 60) stepSeconds = 300;
        else if (durationMinutes <= 7 * 24 * 60) stepSeconds = 3600;
        else stepSeconds = 21600;
        if (Math.ceil(durationSeconds / stepSeconds) > 100) {
          stepSeconds = Math.ceil(durationSeconds / 100);
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
      const todayStartMs = todayStart.getTime();
      const stepMsLiteral = sql.raw(String(stepMs));
      const bucketStartMs =
        dialect === 'sqlite'
          ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
          : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;
      const keyFilter = principalKey ? eq(schema.requestUsage.apiKey, principalKey) : undefined;
      const rangeFilter = [
        gte(schema.requestUsage.startTime, rangeStartMs),
        lte(schema.requestUsage.startTime, rangeEndMs),
        ...(keyFilter ? [keyFilter] : []),
      ];
      const aggregateSelection = {
        requests: sql<number>`COUNT(*)`,
        errors: sql<number>`COALESCE(SUM(CASE WHEN ${schema.requestUsage.responseStatus} IS NULL OR ${schema.requestUsage.responseStatus} != 'success' THEN 1 ELSE 0 END), 0)`,
        inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
        outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
        reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
        cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
        cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
        avgDurationMs: sql<number>`COALESCE(SUM(COALESCE(${schema.requestUsage.durationMs}, 0)) * 1.0 / NULLIF(COUNT(*), 0), 0)`,
        totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
        totalTtftMs: sql<number>`COALESCE(SUM(COALESCE(${schema.requestUsage.ttftMs}, 0)), 0)`,
        totalTokensPerSec: sql<number>`COALESCE(SUM(COALESCE(${schema.requestUsage.tokensPerSec}, 0)), 0)`,
        avgTtftMs: sql<number>`COALESCE(SUM(COALESCE(${schema.requestUsage.ttftMs}, 0)) * 1.0 / NULLIF(COUNT(*), 0), 0)`,
        avgTokensPerSec: sql<number>`COALESCE(SUM(COALESCE(${schema.requestUsage.tokensPerSec}, 0)) * 1.0 / NULLIF(COUNT(*), 0), 0)`,
      };
      const getBreakdownFilter = (dimension: BreakdownDimension) => {
        const conditions = [...rangeFilter];
        if (dimension === 'modelAlias' && exclusions.includes('directModels')) {
          conditions.push(
            sql`(${schema.requestUsage.incomingModelAlias} IS NULL OR ${schema.requestUsage.incomingModelAlias} NOT LIKE 'direct/%')`
          );
        }
        if (dimension === 'apiKey' && exclusions.includes('probe')) {
          conditions.push(
            sql`(${schema.requestUsage.apiKey} IS NULL OR ${schema.requestUsage.apiKey} != 'probe')`
          );
        }
        return conditions;
      };

      const queryStartedAt = performance.now();
      const seriesRows = await db
        .select({ bucketStartMs, ...aggregateSelection })
        .from(schema.requestUsage)
        .where(and(...rangeFilter))
        .groupBy(bucketStartMs)
        .orderBy(bucketStartMs);
      const statsRows = await db
        .select(aggregateSelection)
        .from(schema.requestUsage)
        .where(and(...rangeFilter));
      const todayRows = await db
        .select({
          requests: sql<number>`COUNT(*)`,
          inputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          outputTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          reasoningTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
          cachedTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          cacheWriteTokens: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
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

      const stats = withSuccessRate(toSummaryAggregate(statsRows[0] || {}));
      const grouped: SummaryResponse['grouped'] = {};
      for (const dimension of normalizedBreakdowns) {
        const groupField =
          dimension === 'provider'
            ? sql`COALESCE(${schema.requestUsage.provider}, 'unknown')`
            : dimension === 'modelAlias'
              ? sql`COALESCE(${schema.requestUsage.incomingModelAlias}, ${schema.requestUsage.selectedModelName}, 'unknown')`
              : dimension === 'status'
                ? sql`COALESCE(${schema.requestUsage.responseStatus}, 'unknown')`
                : schema.requestUsage.apiKey;
        const groupRows = await db
          .select({
            key: groupField,
            totalDimensions: sql<number>`COUNT(*) OVER ()`,
            ...aggregateSelection,
          })
          .from(schema.requestUsage)
          .where(and(...getBreakdownFilter(dimension)))
          .groupBy(groupField)
          .orderBy(sql`COUNT(*) DESC`, groupField)
          .limit(parsedLimit);
        const topItems = groupRows.map((row: any) => {
          const name =
            dimension === 'apiKey'
              ? row.key === 'probe'
                ? 'probe'
                : row.key
                  ? String(row.key).length > 8
                    ? `${String(row.key).slice(0, 8)}...`
                    : String(row.key)
                  : 'unknown'
              : String(row.key ?? 'unknown');
          return toSummaryGroup(name, toSummaryAggregate(row));
        });
        const included = groupRows.reduce((aggregate: SummaryAggregate, row: any) => {
          const current = toSummaryAggregate(row);
          return {
            ...aggregate,
            requests: aggregate.requests + current.requests,
            errors: aggregate.errors + current.errors,
            inputTokens: aggregate.inputTokens + current.inputTokens,
            outputTokens: aggregate.outputTokens + current.outputTokens,
            reasoningTokens: aggregate.reasoningTokens + current.reasoningTokens,
            cachedTokens: aggregate.cachedTokens + current.cachedTokens,
            cacheWriteTokens: aggregate.cacheWriteTokens + current.cacheWriteTokens,
            totalTokens: aggregate.totalTokens + current.totalTokens,
            totalCost: aggregate.totalCost + current.totalCost,
            totalDurationMs: aggregate.totalDurationMs + current.totalDurationMs,
            totalTtftMs: aggregate.totalTtftMs + current.totalTtftMs,
            totalTokensPerSec: aggregate.totalTokensPerSec + current.totalTokensPerSec,
            avgDurationMs: 0,
            avgTtftMs: 0,
            avgTokensPerSec: 0,
          };
        }, toSummaryAggregate({}));
        const groupedTotalRows = await db
          .select(aggregateSelection)
          .from(schema.requestUsage)
          .where(and(...getBreakdownFilter(dimension)));
        const groupedTotal = toSummaryAggregate(groupedTotalRows[0] || {});
        const totalDimensions = toNumber(groupRows[0]?.totalDimensions);
        if (totalDimensions > topItems.length) {
          topItems.push(toSummaryGroup('Other', subtractAggregates(groupedTotal, included)));
        }
        grouped[dimension] = {
          items: topItems,
          totalDimensions,
          truncated: totalDimensions > parsedLimit,
        };
      }

      const response: SummaryResponse = {
        range,
        series: seriesRows.map((row: any) => {
          const aggregate = toSummaryAggregate(row);
          return {
            bucketStartMs: toNumber(row.bucketStartMs),
            requests: aggregate.requests,
            errors: aggregate.errors,
            inputTokens: aggregate.inputTokens,
            outputTokens: aggregate.outputTokens,
            reasoningTokens: aggregate.reasoningTokens,
            cachedTokens: aggregate.cachedTokens,
            cacheWriteTokens: aggregate.cacheWriteTokens,
            tokens: aggregate.totalTokens,
            totalCost: aggregate.totalCost,
            avgDurationMs: aggregate.avgDurationMs,
            avgTtftMs: aggregate.avgTtftMs,
            avgTokensPerSec: aggregate.avgTokensPerSec,
          };
        }),
        stats: {
          totalRequests: stats.requests,
          totalErrors: stats.errors,
          totalTokens: stats.totalTokens,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          reasoningTokens: stats.reasoningTokens,
          cachedTokens: stats.cachedTokens,
          cacheWriteTokens: stats.cacheWriteTokens,
          totalCost: stats.totalCost,
          avgDurationMs: stats.avgDurationMs,
          totalDurationMs: stats.totalDurationMs,
          avgTtftMs: stats.avgTtftMs,
          avgTokensPerSec: stats.avgTokensPerSec,
          successRate: stats.successRate,
        },
        today: {
          requests: toNumber(todayRows[0]?.requests),
          inputTokens: toNumber(todayRows[0]?.inputTokens),
          outputTokens: toNumber(todayRows[0]?.outputTokens),
          reasoningTokens: toNumber(todayRows[0]?.reasoningTokens),
          cachedTokens: toNumber(todayRows[0]?.cachedTokens),
          cacheWriteTokens: toNumber(todayRows[0]?.cacheWriteTokens),
          totalCost: toNumber(todayRows[0]?.totalCost),
        },
      };
      if (normalizedBreakdowns.length > 0) response.grouped = grouped;
      const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
      const responseLimit =
        normalizedBreakdowns.length > 0
          ? MAX_SUMMARY_RESPONSE_BYTES
          : MAX_BASIC_SUMMARY_RESPONSE_BYTES;
      if (responseBytes > responseLimit) {
        throw new SummaryResponseTooLargeError(
          `Usage summary response exceeds the ${responseLimit} byte size limit`
        );
      }
      logger.debug('Usage summary generated', {
        range,
        breakdownCount: normalizedBreakdowns.length,
        bucketCount: response.series.length,
        groupCount: Object.values(response.grouped ?? {}).reduce(
          (count, breakdown) => count + (breakdown?.items.length ?? 0),
          0
        ),
        cache: 'MISS',
        responseBytes,
        durationMs: Math.round(performance.now() - requestStartedAt),
        queryDurationMs: Math.round(performance.now() - queryStartedAt),
        dialect,
      });
      return response;
    })();

    for (const [key, entry] of summaryCache) {
      if (entry.expiresAt <= Date.now()) summaryCache.delete(key);
    }
    while (summaryCache.size >= MAX_SUMMARY_CACHE_ENTRIES) {
      const oldestKey = summaryCache.keys().next().value;
      if (oldestKey === undefined) break;
      summaryCache.delete(oldestKey);
    }
    summaryCache.set(cacheKey, {
      expiresAt:
        Date.now() +
        (range === 'custom' && rangeEnd.getTime() < now.getTime() - 5 * 60 * 1000
          ? HISTORICAL_SUMMARY_CACHE_TTL_MS
          : SUMMARY_CACHE_TTL_MS),
      promise: summaryPromise,
    });
    summaryPromise.catch(() => summaryCache.delete(cacheKey));

    try {
      const response = await summaryPromise;
      reply.header('X-Usage-Summary-Cache', 'MISS');
      return reply.send(response);
    } catch (e: any) {
      if (e instanceof SummaryResponseTooLargeError) {
        return reply.code(413).send({ error: e.message });
      }
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
    const sendEvent = (eventType: UsageStreamEventName, record: any) => {
      if (reply.raw.destroyed) return;
      if (scopeKey && record?.apiKey !== scopeKey) return;
      try {
        reply.raw.write(
          encode({
            data: JSON.stringify(record),
            event: eventType,
            id: String(Date.now()),
          })
        );
      } catch {
        // Fire-and-forget: ignore write errors
      }
    };

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
    const unsubscribe = usageEventsBroadcaster.subscribe({
      scopeKey,
      send: sendEvent,
    });
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(progressInterval);
      unsubscribe();
    };

    reply.raw.once('close', cleanup);
    reply.raw.once('error', cleanup);

    try {
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
    } finally {
      // Cleanup: socket destroyed (client disconnect or server shutdown)
      cleanup();
    }
  });
}
