/**
 * Type definitions for metrics module
 */

export type TimeRange = 'hour' | 'day' | 'week' | 'month';
export type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';
export type MetricKey = 'requests' | 'tokens' | 'cost' | 'duration' | 'ttft';

export interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export interface ChartDataPoint {
    name: string;
    requests: number;
    tokens: number;
    cost: number;
    duration: number;
    ttft: number;
    avgTps: number;
    avgTtft: number;
    avgLatency: number;
    fill?: string;
}

export interface AggregatedDataPoint {
    name: string;
    requests: number;
    tokens: number;
    cost: number;
    duration: number;
    ttft: number;
    avgTps: number;
    avgTtft: number;
    avgLatency: number;
}

export interface ChartDataResponse {
    timeRange: TimeRange;
    granularity: 'minute' | 'hour' | 'day';
    data: ChartDataPoint[];
    total: number;
    generatedAt: string;
}

export interface AggregatedResponse {
    groupBy: GroupBy;
    timeRange: TimeRange;
    data: AggregatedDataPoint[];
    total: number;
    generatedAt: string;
}

export interface StatsResponse {
    timeRange: TimeRange;
    stats: Record<string, number>;
    generatedAt: string;
}

export interface LiveSnapshotData {
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
    providers: ProviderStats[];
    recentRequests: unknown[];
}

export interface ProviderStats {
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

export const VALID_TIME_RANGES: TimeRange[] = ['hour', 'day', 'week', 'month'];
export const VALID_GROUP_BY: GroupBy[] = ['time', 'provider', 'model', 'apiKey', 'status'];
export const VALID_METRICS: MetricKey[] = ['requests', 'tokens', 'cost', 'duration', 'ttft'];

export const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
    '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#f43f5e'
];
