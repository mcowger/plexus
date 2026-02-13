import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLiveSnapshot } from '../useLiveSnapshot';
import { api } from '../../../../lib/api';

// Mock the API module
vi.mock('../../../../lib/api', () => ({
  api: {
    getLiveDashboardSnapshot: vi.fn(),
  },
}));

describe('useLiveSnapshot', () => {
  const mockSnapshot = {
    windowMinutes: 5,
    requestCount: 100,
    successCount: 95,
    errorCount: 5,
    successRate: 0.95,
    totalTokens: 50000,
    totalCost: 0.25,
    tokensPerMinute: 10000,
    costPerMinute: 0.05,
    avgDurationMs: 500,
    avgTtftMs: 100,
    avgTokensPerSec: 100,
    providers: [],
    recentRequests: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fetch live snapshot on mount', async () => {
    vi.mocked(api.getLiveDashboardSnapshot).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useLiveSnapshot({ windowMinutes: 5, limit: 100 }));

    // Initially loading
    expect(result.current.loading).toBe(true);

    // Wait for data to be fetched
    await waitFor(() => {
      expect(result.current.snapshot.requestCount).toBe(100);
    });

    expect(result.current.snapshot.successRate).toBe(0.95);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should use default values for windowMinutes and limit', async () => {
    vi.mocked(api.getLiveDashboardSnapshot).mockResolvedValue(mockSnapshot);

    renderHook(() => useLiveSnapshot());

    await waitFor(() => {
      expect(api.getLiveDashboardSnapshot).toHaveBeenCalledWith(5, 1200);
    });
  });

  it('should poll at specified interval', async () => {
    vi.mocked(api.getLiveDashboardSnapshot).mockResolvedValue(mockSnapshot);

    renderHook(() => useLiveSnapshot({ pollInterval: 10000 }));

    await waitFor(() => {
      expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(10000);

    await waitFor(() => {
      expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(api.getLiveDashboardSnapshot).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useLiveSnapshot());

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    // Should still have empty snapshot
    expect(result.current.snapshot.requestCount).toBe(0);
  });

  it('should allow refetch', async () => {
    vi.mocked(api.getLiveDashboardSnapshot).mockResolvedValue(mockSnapshot);

    const { result } = renderHook(() => useLiveSnapshot());

    await waitFor(() => {
      expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(1);
    });

    await result.current.refetch();

    expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(2);
  });
});
