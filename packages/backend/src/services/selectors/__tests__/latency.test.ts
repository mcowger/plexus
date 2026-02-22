import { describe, expect, it, mock } from 'bun:test';
import { LatencySelector } from '../latency';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget } from '../../../config';

describe('LatencySelector', () => {
  // Mock usage storage
  // Explicitly type the mock return to allow any array of objects
  const mockGetProviderPerformance = mock(
    (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
  );
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance,
  } as unknown as UsageStorageService;

  const selector = new LatencySelector(mockStorage);

  it('should return null for empty targets', async () => {
    expect(await selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', async () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(await selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select the fastest target based on avg_ttft_ms (lowest is best)', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 50 }]); // Fastest latency
      if (provider === 'p3') return Promise.resolve([{ avg_ttft_ms: 200 }]);
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 is fastest (lowest TTFT)
  });

  it('should prefer targets with data over targets with no data', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      if (provider === 'p2') return Promise.resolve([]); // No data -> Infinity
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!); // p1 has data, so it wins
  });

  it('should handle all targets having no data (first one wins)', async () => {
    mockGetProviderPerformance.mockImplementation(() => Promise.resolve([]));

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!);
  });

  it('should explore alternative providers when latencyExplorationRate is set', async () => {
    // Set up performance data where p1 is fastest
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    // Mock config to set exploration rate to 100% for deterministic testing
    const mockConfig = {
      latencyExplorationRate: 1.0,
      performanceExplorationRate: 0.05,
    } as any;

    // Temporarily set config for testing
    const { setConfigForTesting } = require('../../../config');
    setConfigForTesting(mockConfig);

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    // With 100% exploration, we should randomly select between p1 and p2
    // Run multiple times to ensure randomness
    const selections = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const selected = await selector.select(targets);
      if (selected) {
        selections.add(selected.provider);
      }
    }

    // With 100% exploration rate over 50 iterations, we should see both providers selected
    expect(selections.has('p1')).toBe(true);
    expect(selections.has('p2')).toBe(true);
  });

  it('should use performanceExplorationRate as fallback when latencyExplorationRate is not set', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    // Mock config with only performanceExplorationRate
    const mockConfig = {
      latencyExplorationRate: undefined,
      performanceExplorationRate: 1.0,
    } as any;

    const { setConfigForTesting } = require('../../../config');
    setConfigForTesting(mockConfig);

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const selections = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const selected = await selector.select(targets);
      if (selected) {
        selections.add(selected.provider);
      }
    }

    expect(selections.has('p1')).toBe(true);
    expect(selections.has('p2')).toBe(true);
  });

  it('should always select fastest when both exploration rates are 0', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]); // Fastest
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    const mockConfig = {
      latencyExplorationRate: 0,
      performanceExplorationRate: 0,
    } as any;

    const { setConfigForTesting } = require('../../../config');
    setConfigForTesting(mockConfig);

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    // Run multiple times to ensure consistency
    for (let i = 0; i < 20; i++) {
      const selected = await selector.select(targets);
      expect(selected?.provider).toBe('p1');
    }
  });
});
