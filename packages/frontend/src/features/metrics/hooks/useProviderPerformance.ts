import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../../lib/api';
import type { ProviderPerformanceData } from '../../../lib/api';

const POLL_INTERVAL_MS = 10000; // 10 seconds

export interface UseProviderPerformanceOptions {
  model?: string;
  provider?: string;
  pollInterval?: number;
}

export interface ProviderMetrics {
  avgTtftMs: number;
  avgTokensPerSec: number;
}

export interface UseProviderPerformanceReturn {
  performance: ProviderPerformanceData[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  byProvider: Map<string, ProviderMetrics>;
}

/**
 * Hook for fetching provider performance data with polling
 * Used by: Metrics.tsx, LiveMetrics.tsx
 */
export const useProviderPerformance = (options: UseProviderPerformanceOptions = {}): UseProviderPerformanceReturn => {
  const { model, provider, pollInterval = POLL_INTERVAL_MS } = options;

  const [performance, setPerformance] = useState<ProviderPerformanceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getProviderPerformance(model, provider);
      setPerformance(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch provider performance'));
    } finally {
      setLoading(false);
    }
  }, [model, provider]);

  useEffect(() => {
    // Initial fetch
    void fetchPerformance();

    // Set up polling
    intervalRef.current = setInterval(() => {
      void fetchPerformance();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchPerformance, pollInterval]);

  // Computed map of provider metrics for easy lookup
  const byProvider = useMemo(() => {
    const totals = new Map<string, {
      ttftWeighted: number;
      tpsWeighted: number;
      samples: number;
    }>();

    for (const row of performance) {
      const key = row.provider || 'unknown';
      const weight = Math.max(1, Number(row.sample_count || 0));
      const current = totals.get(key) ?? { ttftWeighted: 0, tpsWeighted: 0, samples: 0 };

      current.samples += weight;
      current.ttftWeighted += Number(row.avg_ttft_ms || 0) * weight;
      current.tpsWeighted += Number(row.avg_tokens_per_sec || 0) * weight;
      totals.set(key, current);
    }

    const byProvider = new Map<string, ProviderMetrics>();
    for (const [prov, metric] of totals.entries()) {
      const samples = Math.max(1, metric.samples);
      byProvider.set(prov, {
        avgTtftMs: metric.ttftWeighted / samples,
        avgTokensPerSec: metric.tpsWeighted / samples,
      });
    }

    return byProvider;
  }, [performance]);

  return {
    performance,
    loading,
    error,
    refetch: fetchPerformance,
    byProvider,
  };
};

export default useProviderPerformance;
