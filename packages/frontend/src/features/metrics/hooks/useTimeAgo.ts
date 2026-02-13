import { useState, useEffect, useCallback } from 'react';
import { formatTimeAgo } from '../../../lib/format';

export interface UseTimeAgoOptions {
  refreshInterval?: number; // in milliseconds
}

export interface UseTimeAgoReturn {
  timeAgo: string;
  lastUpdated: Date;
  updateLastUpdated: () => void;
}

const DEFAULT_REFRESH_INTERVAL = 10000; // 10 seconds

/**
 * Hook for tracking time ago display with auto-refresh
 * Used by: Metrics.tsx, LiveMetrics.tsx, DetailedUsage.tsx
 */
export const useTimeAgo = (options: UseTimeAgoOptions = {}): UseTimeAgoReturn => {
  const { refreshInterval = DEFAULT_REFRESH_INTERVAL } = options;

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Just now');

  const updateTimeAgo = useCallback(() => {
    const diffSeconds = Math.max(
      0,
      Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
    );
    setTimeAgo(diffSeconds < 5 ? 'Just now' : formatTimeAgo(diffSeconds));
  }, [lastUpdated]);

  const updateLastUpdated = useCallback(() => {
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, refreshInterval);
    return () => clearInterval(interval);
  }, [updateTimeAgo, refreshInterval]);

  return {
    timeAgo,
    lastUpdated,
    updateLastUpdated,
  };
};

export default useTimeAgo;
