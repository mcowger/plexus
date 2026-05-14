import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceSelector } from '../performance';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget, setConfigForTesting, PlexusConfig } from '../../../config';

const makeConfig = (performanceExplorationRate = 0): PlexusConfig => ({
  providers: {},
  models: {},
  keys: {},
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
  performanceExplorationRate,
});

describe('PerformanceSelector', () => {
  // Mock usage storage
  // Explicitly type the mock return to allow any array of objects
  const mockGetProviderPerformance = vi.fn(
    (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
  );
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance,
  } as unknown as UsageStorageService;

  const selector = new PerformanceSelector(mockStorage);

  beforeEach(() => {
    setConfigForTesting(makeConfig(0));
    mockGetProviderPerformance.mockReset();
    mockGetProviderPerformance.mockImplementation(
      (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
    );
  });

  it('should return null for empty targets', async () => {
    expect(await selector.select([])).toBeNull();
  });

  it('should return single target if only one exists', async () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(await selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select fastest target based on avg_tokens_per_sec', async () => {
    setConfigForTesting(makeConfig(0));

    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1')
        return Promise.resolve([{ target_model: 'm1', avg_tokens_per_sec: 10 }]);
      if (provider === 'p2')
        return Promise.resolve([{ target_model: 'm2', avg_tokens_per_sec: 50 }]); // Fastest
      if (provider === 'p3')
        return Promise.resolve([{ target_model: 'm3', avg_tokens_per_sec: 20 }]);
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 is fastest
  });

  it('should handle targets with no performance data (0 tps)', async () => {
    mockGetProviderPerformance.mockImplementation((provider, model) => {
      if (provider === 'p1')
        return Promise.resolve([{ target_model: 'm1', avg_tokens_per_sec: 10 }]);
      if (provider === 'p2') return Promise.resolve([]); // No data -> 0
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!); // p1 has data
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

  describe('Exploration rate feature', () => {
    it('should not explore when exploration rate is 0', async () => {
      setConfigForTesting(makeConfig(0));

      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1')
          return Promise.resolve([{ target_model: 'm1', avg_tokens_per_sec: 100 }]); // Fastest
        if (provider === 'p2')
          return Promise.resolve([{ target_model: 'm2', avg_tokens_per_sec: 50 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ];

      // Run multiple times to ensure consistency
      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).toEqual(targets[0]!); // Always selects fastest
      }
    });

    it('should explore unseen targets first when exploration rate is 1', async () => {
      setConfigForTesting(makeConfig(1));

      // p1 and p2 have data; p3 has no data yet
      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1')
          return Promise.resolve([
            { target_model: 'm1', avg_tokens_per_sec: 100, sample_count: 10, last_updated: 1000 },
          ]);
        if (provider === 'p2')
          return Promise.resolve([
            { target_model: 'm2', avg_tokens_per_sec: 50, sample_count: 10, last_updated: 2000 },
          ]);
        if (provider === 'p3') return Promise.resolve([]); // No data
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
      ];

      // With rate=1, exploration always fires; p3 has no data so it should always be picked
      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).toEqual(targets[2]!); // p3 has no data, always explored first
      }
    });

    it('should use default 0.05 exploration rate when not configured', async () => {
      const config: PlexusConfig = {
        ...makeConfig(0),
        performanceExplorationRate: undefined,
      };
      setConfigForTesting(config);

      // p1 has recent data; p2 has older data (stalest, should be explored)
      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1')
          return Promise.resolve([
            { target_model: 'm1', avg_tokens_per_sec: 100, sample_count: 5, last_updated: 2000 },
          ]); // Fastest
        if (provider === 'p2')
          return Promise.resolve([
            { target_model: 'm2', avg_tokens_per_sec: 50, sample_count: 5, last_updated: 1000 },
          ]); // Stalest
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ];

      const originalRandom = Math.random;
      try {
        // Explore path: 0.01 < 0.05, should pick stalest target (p2)
        Math.random = () => 0.01;
        const explored = await selector.select(targets);
        expect(explored).toEqual(targets[1]!); // p2 is stalest

        // Non-explore path: 0.99 >= 0.05, should pick best target
        Math.random = () => 0.99;
        const nonExplored = await selector.select(targets);
        expect(nonExplored).toEqual(targets[0]!);
      } finally {
        Math.random = originalRandom;
      }
    });

    it('suppresses inline exploration when backgroundExploration.enabled is true', async () => {
      // Even with a guaranteed-to-fire explorationRate, background mode must
      // make the selector deterministically pick the best target.
      setConfigForTesting({
        ...makeConfig(1),
        backgroundExploration: {
          enabled: true,
          stalenessThresholdSeconds: 600,
          workerConcurrency: 2,
        },
      } as PlexusConfig);

      mockGetProviderPerformance.mockImplementation((provider) => {
        if (provider === 'p1')
          return Promise.resolve([
            { target_model: 'm1', avg_tokens_per_sec: 100, sample_count: 10, last_updated: 1000 },
          ]);
        if (provider === 'p2')
          return Promise.resolve([
            { target_model: 'm2', avg_tokens_per_sec: 50, sample_count: 10, last_updated: 2000 },
          ]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ];

      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).toEqual(targets[0]!);
      }
    });
  });
});
