import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { DashboardData, TimeRange, Stat, UsageData, Cooldown, TodayMetrics } from '../../../lib/api';

const POLL_INTERVAL_MS = 30000; // 30 seconds

export interface UseDashboardDataOptions {
  timeRange?: TimeRange;
  pollInterval?: number;
}

export interface UseDashboardDataReturn {
  data: {
    stats: Stat[];
    usageData: UsageData[];
    cooldowns: Cooldown[];
    todayMetrics: TodayMetrics;
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching dashboard data with polling
 * Used by: LiveMetrics.tsx
 */
export const useDashboardData = (options: UseDashboardDataOptions = {}): UseDashboardDataReturn => {
  const { timeRange = 'day', pollInterval = POLL_INTERVAL_MS } = options;

  const [data, setData] = useState<{
    stats: Stat[];
    usageData: UsageData[];
    cooldowns: Cooldown[];
    todayMetrics: TodayMetrics;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const dashboardData: DashboardData = await api.getDashboardData(timeRange);
      setData({
        stats: dashboardData.stats,
        usageData: dashboardData.usageData,
        cooldowns: dashboardData.cooldowns,
        todayMetrics: dashboardData.todayMetrics,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch dashboard data'));
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    // Initial fetch
    void fetchData();

    // Set up polling
    intervalRef.current = setInterval(() => {
      void fetchData();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData, pollInterval]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
};

export default useDashboardData;
