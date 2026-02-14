import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLogs } from '../useLogs';
import { api } from '../../lib/api';

// Mock the API module
vi.mock('../../lib/api', () => ({
    api: {
        getAggregatedMetrics: vi.fn(),
        getMetricsStats: vi.fn()
    }
}));

describe('useLogs', () => {
    const mockAggregatedResponse = {
        groupBy: 'provider',
        timeRange: 'day',
        data: [
            {
                name: 'test-provider',
                requests: 10,
                tokens: 350,
                cost: 0.5,
                duration: 500,
                ttft: 100,
                fill: '#3b82f6'
            }
        ],
        total: 1,
        generatedAt: new Date().toISOString()
    };

    const mockStatsResponse = {
        timeRange: 'day',
        stats: {
            requests: 10,
            tokens: 350,
            cost: 0.5,
            avgDuration: 500,
            successRate: 1
        },
        generatedAt: new Date().toISOString()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (api.getAggregatedMetrics as ReturnType<typeof vi.fn>).mockResolvedValue(mockAggregatedResponse);
        (api.getMetricsStats as ReturnType<typeof vi.fn>).mockResolvedValue(mockStatsResponse);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should fetch data on mount', async () => {
        const { result } = renderHook(() => useLogs({
            timeRange: 'day',
            groupBy: 'provider'
        }));

        // Initially loading
        expect(result.current.loading).toBe(true);

        // Wait for data to load
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.data).toEqual(mockAggregatedResponse.data);
        expect(result.current.stats).toEqual(mockStatsResponse.stats);
    });

    it('should handle errors gracefully', async () => {
        (api.getAggregatedMetrics as jest.Mock).mockRejectedValue(new Error('API Error'));
        (api.getMetricsStats as jest.Mock).mockRejectedValue(new Error('API Error'));

        const { result } = renderHook(() => useLogs());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeTruthy();
        expect(result.current.data).toEqual([]);
    });

    it('should refetch data when called', async () => {
        const { result } = renderHook(() => useLogs());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // Clear mock calls
        jest.clearAllMocks();

        // Call refetch
        await result.current.refetch();

        expect(api.getAggregatedMetrics).toHaveBeenCalled();
        expect(api.getMetricsStats).toHaveBeenCalled();
    });

    it('should update when timeRange changes', async () => {
        const { result, rerender } = renderHook(
            ({ timeRange }) => useLogs({ timeRange }),
            { initialProps: { timeRange: 'day' as const } }
        );

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        jest.clearAllMocks();

        // Change timeRange
        rerender({ timeRange: 'week' });

        await waitFor(() => {
            expect(api.getAggregatedMetrics).toHaveBeenCalledWith('provider', 'week');
        });
    });

    it('should update when groupBy changes', async () => {
        const { result, rerender } = renderHook(
            ({ groupBy }) => useLogs({ groupBy }),
            { initialProps: { groupBy: 'provider' as const } }
        );

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        jest.clearAllMocks();

        // Change groupBy
        rerender({ groupBy: 'model' });

        await waitFor(() => {
            expect(api.getAggregatedMetrics).toHaveBeenCalledWith('model', 'day');
        });
    });

    it('should poll data at the specified interval', async () => {
        jest.useFakeTimers();

        renderHook(() => useLogs({
            refreshInterval: 5000
        }));

        await waitFor(() => {
            expect(api.getAggregatedMetrics).toHaveBeenCalledTimes(1);
        });

        // Advance time by 5 seconds
        jest.advanceTimersByTime(5000);

        await waitFor(() => {
            expect(api.getAggregatedMetrics).toHaveBeenCalledTimes(2);
        });

        jest.useRealTimers();
    });

    it('should not poll when refreshInterval is 0', async () => {
        jest.useFakeTimers();

        renderHook(() => useLogs({
            refreshInterval: 0
        }));

        await waitFor(() => {
            expect(api.getAggregatedMetrics).toHaveBeenCalledTimes(1);
        });

        // Advance time
        jest.advanceTimersByTime(30000);

        // Should still only be called once (no polling)
        expect(api.getAggregatedMetrics).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
    });

    it('should return correct default stats', async () => {
        const { result } = renderHook(() => useLogs());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.stats).toEqual({
            requests: 10,
            tokens: 350,
            cost: 0.5,
            avgDuration: 500,
            successRate: 1
        });
    });
});
