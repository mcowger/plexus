import { describe, expect, it, mock } from 'bun:test';
import { PerformanceSelector } from '../performance';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget } from '../../../config';

describe('PerformanceSelector', () => {
  // Mock usage storage
  // Explicitly type the mock return to allow any array of objects
  const mockGetProviderPerformance = mock((provider?: string, model?: string): Promise<any[]> => Promise.resolve([]));
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance
  } as unknown as UsageStorageService;

  const selector = new PerformanceSelector(mockStorage);

  it('should return null for empty targets', async () => {
    expect(await selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', async () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(await selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select the fastest target based on avg_tokens_per_sec', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_tokens_per_sec: 10 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_tokens_per_sec: 50 }]); // Fastest
      if (provider === 'p3') return Promise.resolve([{ avg_tokens_per_sec: 20 }]);
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' }
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 is fastest
  });

  it('should handle targets with no performance data (0 tps)', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_tokens_per_sec: 10 }]);
      if (provider === 'p2') return Promise.resolve([]); // No data -> 0
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' }
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!); // p1 has data
  });
  
  it('should handle all targets having no data (first one wins)', async () => {
      mockGetProviderPerformance.mockImplementation(() => Promise.resolve([]));
      
      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' }
      ];
  
      const selected = await selector.select(targets);
      expect(selected).toEqual(targets[0]!);
  });
});
