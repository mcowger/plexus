import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsLineChart } from '../usage/MetricsLineChart';
import type { UsageRecord } from '../../../../lib/api';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

const mockRecords: Partial<UsageRecord>[] = [
  {
    date: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
    tokensPerSec: 50,
    ttftMs: 150,
    durationMs: 2000
  },
  {
    date: new Date(Date.now() - 1000 * 60 * 3).toISOString(), // 3 minutes ago
    tokensPerSec: 75,
    ttftMs: 120,
    durationMs: 1800
  },
  {
    date: new Date(Date.now() - 1000 * 60 * 1).toISOString(), // 1 minute ago
    tokensPerSec: 60,
    ttftMs: 180,
    durationMs: 2200
  }
];

describe('MetricsLineChart', () => {
  it('renders loading state', () => {
    render(
      <MetricsLineChart
        records={[]}
        timeRange="hour"
        selectedMetrics={['tps', 'ttft', 'latency']}
        loading={true}
      />
    );

    expect(screen.getByText('Loading metrics...')).toBeInTheDocument();
  });

  it('renders empty state when no data', () => {
    render(
      <MetricsLineChart
        records={[]}
        timeRange="hour"
        selectedMetrics={['tps', 'ttft', 'latency']}
        loading={false}
      />
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders message when no metrics selected', () => {
    render(
      <MetricsLineChart
        records={mockRecords}
        timeRange="hour"
        selectedMetrics={[]}
        loading={false}
      />
    );

    expect(screen.getByText('Select at least one metric to display')).toBeInTheDocument();
  });

  it('renders chart with data', () => {
    render(
      <MetricsLineChart
        records={mockRecords}
        timeRange="hour"
        selectedMetrics={['tps', 'ttft', 'latency']}
        loading={false}
      />
    );

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('x-axis')).toBeInTheDocument();
    expect(screen.getByTestId('y-axis')).toBeInTheDocument();
    expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
  });

  it('respects height prop', () => {
    const { container } = render(
      <MetricsLineChart
        records={mockRecords}
        timeRange="hour"
        selectedMetrics={['tps']}
        loading={false}
        height={400}
      />
    );

    const wrapper = container.querySelector('div[style*="height"]');
    expect(wrapper).toHaveStyle({ height: '400px' });
  });
});
