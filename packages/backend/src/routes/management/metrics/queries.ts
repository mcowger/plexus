/**
 * Database queries for metrics module using Drizzle ORM
 */

import { and, gte, lte, sql, count, sum, avg, desc, or, gt, eq } from 'drizzle-orm';
import { getCurrentDialect, getSchema } from '../../../db/client';
import { UsageStorageService } from '../../../services/usage-storage';
import { GroupBy, TimeRange } from './types';
import { getTimeRangeBounds } from './time';

function knownProviderOnly(providerColumn: unknown) {
    return sql`${providerColumn} IS NOT NULL AND TRIM(${providerColumn}) != '' AND LOWER(TRIM(${providerColumn})) != 'unknown'`;
}

export interface ChartDataRow {
    bucketStartMs: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cost: number;
    durationSum: number;
    durationCount: number;
    ttftSum: number;
    ttftCount: number;
}

export interface AggregatedRow {
    groupKey: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cost: number;
    durationSum: number;
    durationCount: number;
    ttftSum: number;
    ttftCount: number;
}

export interface StatsRow {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cost: number;
    durationSum: number;
    durationCount: number;
    successCount: number;
}

export interface LiveRequestRecord {
    requestId: string | null;
    date: string | null;
    provider: string | null;
    incomingModelAlias: string | null;
    selectedModelName: string | null;
    responseStatus: string | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensReasoning: number | null;
    tokensCached: number | null;
    costTotal: number | null;
    durationMs: number | null;
    ttftMs: number | null;
    tokensPerSec: number | null;
}

export interface ProviderPerformanceRecord {
    provider: string | null;
    incomingModelAlias: string | null;
    selectedModelName: string | null;
    ttftMs: number | null;
    tokensPerSec: number | null;
}

export async function fetchChartData(
    usageStorage: UsageStorageService,
    timeRange: TimeRange,
    granularity: 'minute' | 'hour' | 'day'
): Promise<ChartDataRow[]> {
    const { startTime, endTime } = getTimeRangeBounds(timeRange);
    const db = usageStorage.getDb();
    const schema = getSchema();
    const dialect = getCurrentDialect();

    const stepMs = granularity === 'minute' ? 60 * 1000 : granularity === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const stepMsLiteral = sql.raw(String(stepMs));

    const bucketSql = dialect === 'sqlite'
        ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
        : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

    const rows = await db
        .select({
            bucketStartMs: bucketSql,
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
            cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
            cost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`,
            durationSum: sql<number>`COALESCE(${sum(schema.requestUsage.durationMs)}, 0)`,
            durationCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.durationMs, 0)} THEN 1 END)`,
            ttftSum: sql<number>`COALESCE(${sum(schema.requestUsage.ttftMs)}, 0)`,
            ttftCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.ttftMs, 0)} THEN 1 END)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime),
            knownProviderOnly(schema.requestUsage.provider)
        ))
        .groupBy(bucketSql)
        .orderBy(bucketSql);

    return rows.map(row => ({
        bucketStartMs: Number(row.bucketStartMs) || 0,
        requests: Number(row.requests) || 0,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        reasoningTokens: Number(row.reasoningTokens) || 0,
        cachedTokens: Number(row.cachedTokens) || 0,
        cost: Number(row.cost) || 0,
        durationSum: Number(row.durationSum) || 0,
        durationCount: Number(row.durationCount) || 0,
        ttftSum: Number(row.ttftSum) || 0,
        ttftCount: Number(row.ttftCount) || 0
    }));
}

export async function fetchAggregatedData(
    usageStorage: UsageStorageService,
    timeRange: TimeRange,
    groupBy: GroupBy
): Promise<AggregatedRow[]> {
    const { startTime, endTime } = getTimeRangeBounds(timeRange);
    const db = usageStorage.getDb();
    const schema = getSchema();

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
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
            cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
            cost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`,
            durationSum: sql<number>`COALESCE(${sum(schema.requestUsage.durationMs)}, 0)`,
            durationCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.durationMs, 0)} THEN 1 END)`,
            ttftSum: sql<number>`COALESCE(${sum(schema.requestUsage.ttftMs)}, 0)`,
            ttftCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.ttftMs, 0)} THEN 1 END)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime),
            knownProviderOnly(schema.requestUsage.provider)
        ))
        .groupBy(groupByColumn)
        .orderBy(desc(count()));

    return rows.map(row => ({
        groupKey: String(row.groupKey || 'unknown'),
        requests: Number(row.requests) || 0,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        reasoningTokens: Number(row.reasoningTokens) || 0,
        cachedTokens: Number(row.cachedTokens) || 0,
        cost: Number(row.cost) || 0,
        durationSum: Number(row.durationSum) || 0,
        durationCount: Number(row.durationCount) || 0,
        ttftSum: Number(row.ttftSum) || 0,
        ttftCount: Number(row.ttftCount) || 0
    }));
}

export async function fetchStats(
    usageStorage: UsageStorageService,
    timeRange: TimeRange
): Promise<StatsRow> {
    const { startTime, endTime } = getTimeRangeBounds(timeRange);
    const db = usageStorage.getDb();
    const schema = getSchema();

    const rows = await db
        .select({
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
            cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
            cost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`,
            durationSum: sql<number>`COALESCE(${sum(schema.requestUsage.durationMs)}, 0)`,
            durationCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.durationMs, 0)} THEN 1 END)`,
            successCount: sql<number>`COUNT(CASE WHEN ${eq(schema.requestUsage.responseStatus, 'success')} THEN 1 END)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime),
            knownProviderOnly(schema.requestUsage.provider)
        ));

    const row = rows[0];
    return {
        requests: Number(row?.requests) || 0,
        inputTokens: Number(row?.inputTokens) || 0,
        outputTokens: Number(row?.outputTokens) || 0,
        reasoningTokens: Number(row?.reasoningTokens) || 0,
        cachedTokens: Number(row?.cachedTokens) || 0,
        cost: Number(row?.cost) || 0,
        durationSum: Number(row?.durationSum) || 0,
        durationCount: Number(row?.durationCount) || 0,
        successCount: Number(row?.successCount) || 0
    };
}

export async function fetchLiveRequests(
    usageStorage: UsageStorageService,
    windowStartMs: number,
    limit: number
): Promise<LiveRequestRecord[]> {
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
            gte(schema.requestUsage.startTime, windowStartMs),
            knownProviderOnly(schema.requestUsage.provider)
        ))
        .orderBy(desc(schema.requestUsage.startTime))
        .limit(limit);

    return rows;
}

export async function fetchDashboardSeries(
    usageStorage: UsageStorageService,
    timeRange: TimeRange,
    startTime: number,
    endTime: number
): Promise<ChartDataRow[]> {
    const db = usageStorage.getDb();
    const schema = getSchema();
    const dialect = getCurrentDialect();

    const stepSeconds = timeRange === 'hour' ? 60 : 60 * 60;
    const stepMs = stepSeconds * 1000;
    const stepMsLiteral = sql.raw(String(stepMs));

    const bucketSql = dialect === 'sqlite'
        ? sql<number>`CAST((CAST(${schema.requestUsage.startTime} AS INTEGER) / ${stepMsLiteral}) * ${stepMsLiteral} AS INTEGER)`
        : sql<number>`FLOOR(${schema.requestUsage.startTime}::double precision / ${stepMsLiteral}) * ${stepMsLiteral}`;

    const rows = await db
        .select({
            bucketStartMs: bucketSql,
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
            cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
            cost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`,
            durationSum: sql<number>`COALESCE(${sum(schema.requestUsage.durationMs)}, 0)`,
            durationCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.durationMs, 0)} THEN 1 END)`,
            ttftSum: sql<number>`COALESCE(${sum(schema.requestUsage.ttftMs)}, 0)`,
            ttftCount: sql<number>`COUNT(CASE WHEN ${gt(schema.requestUsage.ttftMs, 0)} THEN 1 END)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime),
            knownProviderOnly(schema.requestUsage.provider)
        ))
        .groupBy(bucketSql)
        .orderBy(bucketSql);

    return rows.map(row => ({
        bucketStartMs: Number(row.bucketStartMs) || 0,
        requests: Number(row.requests) || 0,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        reasoningTokens: Number(row.reasoningTokens) || 0,
        cachedTokens: Number(row.cachedTokens) || 0,
        cost: Number(row.cost) || 0,
        durationSum: Number(row.durationSum) || 0,
        durationCount: Number(row.durationCount) || 0,
        ttftSum: Number(row.ttftSum) || 0,
        ttftCount: Number(row.ttftCount) || 0
    }));
}

export interface WeeklyStatsRow {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
}

export async function fetchWeeklyStats(
    usageStorage: UsageStorageService,
    startTime: number,
    endTime: number
): Promise<WeeklyStatsRow> {
    const db = usageStorage.getDb();
    const schema = getSchema();

    const rows = await db
        .select({
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            avgDurationMs: sql<number>`COALESCE(${avg(schema.requestUsage.durationMs)}, 0)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime),
            knownProviderOnly(schema.requestUsage.provider)
        ));

    const row = rows[0];
    return {
        requests: Number(row?.requests) || 0,
        inputTokens: Number(row?.inputTokens) || 0,
        outputTokens: Number(row?.outputTokens) || 0,
        avgDurationMs: Number(row?.avgDurationMs) || 0
    };
}

export interface TodayMetricsRow {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalCost: number;
}

export async function fetchTodayMetrics(
    usageStorage: UsageStorageService,
    startOfDay: number
): Promise<TodayMetricsRow> {
    const db = usageStorage.getDb();
    const schema = getSchema();

    const rows = await db
        .select({
            requests: count(),
            inputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensInput)}, 0)`,
            outputTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensOutput)}, 0)`,
            reasoningTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensReasoning)}, 0)`,
            cachedTokens: sql<number>`COALESCE(${sum(schema.requestUsage.tokensCached)}, 0)`,
            totalCost: sql<number>`COALESCE(${sum(schema.requestUsage.costTotal)}, 0)`
        })
        .from(schema.requestUsage)
        .where(and(
            gte(schema.requestUsage.startTime, startOfDay),
            lte(schema.requestUsage.startTime, Date.now()),
            knownProviderOnly(schema.requestUsage.provider)
        ));

    const row = rows[0];
    return {
        requests: Number(row?.requests) || 0,
        inputTokens: Number(row?.inputTokens) || 0,
        outputTokens: Number(row?.outputTokens) || 0,
        reasoningTokens: Number(row?.reasoningTokens) || 0,
        cachedTokens: Number(row?.cachedTokens) || 0,
        totalCost: Number(row?.totalCost) || 0
    };
}

export async function fetchProviderPerformanceRecords(
    usageStorage: UsageStorageService
): Promise<ProviderPerformanceRecord[]> {
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
            knownProviderOnly(schema.requestUsage.provider),
            or(
                gt(schema.requestUsage.ttftMs, 0),
                gt(schema.requestUsage.tokensPerSec, 0)
            )
        ));

    return rows;
}
