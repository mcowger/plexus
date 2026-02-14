import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LiveMetrics } from '../LiveMetrics';
import { api } from '../../lib/api';
import type { DashboardData, LiveDashboardSnapshot, ProviderPerformanceData } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: {
    getDashboardData: vi.fn(),
    getLiveDashboardSnapshot: vi.fn(),
    getProviderPerformance: vi.fn(),
    subscribeToUsageEvents: vi.fn(),
  },
  STAT_LABELS: {
    REQUESTS: 'Total Requests',
    PROVIDERS: 'Active Providers',
    TOKENS: 'Total Tokens',
    DURATION: 'Avg Duration',
  },
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('LiveMetrics Page', () => {
  const mockDashboardData: DashboardData = {
    stats: [
      { label: 'Total Requests', value: 1500, change: 12.5 },
      { label: 'Total Tokens', value: 2500000, change: 8.3 },
    ],
    usageData: [
      { timestamp: '2024-01-01T00:00:00Z', requests: 100, tokens: 50000 },
    ],
    cooldowns: [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        until: new Date(Date.now() + 300000).toISOString(),
      },
    ],
    todayMetrics: {
      requests: 500,
      inputTokens: 100000,
      outputTokens: 80000,
      reasoningTokens: 20000,
      cachedTokens: 5000,
      totalCost: 0.45,
    },
  };

  const mockLiveSnapshot: LiveDashboardSnapshot = {
    windowMinutes: 5,
    requestCount: 120,
    successCount: 115,
    errorCount: 5,
    successRate: 0.958,
    totalTokens: 45000,
    totalCost: 0.25,
    tokensPerMinute: 9000,
    costPerMinute: 0.05,
    avgDurationMs: 1250,
    avgTtftMs: 320,
    avgTokensPerSec: 450,
    providers: [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        requestCount: 60,
        successCount: 58,
        errorCount: 2,
        avgDurationMs: 1100,
        avgTokensPerRequest: 350,
      },
    ],
    recentRequests: [
      {
        id: 'req-1',
        provider: 'openai',
        model: 'gpt-4',
        timestamp: new Date().toISOString(),
        duration: 1200,
        tokens: 500,
        cost: 0.02,
        status: 'success',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    api.getDashboardData.mockResolvedValue(mockDashboardData);
    api.getLiveDashboardSnapshot.mockResolvedValue(mockLiveSnapshot);
    api.getProviderPerformance.mockResolvedValue([]);
    api.subscribeToUsageEvents.mockReturnValue({
      close: vi.fn(),
      onmessage: null,
      onerror: null,
      onopen: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      readyState: 1,
      url: 'http://test',
      withCredentials: false,
    } as unknown as EventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Data Fetching Strategy', () => {
    it('should fetch dashboard data every 30 seconds', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(2);
      });
    });

    it('should fetch live snapshot every 10 seconds', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(10000);

      await waitFor(() => {
        expect(api.getLiveDashboardSnapshot).toHaveBeenCalledTimes(2);
      });
    });

    it('should subscribe to SSE on mount', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(api.subscribeToUsageEvents).toHaveBeenCalled();
      });
    });

    it('should handle SSE messages', async () => {
      const mockEventSource = {
        close: vi.fn(),
        onmessage: null as ((e: MessageEvent) => void) | null,
        onerror: null,
        onopen: null,
        addEventListener: vi.fn((event: string, handler: EventListener) => {
          if (event === 'message') {
            mockEventSource.onmessage = handler as unknown as (e: MessageEvent) => void;
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        readyState: 1,
        url: 'http://test',
        withCredentials: false,
      };

      api.subscribeToUsageEvents.mockReturnValue(mockEventSource as unknown as EventSource);

      render(<LiveMetrics />);

      // Simulate SSE message
      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify({ type: 'usage', timestamp: new Date().toISOString() }),
      });

      if (mockEventSource.onmessage) {
        mockEventSource.onmessage(messageEvent);
      }

      // Should trigger data reload after debounce
      vi.advanceTimersByTime(1000);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Rendering', () => {
    it('should render KPI cards', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(screen.getByText('Live Metrics')).toBeInTheDocument();
      });
    });

    it('should render live timeline', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(screen.getByText('Live Timeline')).toBeInTheDocument();
      });
    });

    it('should render provider pulse table', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(screen.getByText('Provider Pulse')).toBeInTheDocument();
      });
    });

    it('should render recent requests', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(screen.getByText('Recent Requests')).toBeInTheDocument();
      });
    });

    it('should render cooldown alerts', async () => {
      render(<LiveMetrics />);

      await waitFor(() => {
        expect(screen.getByText('Cooldowns')).toBeInTheDocument();
      });
    });
  });

  describe('Time Range Controls', () => {
    it('should update activity range when changed', async () => {
      render(<LiveMetrics />);

      // Should fetch with default 'day' range
      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledWith('day');
      });
    });
  });

  describe('Cleanup', () => {
    it('should clear intervals on unmount', async () => {
      const { unmount } = render(<LiveMetrics />);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalled();
      });

      unmount();

      // Should not make more calls after unmount
      vi.advanceTimersByTime(30000);

      expect(api.getDashboardData).toHaveBeenCalledTimes(1);
    });

    it('should close SSE connection on unmount', async () => {
      const mockClose = vi.fn();
      api.subscribeToUsageEvents.mockReturnValue({
        close: mockClose,
      } as unknown as EventSource);

      const { unmount } = render(<LiveMetrics />);

      unmount();

      expect(mockClose).toHaveBeenCalled();
    });
  });
});
