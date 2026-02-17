import { describe, expect, it, mock } from 'bun:test';
import { PerformanceSelector } from '../performance';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget, setConfigForTesting, PlexusConfig } from '../../../config';

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

  it('should return single target if only one exists', async () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(await selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select fastest target based on avg_tokens_per_sec', async () => {
    const config: PlexusConfig = {
      providers: {},
      models: {},
      keys: {},
      adminKey: 'test',
      failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
      quotas: [],
      performanceExplorationRate: 0,
    };
    setConfigForTesting(config);

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

  describe('Exploration rate feature', () => {
    it('should not explore when exploration rate is 0', async () => {
      const config: PlexusConfig = {
        providers: {},
        models: {},
        keys: {},
        adminKey: 'test',
        failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
        quotas: [],
        performanceExplorationRate: 0,
      };
      setConfigForTesting(config);

      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1') return Promise.resolve([{ avg_tokens_per_sec: 100 }]); // Fastest
        if (provider === 'p2') return Promise.resolve([{ avg_tokens_per_sec: 50 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' }
      ];

      // Run multiple times to ensure consistency
      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).toEqual(targets[0]!); // Always selects fastest
      }
    });

    it('should explore non-best targets when exploration rate is 1', async () => {
      const config: PlexusConfig = {
        providers: {},
        models: {},
        keys: {},
        adminKey: 'test',
        failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
        quotas: [],
        performanceExplorationRate: 1,
      };
      setConfigForTesting(config);

      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1') return Promise.resolve([{ avg_tokens_per_sec: 100 }]); // Fastest
        if (provider === 'p2') return Promise.resolve([{ avg_tokens_per_sec: 50 }]);
        if (provider === 'p3') return Promise.resolve([{ avg_tokens_per_sec: 25 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' }
      ];

      // With rate=1, should never select fastest (p1)
      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).not.toEqual(targets[0]!); // Never selects p1
        expect([targets[1]!, targets[2]!]).toContain(selected!); // Always selects p2 or p3
      }
    });

    it('should use default 0.05 exploration rate when not configured', async () => {
      const config: PlexusConfig = {
        providers: {},
        models: {},
        keys: {},
        adminKey: 'test',
        failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
        quotas: [],
      };
      setConfigForTesting(config);

      mockGetProviderPerformance.mockImplementation((provider, model) => {
        if (provider === 'p1') return Promise.resolve([{ avg_tokens_per_sec: 100 }]); // Fastest
        if (provider === 'p2') return Promise.resolve([{ avg_tokens_per_sec: 50 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' }
      ];

      // Deterministic assertions for default exploration behavior (0.05)
      const originalRandom = Math.random;
      try {
        // Explore path: 0.01 < 0.05, should pick non-best target
        Math.random = () => 0.01;
        const explored = await selector.select(targets);
        expect(explored).toEqual(targets[1]!);

        // Non-explore path: 0.99 >= 0.05, should pick best target
        Math.random = () => 0.99;
        const nonExplored = await selector.select(targets);
        expect(nonExplored).toEqual(targets[0]!);
      } finally {
        Math.random = originalRandom;
      }
    });
  });
});
