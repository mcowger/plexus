import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMetricsStream } from '../useMetricsStream';

// Mock EventSource
global.EventSource = vi.fn() as unknown as typeof EventSource;

describe('useMetricsStream', () => {
  let mockEventSource: {
    onopen: (() => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockEventSource = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
      readyState: 0,
    };

    (global.EventSource as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // Trigger onopen immediately
      setTimeout(() => {
        mockEventSource.readyState = 1;
        mockEventSource.onopen?.();
      }, 0);
      return mockEventSource;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with disconnected status', () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: false }));

    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.dashboardData).toBeNull();
    expect(result.current.liveSnapshot).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should auto-connect when autoConnect is true', async () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(global.EventSource).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });
  });

  it('should handle dashboard events', async () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(mockEventSource.onmessage).not.toBeNull();
    });

    const dashboardEvent = {
      data: JSON.stringify({
        type: 'dashboard',
        timestamp: Date.now(),
        data: {
          stats: [],
          usageData: [],
          cooldowns: [],
          todayMetrics: { requests: 100, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalCost: 0 },
          timeRange: 'day',
        },
      }),
    };

    act(() => {
      mockEventSource.onmessage?.(new MessageEvent('message', dashboardEvent));
    });

    await waitFor(() => {
      expect(result.current.dashboardData?.todayMetrics.requests).toBe(100);
    });
  });

  it('should handle live snapshot events', async () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(mockEventSource.onmessage).not.toBeNull();
    });

    const snapshotEvent = {
      data: JSON.stringify({
        type: 'live_snapshot',
        timestamp: Date.now(),
        data: {
          windowMinutes: 5,
          requestCount: 50,
          successCount: 48,
          errorCount: 2,
          successRate: 0.96,
          totalTokens: 10000,
          totalCost: 0.1,
          tokensPerMinute: 2000,
          costPerMinute: 0.02,
          avgDurationMs: 500,
          avgTtftMs: 100,
          avgTokensPerSec: 50,
          providers: [],
          recentRequests: [],
        },
      }),
    };

    act(() => {
      mockEventSource.onmessage?.(new MessageEvent('message', snapshotEvent));
    });

    await waitFor(() => {
      expect(result.current.liveSnapshot?.requestCount).toBe(50);
      expect(result.current.liveSnapshot?.successRate).toBe(0.96);
    });
  });

  it('should handle connection errors and reconnect', async () => {
    const { result } = renderHook(() =>
      useMetricsStream({
        autoConnect: true,
        reconnectDelay: 1000,
        maxReconnectAttempts: 3,
      })
    );

    await waitFor(() => {
      expect(mockEventSource.onerror).not.toBeNull();
    });

    // Simulate error
    act(() => {
      mockEventSource.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('reconnecting');
    });

    // Advance past reconnect delay
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should attempt to reconnect
    await waitFor(() => {
      expect(global.EventSource).toHaveBeenCalledTimes(2);
    });
  });

  it('should allow manual disconnect', async () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockEventSource.close).toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe('disconnected');
  });

  it('should allow manual reconnect', async () => {
    const { result } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(global.EventSource).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.reconnect();
    });

    await waitFor(() => {
      expect(global.EventSource).toHaveBeenCalledTimes(2);
    });
  });

  it('should detect stale data', async () => {
    const { result } = renderHook(() =>
      useMetricsStream({
        autoConnect: true,
        staleThreshold: 5000,
      })
    );

    // Wait for connection
    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected');
    });

    // Send an event
    const event = {
      data: JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
      }),
    };

    act(() => {
      mockEventSource.onmessage?.(new MessageEvent('message', event));
    });

    expect(result.current.isStale).toBe(false);

    // Advance past stale threshold
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    await waitFor(() => {
      expect(result.current.isStale).toBe(true);
    });
  });

  it('should clean up on unmount', async () => {
    const { unmount } = renderHook(() => useMetricsStream({ autoConnect: true }));

    await waitFor(() => {
      expect(global.EventSource).toHaveBeenCalled();
    });

    unmount();

    expect(mockEventSource.close).toHaveBeenCalled();
  });
});
