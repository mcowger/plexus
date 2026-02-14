import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Metrics } from '../Metrics';
import { api } from '../../lib/api';
import type { DashboardData, LiveDashboardSnapshot, ProviderPerformanceData } from '../../lib/api';

// Mock the api module
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

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('Metrics Page', () => {
  const mockDashboardData: DashboardData = {
    stats: [
      { label: 'Total Requests', value: 1500, change: 12.5 },
      { label: 'Active Providers', value: 3, change: 0 },
      { label: 'Total Tokens', value: 2500000, change: 8.3 },
      { label: 'Avg Duration', value: 1250, change: -5.2 },
    ],
    usageData: [
      { timestamp: '2024-01-01T00:00:00Z', requests: 100, tokens: 50000 },
      { timestamp: '2024-01-01T01:00:00Z', requests: 120, tokens: 60000 },
    ],
    cooldowns: [],
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
    recentRequests: [],
  };

  const mockProviderPerformance: ProviderPerformanceData[] = [
    {
      providerId: 'openai',
      providerName: 'OpenAI',
      healthy: true,
      avgLatencyMs: 1100,
      successRate: 0.967,
      requestCount: 60,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    api.getDashboardData.mockResolvedValue(mockDashboardData);
    api.getLiveDashboardSnapshot.mockResolvedValue(mockLiveSnapshot);
    api.getProviderPerformance.mockResolvedValue(mockProviderPerformance);
    api.subscribeToUsageEvents.mockReturnValue({
      close: vi.fn(),
    } as unknown as EventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Data Fetching', () => {
    it('should fetch dashboard data on mount', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledWith('day');
      });
    });

    it('should fetch live snapshot on mount', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(api.getLiveDashboardSnapshot).toHaveBeenCalledWith(1200);
      });
    });

    it('should fetch provider performance on mount', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(api.getProviderPerformance).toHaveBeenCalled();
      });
    });

    it('should subscribe to usage events on mount', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(api.subscribeToUsageEvents).toHaveBeenCalled();
      });
    });

    it('should poll data every 10 seconds', async () => {
      render(<Metrics />);

      // Wait for initial fetch
      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(1);
      });

      // Advance timer by 10 seconds
      vi.advanceTimersByTime(10000);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Rendering', () => {
    it('should render page title', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(screen.getByText('Metrics')).toBeInTheDocument();
      });
    });

    it('should render stats cards', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(screen.getByText('Total Requests')).toBeInTheDocument();
        expect(screen.getByText('Total Tokens')).toBeInTheDocument();
      });
    });

    it('should render live metrics section', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(screen.getByText('Live Metrics')).toBeInTheDocument();
      });
    });

    it('should render provider performance section', async () => {
      render(<Metrics />);

      await waitFor(() => {
        expect(screen.getByText('Provider Performance')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      api.getDashboardData.mockRejectedValue(new Error('API Error'));

      render(<Metrics />);

      await waitFor(() => {
        // Should not crash, should show empty state or error message
        expect(screen.getByText('Metrics')).toBeInTheDocument();
      });
    });
  });

  describe('Performance', () => {
    it('should not make duplicate requests on re-render', async () => {
      const { rerender } = render(<Metrics />);

      await waitFor(() => {
        expect(api.getDashboardData).toHaveBeenCalledTimes(1);
      });

      rerender(<Metrics />);

      // Should still only have 1 call
      expect(api.getDashboardData).toHaveBeenCalledTimes(1);
    });
  });
});
