import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { LiveDashboardSnapshot } from '../../../lib/api';

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_REQUEST_LIMIT = 1200;
const POLL_INTERVAL_MS = 10000; // 10 seconds

const EMPTY_LIVE_SNAPSHOT: LiveDashboardSnapshot = {
  windowMinutes: DEFAULT_WINDOW_MINUTES,
  requestCount: 0,
  successCount: 0,
  errorCount: 0,
  successRate: 1,
  totalTokens: 0,
  totalCost: 0,
  tokensPerMinute: 0,
  costPerMinute: 0,
  avgDurationMs: 0,
  avgTtftMs: 0,
  avgTokensPerSec: 0,
  providers: [],
  recentRequests: []
};

export interface UseLiveSnapshotOptions {
  windowMinutes?: number;
  limit?: number;
  pollInterval?: number;
}

export interface UseLiveSnapshotReturn {
  snapshot: LiveDashboardSnapshot;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching live dashboard snapshot with polling
 * Used by: Metrics.tsx, LiveMetrics.tsx
 */
export const useLiveSnapshot = (options: UseLiveSnapshotOptions = {}): UseLiveSnapshotReturn => {
  const {
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    limit = DEFAULT_REQUEST_LIMIT,
    pollInterval = POLL_INTERVAL_MS
  } = options;

  const [snapshot, setSnapshot] = useState<LiveDashboardSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getLiveDashboardSnapshot(windowMinutes, limit);
      setSnapshot(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch live snapshot'));
    } finally {
      setLoading(false);
    }
  }, [windowMinutes, limit]);

  useEffect(() => {
    // Initial fetch
    void fetchSnapshot();

    // Set up polling
    intervalRef.current = setInterval(() => {
      void fetchSnapshot();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchSnapshot, pollInterval]);

  return {
    snapshot,
    loading,
    error,
    refetch: fetchSnapshot,
  };
};

export default useLiveSnapshot;
