import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from '../useDashboardData';
import { api } from '../../../../lib/api';

// Mock the API module
vi.mock('../../../../lib/api', () => ({
  api: {
    getDashboardData: vi.fn(),
  },
}));

describe('useDashboardData', () => {
  const mockDashboardData = {
    stats: [
      { label: 'Total Requests', value: '1000' },
      { label: 'Active Providers', value: '5' },
    ],
    usageData: [],
    cooldowns: [],
    todayMetrics: {
      requests: 100,
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalCost: 0.5,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fetch dashboard data on mount', async () => {
    vi.mocked(api.getDashboardData).mockResolvedValue(mockDashboardData);

    const { result } = renderHook(() => useDashboardData({ timeRange: 'day' }));

    // Initially loading
    expect(result.current.loading).toBe(true);

    // Wait for data to be fetched
    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    expect(result.current.data?.stats).toEqual(mockDashboardData.stats);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle errors', async () => {
    const error = new Error('Failed to fetch');
    vi.mocked(api.getDashboardData).mockRejectedValue(error);

    const { result } = renderHook(() => useDashboardData({ timeRange: 'day' }));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Failed to fetch');
    expect(result.current.loading).toBe(false);
  });

  it('should poll for data at specified interval', async () => {
    vi.mocked(api.getDashboardData).mockResolvedValue(mockDashboardData);

    renderHook(() => useDashboardData({ timeRange: 'day', pollInterval: 5000 }));

    // Wait for initial fetch
    await waitFor(() => {
      expect(api.getDashboardData).toHaveBeenCalledTimes(1);
    });

    // Advance timers to trigger poll
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(api.getDashboardData).toHaveBeenCalledTimes(2);
    });
  });

  it('should refetch when calling refetch', async () => {
    vi.mocked(api.getDashboardData).mockResolvedValue(mockDashboardData);

    const { result } = renderHook(() => useDashboardData({ timeRange: 'day' }));

    await waitFor(() => {
      expect(api.getDashboardData).toHaveBeenCalledTimes(1);
    });

    // Call refetch
    await result.current.refetch();

    expect(api.getDashboardData).toHaveBeenCalledTimes(2);
  });

  it('should clean up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useDashboardData({ timeRange: 'day' }));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
