import { beforeEach, describe, expect, it, vi } from 'vitest';
import { E2EPerformanceSelector } from '../e2e-performance';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget, setConfigForTesting, PlexusConfig } from '../../../config';

const makeConfig = (
  performanceExplorationRate = 0,
  e2ePerformanceExplorationRate?: number
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
  performanceExplorationRate,
  e2ePerformanceExplorationRate,
});

describe('E2EPerformanceSelector', () => {
  const mockGetProviderPerformance = vi.fn(
    (provider?: string, model?: string): Promise<any[]> => Promise.resolve([])
  );
  const mockStorage = {
    getProviderPerformance: mockGetProviderPerformance,
  } as unknown as UsageStorageService;

  const selector = new E2EPerformanceSelector(mockStorage);

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
    expect(await selector.select(targets)).toEqual(targets[0] ?? null);
  });

  it('should select target with highest avg_e2e_tokens_per_sec', async () => {
    setConfigForTesting(makeConfig(0));

    mockGetProviderPerformance.mockImplementation((provider) => {
      if (provider === 'p1')
        return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 15 }]);
      if (provider === 'p2')
        return Promise.resolve([{ target_model: 'm2', avg_e2e_tokens_per_sec: 40 }]); // Best
      if (provider === 'p3')
        return Promise.resolve([{ target_model: 'm3', avg_e2e_tokens_per_sec: 25 }]);
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 has highest E2E TPS
  });

  it('should prefer target with data over target with no data', async () => {
    mockGetProviderPerformance.mockImplementation((provider) => {
      if (provider === 'p1')
        return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 20 }]);
      if (provider === 'p2') return Promise.resolve([]); // No data -> 0
      return Promise.resolve([]);
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!);
  });

  it('should fall back to first target when all have no data', async () => {
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
      setConfigForTesting(makeConfig(0, 0));

      mockGetProviderPerformance.mockImplementation((provider) => {
        if (provider === 'p1')
          return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 100 }]); // Best
        if (provider === 'p2')
          return Promise.resolve([{ target_model: 'm2', avg_e2e_tokens_per_sec: 50 }]);
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

    it('should explore all candidates (including best) when exploration rate is 1', async () => {
      setConfigForTesting(makeConfig(0, 1));

      mockGetProviderPerformance.mockImplementation((provider) => {
        if (provider === 'p1')
          return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 100 }]); // Best
        if (provider === 'p2')
          return Promise.resolve([{ target_model: 'm2', avg_e2e_tokens_per_sec: 50 }]);
        if (provider === 'p3')
          return Promise.resolve([{ target_model: 'm3', avg_e2e_tokens_per_sec: 25 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
      ];

      // With rate=1, any candidate can be picked (including the best)
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const selected = await selector.select(targets);
        seen.add(selected!.provider);
      }
      // All three providers should appear in the exploration pool
      expect(seen.has('p1')).toBe(true);
      expect(seen.has('p2')).toBe(true);
      expect(seen.has('p3')).toBe(true);
    });

    it('should prefer e2ePerformanceExplorationRate over performanceExplorationRate', async () => {
      // e2ePerformanceExplorationRate=0 overrides performanceExplorationRate=1
      setConfigForTesting(makeConfig(1, 0));

      mockGetProviderPerformance.mockImplementation((provider) => {
        if (provider === 'p1')
          return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 100 }]); // Best
        if (provider === 'p2')
          return Promise.resolve([{ target_model: 'm2', avg_e2e_tokens_per_sec: 50 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ];

      for (let i = 0; i < 10; i++) {
        const selected = await selector.select(targets);
        expect(selected).toEqual(targets[0]!); // Always best, no exploration
      }
    });

    it('should fall back to performanceExplorationRate when e2ePerformanceExplorationRate is unset', async () => {
      const config: PlexusConfig = {
        ...makeConfig(0),
        performanceExplorationRate: undefined,
        e2ePerformanceExplorationRate: undefined,
      };
      setConfigForTesting(config);

      mockGetProviderPerformance.mockImplementation((provider) => {
        if (provider === 'p1')
          return Promise.resolve([{ target_model: 'm1', avg_e2e_tokens_per_sec: 100 }]); // Best
        if (provider === 'p2')
          return Promise.resolve([{ target_model: 'm2', avg_e2e_tokens_per_sec: 50 }]);
        return Promise.resolve([]);
      });

      const targets: ModelTarget[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ];

      const originalRandom = Math.random;
      try {
        // 0.01 < 0.05 default → explore (can pick any candidate)
        Math.random = () => 0.01;
        const explored = await selector.select(targets);
        expect([targets[0]!, targets[1]!]).toContain(explored);

        // 0.99 >= 0.05 → pick best
        Math.random = () => 0.99;
        const nonExplored = await selector.select(targets);
        expect(nonExplored).toEqual(targets[0]!);
      } finally {
        Math.random = originalRandom;
      }
    });
  });
});
