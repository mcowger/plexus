/**
 * Data aggregation and processing logic for metrics module
 */

import { AggregatedDataPoint, ChartDataPoint, COLORS, GroupBy } from './types';
import { AggregatedRow, ChartDataRow } from './queries';
import { getBucketFormat } from './time';
import { LiveRequestRecord, ProviderPerformanceRecord } from './queries';

function isKnownProvider(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'unknown';
}

export interface ProviderAccumulator {
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
}

export interface ComputedProviderStats {
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
}

export interface ProcessedRequest {
    requestId: string;
    date: string;
    provider: string;
    model: string;
    responseStatus: string;
    totalTokens: number;
    costTotal: number;
    durationMs: number;
    ttftMs: number;
    tokensPerSec: number;
}

export interface ProviderPerformanceMetrics {
    provider: string;
    model: string;
    avg_ttft_ms: number;
    min_ttft_ms: number;
    max_ttft_ms: number;
    avg_tokens_per_sec: number;
    min_tokens_per_sec: number;
    max_tokens_per_sec: number;
    sample_count: number;
    last_updated: number;
}

export function aggregateChartData(rows: ChartDataRow[], timeRange: string): ChartDataPoint[] {
    const bucketFormat = getBucketFormat(timeRange as 'hour' | 'day' | 'week' | 'month');

    return rows.map(row => {
        const tokens = row.inputTokens + row.outputTokens + row.reasoningTokens + row.cachedTokens;
        const avgLatency = row.durationCount > 0 ? row.durationSum / row.durationCount : 0;
        const avgTtft = row.ttftCount > 0 ? row.ttftSum / row.ttftCount : 0;
        const avgTps = row.durationSum > 0 ? (tokens / row.durationSum) * 1000 : 0;

        return {
            name: bucketFormat(row.bucketStartMs),
            requests: row.requests,
            tokens,
            cost: row.cost,
            duration: avgLatency,
            ttft: avgTtft,
            avgTps,
            avgTtft,
            avgLatency
        };
    });
}

export function aggregateGroupedData(rows: AggregatedRow[], groupBy: GroupBy): AggregatedDataPoint[] {
    const data: AggregatedDataPoint[] = rows.map((row, index) => {
        let name = row.groupKey;

        // Truncate API key for display
        if (groupBy === 'apiKey' && name.length > 8) {
            name = name.slice(0, 8) + '...';
        }

        const tokens = row.inputTokens + row.outputTokens + row.reasoningTokens + row.cachedTokens;
        const avgLatency = row.durationCount > 0 ? row.durationSum / row.durationCount : 0;
        const avgTtft = row.ttftCount > 0 ? row.ttftSum / row.ttftCount : 0;
        const avgTps = row.durationSum > 0 ? (tokens / row.durationSum) * 1000 : 0;

        return {
            name,
            requests: row.requests,
            tokens,
            cost: row.cost,
            duration: avgLatency,
            ttft: avgTtft,
            avgTps,
            avgTtft,
            avgLatency
        };
    });

    // Limit to top 10 for non-time groupings
    const limitedData = groupBy === 'time' ? data : data.slice(0, 10);

    // Add colors for pie chart
    return limitedData.map((item, index) => ({
        ...item,
        fill: COLORS[index % COLORS.length]
    }));
}

export function computeLiveSnapshot(
    records: LiveRequestRecord[],
    windowMinutes: number
): {
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
    providers: ComputedProviderStats[];
    recentRequests: ProcessedRequest[];
} {
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

    const providerStats = new Map<string, ProviderAccumulator>();

    const knownRecords = records.filter(record => isKnownProvider(record.provider));

    for (const record of knownRecords) {
        requestCount++;
        const provider = String(record.provider);
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

    const providers: ComputedProviderStats[] = Array.from(providerStats.entries())
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

    const recentRequests: ProcessedRequest[] = knownRecords.slice(0, 20).map(record => {
        const inputTokens = Number(record.tokensInput) || 0;
        const outputTokens = Number(record.tokensOutput) || 0;
        const reasoningTokens = Number(record.tokensReasoning) || 0;
        const cachedTokens = Number(record.tokensCached) || 0;

        return {
            requestId: String(record.requestId || ''),
            date: String(record.date || ''),
            provider: String(record.provider),
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
}

export function computeProviderPerformance(
    records: ProviderPerformanceRecord[]
): ProviderPerformanceMetrics[] {
    const grouped = new Map<string, {
        ttftWeighted: number;
        tpsWeighted: number;
        samples: number;
    }>();

    for (const row of records) {
        if (!isKnownProvider(row.provider)) {
            continue;
        }

        const provider = String(row.provider);
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
            provider: provider || 'unknown',
            model: model || 'unknown',
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
}

export interface DashboardUsagePoint {
    timestamp: string;
    requests: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    avgTps: number;
    avgTtft: number;
    avgLatency: number;
}

export function computeDashboardUsage(
    rows: ChartDataRow[],
    timeRange: string
): DashboardUsagePoint[] {
    const bucketFormat = getBucketFormat(timeRange as 'hour' | 'day' | 'week' | 'month');

    return rows.map(row => {
        const tokens = row.inputTokens + row.outputTokens + row.reasoningTokens + row.cachedTokens;
        const durationCount = row.durationCount;
        const ttftCount = row.ttftCount;
        const durationSum = row.durationSum;
        const ttftSum = row.ttftSum;

        const avgLatency = durationCount > 0 ? durationSum / durationCount : 0;
        const avgTtft = ttftCount > 0 ? ttftSum / ttftCount : 0;
        const avgTps = durationSum > 0 ? (tokens / durationSum) * 1000 : 0;

        return {
            timestamp: bucketFormat(row.bucketStartMs),
            requests: row.requests,
            tokens,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cachedTokens: row.cachedTokens,
            avgTps,
            avgTtft,
            avgLatency
        };
    });
}

export interface DashboardStats {
    label: string;
    value: string;
}

export function buildDashboardStats(
    weeklyStats: { requests: number; inputTokens: number; outputTokens: number },
    avgDurationMs: number
): DashboardStats[] {
    return [
        { label: 'Total Requests', value: String(weeklyStats.requests || 0) },
        { label: 'Active Providers', value: '-' },
        { label: 'Total Tokens', value: String((weeklyStats.inputTokens || 0) + (weeklyStats.outputTokens || 0)) },
        { label: 'Avg. Duration', value: String(Math.round(avgDurationMs || 0)) + 'ms' }
    ];
}
