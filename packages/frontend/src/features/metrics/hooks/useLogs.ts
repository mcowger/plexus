import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../../lib/api';
import type { UsageRecord, TimeRange } from '../../../lib/api';
import type { AggregatedDataPoint } from '../types/metrics';

const POLL_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_LIMIT = 2000;

export type { TimeRange };
export type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';

export interface UseLogsOptions {
  timeRange?: TimeRange;
  limit?: number;
  pollInterval?: number;
}

export interface UseLogsReturn {
  records: UsageRecord[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  aggregatedData: AggregatedDataPoint[];
  stats: {
    total: number;
    tokens: number;
    cost: number;
    avgDuration: number;
    successRate: number;
  };
}

// Color palette for charts
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];

/**
 * Hook for fetching logs with filtering and aggregation
 * Used by: DetailedUsage.tsx
 */
export const useLogs = (options: UseLogsOptions = {}): UseLogsReturn => {
  const { timeRange = 'day', limit = DEFAULT_LIMIT, pollInterval = POLL_INTERVAL_MS } = options;

  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const startDate = new Date(now);

      switch (timeRange) {
        case 'hour':
          startDate.setHours(startDate.getHours() - 1);
          break;
        case 'day':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setDate(startDate.getDate() - 30);
          break;
      }

      const response = await api.getLogs(limit, 0, {
        startDate: startDate.toISOString(),
      });

      setRecords(response.data || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch logs'));
    } finally {
      setLoading(false);
    }
  }, [timeRange, limit]);

  useEffect(() => {
    // Initial fetch
    void fetchLogs();

    // Set up polling
    intervalRef.current = setInterval(() => {
      void fetchLogs();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchLogs, pollInterval]);

  // Computed stats
  const stats = useMemo(() => {
    const total = records.length;
    const tokens = records.reduce(
      (acc, r) =>
        acc +
        (r.tokensInput || 0) +
        (r.tokensOutput || 0) +
        (r.tokensReasoning || 0) +
        (r.tokensCached || 0),
      0
    );
    const cost = records.reduce((acc, r) => acc + (r.costTotal || 0), 0);
    const avgDuration =
      total > 0
        ? records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / total
        : 0;
    const successCount = records.filter((r) => r.responseStatus === 'success').length;
    const successRate = total > 0 ? (successCount / total) * 100 : 0;

    return {
      total,
      tokens,
      cost,
      avgDuration,
      successRate,
    };
  }, [records]);

  // Aggregation function for grouping data
  const aggregateBy = useCallback(
    (groupBy: GroupBy): AggregatedDataPoint[] => {
      if (groupBy === 'time') {
        const grouped = new Map<
          string,
          { requests: number; tokens: number; cost: number; duration: number; ttft: number; count: number }
        >();

        records.forEach((record) => {
          const date = new Date(record.date);
          let key: string;

          if (timeRange === 'hour' || timeRange === 'day') {
            key = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } else {
            key = date.toLocaleDateString();
          }

          const existing = grouped.get(key) ?? {
            requests: 0,
            tokens: 0,
            cost: 0,
            duration: 0,
            ttft: 0,
            count: 0,
          };
          existing.requests += 1;
          existing.tokens +=
            (record.tokensInput || 0) +
            (record.tokensOutput || 0) +
            (record.tokensReasoning || 0) +
            (record.tokensCached || 0);
          existing.cost += record.costTotal || 0;
          existing.duration += record.durationMs || 0;
          existing.ttft += record.ttftMs || 0;
          existing.count += 1;
          grouped.set(key, existing);
        });

        return Array.from(grouped.entries())
          .map(([key, value]) => ({
            name: key,
            requests: value.requests,
            tokens: value.tokens,
            cost: value.cost,
            duration: value.count > 0 ? value.duration / value.count : 0,
            ttft: value.count > 0 ? value.ttft / value.count : 0,
            count: value.count,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } else {
        const grouped = new Map<
          string,
          { requests: number; tokens: number; cost: number; duration: number; ttft: number; count: number }
        >();

        records.forEach((record) => {
          let key: string;
          switch (groupBy) {
            case 'provider':
              key = record.provider || 'unknown';
              break;
            case 'model':
              key = record.incomingModelAlias || record.selectedModelName || 'unknown';
              break;
            case 'apiKey':
              key = record.apiKey ? `${record.apiKey.slice(0, 8)}...` : 'unknown';
              break;
            case 'status':
              key = record.responseStatus || 'unknown';
              break;
            default:
              key = 'unknown';
          }

          const existing = grouped.get(key) ?? {
            requests: 0,
            tokens: 0,
            cost: 0,
            duration: 0,
            ttft: 0,
            count: 0,
          };
          existing.requests += 1;
          existing.tokens +=
            (record.tokensInput || 0) +
            (record.tokensOutput || 0) +
            (record.tokensReasoning || 0) +
            (record.tokensCached || 0);
          existing.cost += record.costTotal || 0;
          existing.duration += record.durationMs || 0;
          existing.ttft += record.ttftMs || 0;
          existing.count += 1;
          grouped.set(key, existing);
        });

        return Array.from(grouped.entries())
          .map(([key, value], index) => ({
            name: key,
            requests: value.requests,
            tokens: value.tokens,
            cost: value.cost,
            duration: value.count > 0 ? value.duration / value.count : 0,
            ttft: value.count > 0 ? value.ttft / value.count : 0,
            count: value.count,
            fill: COLORS[Math.abs(key.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % COLORS.length],
          }))
          .sort((a, b) => b.requests - a.requests)
          .slice(0, 10);
      }
    },
    [records, timeRange]
  );

  // Default aggregated data (by time)
  const aggregatedData = useMemo(() => aggregateBy('time'), [aggregateBy]);

  return {
    records,
    loading,
    error,
    refetch: fetchLogs,
    aggregatedData,
    stats,
  };
};

export default useLogs;
