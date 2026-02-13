import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricToggleGroup } from '../usage/MetricToggleGroup';

describe('MetricToggleGroup', () => {
  const mockMetrics = [
    { key: 'requests', label: 'Requests', color: '#3b82f6' },
    { key: 'tokens', label: 'Tokens', color: '#10b981' },
    { key: 'cost', label: 'Cost', color: '#f59e0b' }
  ];

  it('renders all metric buttons', () => {
    render(
      <MetricToggleGroup
        metrics={mockMetrics}
        selected={['requests']}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('shows selected metrics as active', () => {
    const { container } = render(
      <MetricToggleGroup
        metrics={mockMetrics}
        selected={['requests', 'cost']}
        onToggle={() => {}}
      />
    );

    const requestsButton = screen.getByText('Requests');
    const tokensButton = screen.getByText('Tokens');

    expect(requestsButton).toHaveClass('bg-primary');
    expect(tokensButton).not.toHaveClass('bg-primary');
  });

  it('calls onToggle when button clicked', () => {
    const onToggle = vi.fn();
    render(
      <MetricToggleGroup
        metrics={mockMetrics}
        selected={['requests']}
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByText('Tokens'));
    expect(onToggle).toHaveBeenCalledWith('tokens');
  });

  it('has correct label', () => {
    render(
      <MetricToggleGroup
        metrics={mockMetrics}
        selected={[]}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText('Metrics')).toBeInTheDocument();
  });
});
