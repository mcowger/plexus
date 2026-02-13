import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveRequestList } from '../live/LiveRequestList';
import type { LiveRequestSnapshot } from '../../../../lib/api';

describe('LiveRequestList', () => {
  const mockRequests: LiveRequestSnapshot[] = [
    {
      requestId: 'req-1',
      date: new Date().toISOString(),
      provider: 'openai',
      model: 'gpt-4',
      responseStatus: 'success',
      totalTokens: 100,
      costTotal: 0.01,
      durationMs: 500,
      ttftMs: 100,
      tokensPerSec: 200
    },
    {
      requestId: 'req-2',
      date: new Date(Date.now() - 5000).toISOString(),
      provider: 'anthropic',
      model: 'claude-3',
      responseStatus: 'error',
      totalTokens: 50,
      costTotal: 0.005,
      durationMs: 1000,
      ttftMs: 200,
      tokensPerSec: 50
    }
  ];

  it('renders empty state when no requests', () => {
    render(<LiveRequestList requests={[]} />);

    expect(screen.getByText('No requests observed yet.')).toBeInTheDocument();
  });

  it('renders request items', () => {
    render(<LiveRequestList requests={mockRequests} />);

    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('limits items to maxItems', () => {
    const manyRequests = Array.from({ length: 25 }, (_, i) => ({
      ...mockRequests[0],
      requestId: `req-${i}`
    }));

    render(<LiveRequestList requests={manyRequests} maxItems={20} />);

    // Should only render 20 items
    const items = screen.getAllByText(/openai/);
    expect(items.length).toBe(20);
  });

  it('shows status badge for each request', () => {
    render(<LiveRequestList requests={mockRequests} />);

    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('displays request metrics', () => {
    render(<LiveRequestList requests={mockRequests} />);

    expect(screen.getByText(/Tokens:/)).toBeInTheDocument();
    expect(screen.getByText(/Cost:/)).toBeInTheDocument();
    expect(screen.getByText(/Latency:/)).toBeInTheDocument();
  });
});
