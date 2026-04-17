import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LatencySelector } from '../latency';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget, PlexusConfig, setConfigForTesting } from '../../../config';

const makeConfig = (
  overrides: Partial<
    Pick<PlexusConfig, 'latencyExplorationRate' | 'performanceExplorationRate'>
  > = {}
): PlexusConfig => ({
  providers: {},
  models: {},
  keys: {},
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
  performanceExplorationRate: 0,
  ...overrides,
});

describe('LatencySelector', () => {
  // Mock usage storage
  // Explicitly type the mock return to allow any array of objects
  const mockGetProviderPerformance = vi.fn(
    (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
  );
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance,
  } as unknown as UsageStorageService;

  const selector = new LatencySelector(mockStorage);

  beforeEach(() => {
    setConfigForTesting(makeConfig());
    mockGetProviderPerformance.mockReset();
    mockGetProviderPerformance.mockImplementation(
      (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
    );
  });

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
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    setConfigForTesting(
      makeConfig({
        latencyExplorationRate: 1,
        performanceExplorationRate: 0.05,
      })
    );

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      const selected = await selector.select(targets);
      expect(selected).toEqual(targets[0]!);

      Math.random = () => 0.999999;
      const explored = await selector.select(targets);
      expect(explored).toEqual(targets[1]!);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should use performanceExplorationRate as fallback when latencyExplorationRate is not set', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]);
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    setConfigForTesting(
      makeConfig({
        latencyExplorationRate: undefined,
        performanceExplorationRate: 1,
      })
    );

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      const selected = await selector.select(targets);
      expect(selected).toEqual(targets[0]!);

      Math.random = () => 0.999999;
      const explored = await selector.select(targets);
      expect(explored).toEqual(targets[1]!);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should always select fastest when both exploration rates are 0', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1') return Promise.resolve([{ avg_ttft_ms: 50 }]); // Fastest
      if (provider === 'p2') return Promise.resolve([{ avg_ttft_ms: 100 }]);
      return Promise.resolve([]);
    });

    setConfigForTesting(
      makeConfig({
        latencyExplorationRate: 0,
        performanceExplorationRate: 0,
      })
    );

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
