import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

type TimeRange = 'hour' | 'day' | 'week' | 'month';
type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';
type ChartType = 'line' | 'bar' | 'area' | 'pie';

interface AggregatedDataPoint {
  name: string;
  requests: number;
  tokens: number;
  cost: number;
  duration: number;
  ttft: number;
  fill?: string;
}

interface StatsData {
  requests: number;
  tokens: number;
  cost: number;
  avgDuration: number;
  successRate: number;
}

interface UseLogsReturn {
  data: AggregatedDataPoint[];
  stats: StatsData;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface UseLogsOptions {
  timeRange: TimeRange;
  groupBy: GroupBy;
  chartType: ChartType;
  selectedMetrics: string[];
  refreshInterval?: number;
}

const DEFAULT_OPTIONS: Partial<UseLogsOptions> = {
  timeRange: 'day',
  groupBy: 'time',
  chartType: 'area',
  selectedMetrics: ['requests', 'tokens', 'cost'],
  refreshInterval: 30000
};

/**
 * useLogs hook - Server-side aggregation for usage logs
 *
 * This hook replaces client-side aggregation with server-side aggregation
 * to improve performance. It uses the new /api/v1/metrics endpoints.
 */
export function useLogs(options: Partial<UseLogsOptions> = {}): UseLogsReturn {
  const {
    timeRange = DEFAULT_OPTIONS.timeRange!,
    groupBy = DEFAULT_OPTIONS.groupBy!,
    refreshInterval = DEFAULT_OPTIONS.refreshInterval!
  } = options;

  const [data, setData] = useState<AggregatedDataPoint[]>([]);
  const [stats, setStats] = useState<StatsData>({
    requests: 0,
    tokens: 0,
    cost: 0,
    avgDuration: 0,
    successRate: 1
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Use refs to track the latest options without causing re-renders
  const optionsRef = useRef({ timeRange, groupBy });
  optionsRef.current = { timeRange, groupBy };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const currentOptions = optionsRef.current;

      // Fetch aggregated data based on groupBy
      const aggregatedResponse = await api.getAggregatedMetrics(
        currentOptions.groupBy,
        currentOptions.timeRange
      );

      // Fetch stats
      const statsResponse = await api.getMetricsStats(currentOptions.timeRange);

      setData(aggregatedResponse.data);
      setStats(statsResponse.stats);
    } catch (e) {
      setError(e as Error);
      console.error('Failed to fetch logs data', e);
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps since we use ref for latest options

  // Fetch data on mount and when options change
  useEffect(() => {
    fetchData();
  }, [fetchData, timeRange, groupBy]);

  // Set up polling interval
  useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0) return;

    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  return {
    data,
    stats,
    loading,
    error,
    refetch: fetchData
  };
}

export default useLogs;
