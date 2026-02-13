import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderHealthCard } from '../metrics/ProviderHealthCard';

describe('ProviderHealthCard', () => {
  it('renders provider name and stats', () => {
    render(
      <ProviderHealthCard
        provider="openai"
        requests={100}
        errors={2}
        avgTokensPerSec={50}
      />
    );

    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('requests')).toBeInTheDocument();
  });

  it('shows healthy status for low error rate', () => {
    const { container } = render(
      <ProviderHealthCard
        provider="openai"
        requests={100}
        errors={2}
        avgTokensPerSec={50}
      />
    );

    // 2% error rate should show healthy indicator
    const indicator = container.querySelector('.bg-success');
    expect(indicator).toBeInTheDocument();
  });

  it('shows warning status for high error rate', () => {
    const { container } = render(
      <ProviderHealthCard
        provider="openai"
        requests={100}
        errors={10}
        avgTokensPerSec={50}
      />
    );

    // 10% error rate should show warning indicator
    const indicator = container.querySelector('.bg-warning');
    expect(indicator).toBeInTheDocument();
  });

  it('handles zero requests', () => {
    render(
      <ProviderHealthCard
        provider="test"
        requests={0}
        errors={0}
        avgTokensPerSec={0}
      />
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('formats tokens per second', () => {
    render(
      <ProviderHealthCard
        provider="openai"
        requests={100}
        errors={0}
        avgTokensPerSec={1234}
      />
    );

    // Should show formatted TPS
    expect(screen.getByText(/1\.2k/i)).toBeInTheDocument();
  });
});
