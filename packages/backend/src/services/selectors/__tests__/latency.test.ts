import { describe, expect, it, mock } from 'bun:test';
import { LatencySelector } from '../latency';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget } from '../../../config';

describe('LatencySelector', () => {
  // Mock usage storage
  // Explicitly type the mock return to allow any array of objects
  const mockGetProviderPerformance = mock((provider?: string, model?: string): any[] => []);
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance
  } as unknown as UsageStorageService;

  const selector = new LatencySelector(mockStorage);

  it('should return null for empty targets', () => {
    expect(selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select the fastest target based on avg_ttft_ms (lowest is best)', () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return [{ avg_ttft_ms: 100 }];
      if (provider === 'p2') return [{ avg_ttft_ms: 50 }]; // Fastest latency
      if (provider === 'p3') return [{ avg_ttft_ms: 200 }];
      return [];
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' }
    ];

    const selected = selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 is fastest (lowest TTFT)
  });

  it('should prefer targets with data over targets with no data', () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return [{ avg_ttft_ms: 100 }];
      if (provider === 'p2') return []; // No data -> Infinity
      return [];
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' }
    ];

    const selected = selector.select(targets);
    expect(selected).toEqual(targets[0]!); // p1 has data, so it wins
  });
  
  it('should handle all targets having no data (first one wins)', () => {
      mockGetProviderPerformance.mockImplementation(() => []);
      
      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' }
      ];
  
      const selected = selector.select(targets);
      expect(selected).toEqual(targets[0]!);
  });
});
