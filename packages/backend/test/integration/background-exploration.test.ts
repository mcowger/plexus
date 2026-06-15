import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../../src/services/router';
import { BackgroundExplorer } from '../../src/services/background-explorer';
import { ProbeService } from '../../src/services/probe-service';
import { CooldownManager } from '../../src/services/cooldown-manager';
import { SelectorFactory } from '../../src/services/selectors/factory';
import { UsageStorageService } from '../../src/services/usage-storage';
import { Dispatcher } from '../../src/services/dispatcher';
import { setConfigForTesting, PlexusConfig } from '../../src/config';

/**
 * Integration: live request → Router → BackgroundExplorer.maybeTrigger →
 * ProbeService.runProbe → Dispatcher.dispatch (mocked).
 *
 * Verifies that a live request flowing through the Router under
 * backgroundExploration.enabled=true causes background probes to fire for
 * stale targets in the resolved group, without affecting the live request's
 * own selection.
 */
describe('Background exploration integration', () => {
  const baseConfig: PlexusConfig = {
    providers: {
      p1: { enabled: true } as any,
      p2: { enabled: true } as any,
    } as any,
    models: {
      myalias: {
        target_groups: [
          {
            name: 'g1',
            selector: 'performance',
            targets: [
              { provider: 'p1', model: 'm1' },
              { provider: 'p2', model: 'm2' },
            ],
          },
        ],
      } as any,
    } as any,
    keys: {},
    failover: {
      enabled: false,
      retryableStatusCodes: [],
      retryableErrors: [],
    },
    quotas: [],
    backgroundExploration: {
      enabled: true,
      stalenessThresholdSeconds: 0,
      workerConcurrency: 2,
    },
  } as PlexusConfig;

  beforeEach(async () => {
    BackgroundExplorer.resetForTesting();
    CooldownManager.resetInstance();
    await CooldownManager.getInstance().clearCooldown();
    setConfigForTesting(baseConfig);

    // Make the performance selector deterministic: pick p1 (higher TPS).
    const mockUsageStorage = {
      getProviderPerformance: vi.fn(async (provider?: string) => {
        if (provider === 'p1')
          return [
            { target_model: 'm1', avg_tokens_per_sec: 100, sample_count: 10, last_updated: 1000 },
          ];
        if (provider === 'p2')
          return [
            { target_model: 'm2', avg_tokens_per_sec: 50, sample_count: 10, last_updated: 1000 },
          ];
        return [];
      }),
    } as unknown as UsageStorageService;
    SelectorFactory.setUsageStorage(mockUsageStorage);
  });

  afterEach(async () => {
    BackgroundExplorer.resetForTesting();
    await CooldownManager.getInstance().clearCooldown();
    CooldownManager.resetInstance();
  });

  test('live request triggers background probes for stale targets in the resolved group', async () => {
    const probeService = {
      runProbe: vi.fn(async () => ({
        success: true,
        durationMs: 5,
        apiType: 'chat' as const,
        response: 'ok',
      })),
    } as unknown as ProbeService;

    BackgroundExplorer.initialize(probeService);

    // Live request resolution — Router should pick p1 (best TPS) and also
    // fire maybeTrigger for the group.
    const candidates = await Router.resolveCandidates('myalias');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.provider).toBe('p1');
    expect(candidates[0]!.model).toBe('m1');

    // Allow background pump → cooldown checks → probe dispatch to complete.
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(probeService.runProbe).toHaveBeenCalledTimes(2);
    const calls = (probeService.runProbe as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'p1',
          model: 'm1',
          source: 'background',
          apiType: 'chat',
        }),
        expect.objectContaining({
          provider: 'p2',
          model: 'm2',
          source: 'background',
          apiType: 'chat',
        }),
      ])
    );
  });

  test('background exploration disabled → no probes fired', async () => {
    setConfigForTesting({
      ...baseConfig,
      backgroundExploration: {
        enabled: false,
        stalenessThresholdSeconds: 0,
        workerConcurrency: 2,
      },
    } as PlexusConfig);

    const probeService = {
      runProbe: vi.fn(async () => ({
        success: true,
        durationMs: 5,
        apiType: 'chat' as const,
      })),
    } as unknown as ProbeService;
    BackgroundExplorer.initialize(probeService);

    await Router.resolveCandidates('myalias');
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(probeService.runProbe).not.toHaveBeenCalled();
  });

  test('targets on cooldown are skipped by background probes', async () => {
    const probeService = {
      runProbe: vi.fn(async () => ({
        success: true,
        durationMs: 5,
        apiType: 'chat' as const,
      })),
    } as unknown as ProbeService;
    BackgroundExplorer.initialize(probeService);

    await CooldownManager.getInstance().markProviderFailure('p2', 'm2');

    await Router.resolveCandidates('myalias');
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const probedTargets = (probeService.runProbe as any).mock.calls.map(
      (c: any[]) => `${c[0].provider}/${c[0].model}`
    );
    expect(probedTargets).toContain('p1/m1');
    expect(probedTargets).not.toContain('p2/m2');
  });

  // Reference to Dispatcher kept so the test file documents the full
  // composition surface even though we mock ProbeService for isolation.
  test('ProbeService is constructible from Dispatcher + UsageStorageService', () => {
    const dispatcher = {} as unknown as Dispatcher;
    const usageStorage = {} as unknown as UsageStorageService;
    const svc = new ProbeService(dispatcher, usageStorage);
    expect(svc).toBeInstanceOf(ProbeService);
  });
});
