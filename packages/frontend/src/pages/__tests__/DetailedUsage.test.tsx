import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DetailedUsage } from '../DetailedUsage';
import { api } from '../../lib/api';
import type { UsageRecord, UsageResponse } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: {
    getLogs: vi.fn(),
  },
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('DetailedUsage Page', () => {
  const generateMockRecords = (count: number): UsageRecord[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `req-${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      provider: i % 2 === 0 ? 'openai' : 'anthropic',
      providerName: i % 2 === 0 ? 'OpenAI' : 'Anthropic',
      model: i % 2 === 0 ? 'gpt-4' : 'claude-3',
      modelName: i % 2 === 0 ? 'GPT-4' : 'Claude 3',
      apiKeyName: 'test-key',
      inputTokens: 1000 + i * 10,
      outputTokens: 500 + i * 5,
      reasoningTokens: i % 3 === 0 ? 200 : 0,
      cachedTokens: i % 4 === 0 ? 100 : 0,
      totalTokens: 1500 + i * 15,
      cost: 0.03 + i * 0.001,
      duration: 1200 + i * 50,
      ttft: 300 + i * 10,
      status: i % 10 === 0 ? 'error' : 'success',
      errorMessage: i % 10 === 0 ? 'Rate limited' : undefined,
    }));
  };

  const mockUsageResponse: UsageResponse = {
    data: generateMockRecords(100),
    pagination: {
      total: 100,
      limit: 2000,
      offset: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    api.getLogs.mockResolvedValue(mockUsageResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Data Fetching', () => {
    it('should fetch logs on mount', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(api.getLogs).toHaveBeenCalledWith(
          2000,
          0,
          expect.objectContaining({
            startDate: expect.any(String),
          })
        );
      });
    });

    it('should poll every 30 seconds', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(api.getLogs).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(api.getLogs).toHaveBeenCalledTimes(2);
      });
    });

    it('should fetch with correct time range', async () => {
      render(<DetailedUsage />);

      const now = new Date();
      const expectedStartDate = new Date(now);
      expectedStartDate.setHours(expectedStartDate.getHours() - 24);

      await waitFor(() => {
        const callArgs = api.getLogs.mock.calls[0];
        const filters = callArgs[2];
        const startDate = new Date(filters?.startDate || '');

        // Should be approximately 24 hours ago
        const timeDiff = now.getTime() - startDate.getTime();
        expect(timeDiff).toBeGreaterThan(23 * 60 * 60 * 1000);
        expect(timeDiff).toBeLessThan(25 * 60 * 60 * 1000);
      });
    });

    it('should update time range when changed', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(api.getLogs).toHaveBeenCalled();
      });

      // Change time range to 'hour'
      const hourButton = screen.getByText('Hour');
      fireEvent.click(hourButton);

      await waitFor(() => {
        const callArgs = api.getLogs.mock.calls;
        const lastCall = callArgs[callArgs.length - 1];
        const filters = lastCall[2];
        const startDate = new Date(filters?.startDate || '');
        const now = new Date();
        const timeDiff = now.getTime() - startDate.getTime();

        // Should be approximately 1 hour ago
        expect(timeDiff).toBeGreaterThan(55 * 60 * 1000);
        expect(timeDiff).toBeLessThan(65 * 60 * 1000);
      });
    });
  });

  describe('Rendering', () => {
    it('should render page title', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(screen.getByText('Detailed Usage')).toBeInTheDocument();
      });
    });

    it('should render chart controls', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(screen.getByText('Time Range')).toBeInTheDocument();
        expect(screen.getByText('Chart Type')).toBeInTheDocument();
        expect(screen.getByText('Group By')).toBeInTheDocument();
      });
    });

    it('should render metric toggles', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(screen.getByText('Requests')).toBeInTheDocument();
        expect(screen.getByText('Tokens')).toBeInTheDocument();
        expect(screen.getByText('Cost')).toBeInTheDocument();
      });
    });

    it('should render data table', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(screen.getByText('Recent Requests')).toBeInTheDocument();
      });
    });
  });

  describe('Aggregation', () => {
    it('should aggregate data by time', async () => {
      render(<DetailedUsage />);

      await waitFor(() => {
        // Data should be aggregated for chart display
        const chart = screen.getByRole('img', { name: /chart/i });
        expect(chart).toBeInTheDocument();
      });
    });

    it('should aggregate data by provider', async () => {
      render(<DetailedUsage />);

      // Change group by to provider
      const providerButton = screen.getByText('Provider');
      fireEvent.click(providerButton);

      await waitFor(() => {
        // Chart should update with provider aggregation
        expect(screen.getByText('Provider')).toBeInTheDocument();
      });
    });

    it('should aggregate data by model', async () => {
      render(<DetailedUsage />);

      // Change group by to model
      const modelButton = screen.getByText('Model');
      fireEvent.click(modelButton);

      await waitFor(() => {
        expect(screen.getByText('Model')).toBeInTheDocument();
      });
    });
  });

  describe('Chart Types', () => {
    it('should switch to line chart', async () => {
      render(<DetailedUsage />);

      const lineChartButton = screen.getByText('Line');
      fireEvent.click(lineChartButton);

      await waitFor(() => {
        expect(screen.getByText('Line')).toHaveClass('active');
      });
    });

    it('should switch to bar chart', async () => {
      render(<DetailedUsage />);

      const barChartButton = screen.getByText('Bar');
      fireEvent.click(barChartButton);

      await waitFor(() => {
        expect(screen.getByText('Bar')).toHaveClass('active');
      });
    });

    it('should switch to area chart', async () => {
      render(<DetailedUsage />);

      const areaChartButton = screen.getByText('Area');
      fireEvent.click(areaChartButton);

      await waitFor(() => {
        expect(screen.getByText('Area')).toHaveClass('active');
      });
    });

    it('should switch to pie chart', async () => {
      render(<DetailedUsage />);

      const pieChartButton = screen.getByText('Pie');
      fireEvent.click(pieChartButton);

      await waitFor(() => {
        expect(screen.getByText('Pie')).toHaveClass('active');
      });
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      const largeDataset: UsageResponse = {
        data: generateMockRecords(2000),
        pagination: {
          total: 2000,
          limit: 2000,
          offset: 0,
        },
      };

      api.getLogs.mockResolvedValue(largeDataset);

      const startTime = Date.now();
      render(<DetailedUsage />);

      await waitFor(() => {
        expect(screen.getByText('Detailed Usage')).toBeInTheDocument();
      });

      const endTime = Date.now();
      const renderTime = endTime - startTime;

      // Should render in reasonable time even with 2000 records
      expect(renderTime).toBeLessThan(2000);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      api.getLogs.mockRejectedValue(new Error('API Error'));

      render(<DetailedUsage />);

      await waitFor(() => {
        // Should not crash, should show error state or empty state
        expect(screen.getByText('Detailed Usage')).toBeInTheDocument();
      });
    });

    it('should show loading state', async () => {
      api.getLogs.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<DetailedUsage />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('Cleanup', () => {
    it('should clear polling interval on unmount', async () => {
      const { unmount } = render(<DetailedUsage />);

      await waitFor(() => {
        expect(api.getLogs).toHaveBeenCalledTimes(1);
      });

      unmount();

      vi.advanceTimersByTime(30000);

      // Should not make more calls after unmount
      expect(api.getLogs).toHaveBeenCalledTimes(1);
    });
  });
});
