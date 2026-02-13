import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProviderPerformance } from '../useProviderPerformance';
import { api } from '../../../../lib/api';

// Mock the API module
vi.mock('../../../../lib/api', () => ({
  api: {
    getProviderPerformance: vi.fn(),
  },
}));

describe('useProviderPerformance', () => {
  const mockPerformance = [
    {
      provider: 'openai',
      model: 'gpt-4',
      avg_ttft_ms: 100,
      min_ttft_ms: 50,
      max_ttft_ms: 200,
      avg_tokens_per_sec: 50,
      min_tokens_per_sec: 30,
      max_tokens_per_sec: 80,
      sample_count: 10,
      last_updated: Date.now(),
    },
    {
      provider: 'anthropic',
      model: 'claude-3',
      avg_ttft_ms: 150,
      min_ttft_ms: 100,
      max_ttft_ms: 250,
      avg_tokens_per_sec: 40,
      min_tokens_per_sec: 20,
      max_tokens_per_sec: 60,
      sample_count: 5,
      last_updated: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fetch provider performance on mount', async () => {
    vi.mocked(api.getProviderPerformance).mockResolvedValue(mockPerformance);

    const { result } = renderHook(() => useProviderPerformance());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.performance).toHaveLength(2);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should pass model and provider filters to API', async () => {
    vi.mocked(api.getProviderPerformance).mockResolvedValue([]);

    renderHook(() => useProviderPerformance({ model: 'gpt-4', provider: 'openai' }));

    await waitFor(() => {
      expect(api.getProviderPerformance).toHaveBeenCalledWith('gpt-4', 'openai');
    });
  });

  it('should compute byProvider map correctly', async () => {
    vi.mocked(api.getProviderPerformance).mockResolvedValue(mockPerformance);

    const { result } = renderHook(() => useProviderPerformance());

    await waitFor(() => {
      expect(result.current.byProvider.size).toBe(2);
    });

    const openaiMetrics = result.current.byProvider.get('openai');
    expect(openaiMetrics?.avgTtftMs).toBe(100);
    expect(openaiMetrics?.avgTokensPerSec).toBe(50);

    const anthropicMetrics = result.current.byProvider.get('anthropic');
    expect(anthropicMetrics?.avgTtftMs).toBe(150);
    expect(anthropicMetrics?.avgTokensPerSec).toBe(40);
  });

  it('should handle errors', async () => {
    vi.mocked(api.getProviderPerformance).mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useProviderPerformance());

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.performance).toEqual([]);
    expect(result.current.byProvider.size).toBe(0);
  });

  it('should poll at specified interval', async () => {
    vi.mocked(api.getProviderPerformance).mockResolvedValue([]);

    renderHook(() => useProviderPerformance({ pollInterval: 5000 }));

    await waitFor(() => {
      expect(api.getProviderPerformance).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(api.getProviderPerformance).toHaveBeenCalledTimes(2);
    });
  });
});
