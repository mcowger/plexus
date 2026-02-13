import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageDataTable } from '../usage/UsageDataTable';
import type { UsageDataRow } from '../usage/UsageDataTable';

describe('UsageDataTable', () => {
  const mockData: UsageDataRow[] = [
    { name: 'Provider A', requests: 100, tokens: 5000, cost: 0.5, duration: 500, ttft: 100 },
    { name: 'Provider B', requests: 50, tokens: 2500, cost: 0.25, duration: 600, ttft: 150 }
  ];

  it('renders empty state when no data', () => {
    render(<UsageDataTable data={[]} groupBy="provider" />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders table with correct headers', () => {
    render(<UsageDataTable data={mockData} groupBy="provider" />);

    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    render(<UsageDataTable data={mockData} groupBy="provider" />);

    expect(screen.getByText('Provider A')).toBeInTheDocument();
    expect(screen.getByText('Provider B')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('formats values correctly', () => {
    render(<UsageDataTable data={mockData} groupBy="provider" />);

    // Tokens should be formatted (e.g., 5K)
    expect(screen.getByText(/5K/)).toBeInTheDocument();
    // Cost should be formatted with $
    expect(screen.getAllByText(/\$/).length).toBeGreaterThan(0);
  });

  it('uses dynamic header based on groupBy', () => {
    const { rerender } = render(
      <UsageDataTable data={mockData} groupBy="model" />
    );

    expect(screen.getByText('Model')).toBeInTheDocument();

    rerender(<UsageDataTable data={mockData} groupBy="status" />);

    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
