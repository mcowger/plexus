import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderPulseTable } from '../live/ProviderPulseTable';
import type { LiveProviderSnapshot } from '../../../../lib/api';

describe('ProviderPulseTable', () => {
  const mockProviders: LiveProviderSnapshot[] = [
    {
      provider: 'openai',
      requests: 100,
      successes: 95,
      errors: 5,
      successRate: 0.95,
      totalTokens: 50000,
      totalCost: 0.5,
      avgDurationMs: 500,
      avgTtftMs: 100,
      avgTokensPerSec: 200
    },
    {
      provider: 'anthropic',
      requests: 50,
      successes: 48,
      errors: 2,
      successRate: 0.96,
      totalTokens: 25000,
      totalCost: 0.25,
      avgDurationMs: 600,
      avgTtftMs: 150,
      avgTokensPerSec: 150
    }
  ];

  const mockPerformance = new Map([
    ['openai', { avgTtftMs: 100, avgTokensPerSec: 200 }],
    ['anthropic', { avgTtftMs: 150, avgTokensPerSec: 150 }]
  ]);

  it('renders empty state when no providers', () => {
    render(<ProviderPulseTable providers={[]} providerPerformance={new Map()} />);

    expect(screen.getByText(/No provider traffic/)).toBeInTheDocument();
  });

  it('renders provider data in table', () => {
    render(
      <ProviderPulseTable
        providers={mockProviders}
        providerPerformance={mockPerformance}
      />
    );

    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('limits rows to maxRows', () => {
    const manyProviders = Array.from({ length: 15 }, (_, i) => ({
      ...mockProviders[0],
      provider: `provider-${i}`
    }));

    render(
      <ProviderPulseTable
        providers={manyProviders}
        providerPerformance={new Map()}
        maxRows={8}
      />
    );

    // Should only show 8 rows
    const rows = screen.getAllByText(/provider-/);
    expect(rows.length).toBe(8);
  });

  it('shows performance data when available', () => {
    render(
      <ProviderPulseTable
        providers={mockProviders}
        providerPerformance={mockPerformance}
      />
    );

    expect(screen.getByText(/tok\/s/)).toBeInTheDocument();
  });

  it('shows dash when no performance data', () => {
    render(
      <ProviderPulseTable
        providers={mockProviders}
        providerPerformance={new Map()}
      />
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
