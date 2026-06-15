import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { BackgroundExplorer } from '../background-explorer';
import { ProbeService } from '../probe-service';
import { CooldownManager } from '../cooldown-manager';
import { setConfigForTesting, ModelTargetGroup } from '../../config';

function makeGroup(
  selector: ModelTargetGroup['selector'],
  targets: Array<{ provider: string; model: string; enabled?: boolean }>
): ModelTargetGroup {
  return {
    name: 'g',
    selector,
    targets,
  } as ModelTargetGroup;
}

function makeProbeService() {
  return {
    runProbe: vi.fn(async () => ({
      success: true,
      durationMs: 5,
      apiType: 'chat' as const,
      response: 'ok',
    })),
  } as unknown as ProbeService;
}

function setBaseConfig(opts: {
  enabled: boolean;
  stalenessThresholdSeconds?: number;
  workerConcurrency?: number;
  providers?: Record<string, { enabled?: boolean }>;
}) {
  setConfigForTesting({
    providers: (opts.providers ?? {
      p1: { enabled: true },
      p2: { enabled: true },
    }) as any,
    models: {},
    keys: {},
    failover: {
      enabled: false,
      retryableStatusCodes: [],
      retryableErrors: [],
    },
    quotas: [],
    backgroundExploration: {
      enabled: opts.enabled,
      stalenessThresholdSeconds: opts.stalenessThresholdSeconds ?? 1,
      workerConcurrency: opts.workerConcurrency ?? 2,
    },
  } as any);
}

async function flushPromises(): Promise<void> {
  // Drain microtasks several times to allow chained .then() handlers (cooldown
  // check → enqueue → worker pump → probe → state update) to all run.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('BackgroundExplorer', () => {
  beforeEach(async () => {
    BackgroundExplorer.resetForTesting();
    CooldownManager.resetInstance();
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    BackgroundExplorer.resetForTesting();
    await CooldownManager.getInstance().clearCooldown();
    CooldownManager.resetInstance();
  });

  test('maybeTrigger is a no-op when config is disabled', async () => {
    setBaseConfig({ enabled: false });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(makeGroup('latency', [{ provider: 'p1', model: 'm1' }]));
    await flushPromises();

    expect(probe.runProbe).not.toHaveBeenCalled();
  });

  test('maybeTrigger is a no-op for non-performance selectors', async () => {
    setBaseConfig({ enabled: true });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(makeGroup('random', [{ provider: 'p1', model: 'm1' }]));
    explorer.maybeTrigger(makeGroup('cost', [{ provider: 'p1', model: 'm1' }]));
    explorer.maybeTrigger(makeGroup('in_order', [{ provider: 'p1', model: 'm1' }]));
    await flushPromises();

    expect(probe.runProbe).not.toHaveBeenCalled();
  });

  test('does not probe within the staleness window after process start', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 1000 });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(makeGroup('latency', [{ provider: 'p1', model: 'm1' }]));
    await flushPromises();

    expect(probe.runProbe).not.toHaveBeenCalled();
  });

  test('probes stale healthy targets', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 0 });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(
      makeGroup('performance', [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ])
    );
    await flushPromises();

    expect(probe.runProbe).toHaveBeenCalledTimes(2);
    const calls = (probe.runProbe as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'p1',
          model: 'm1',
          apiType: 'chat',
          source: 'background',
        }),
        expect.objectContaining({
          provider: 'p2',
          model: 'm2',
          apiType: 'chat',
          source: 'background',
        }),
      ])
    );
  });

  test('skips targets that are on cooldown', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 0 });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    // Put p1 on cooldown
    await CooldownManager.getInstance().markProviderFailure('p1', 'm1');

    explorer.maybeTrigger(
      makeGroup('latency', [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ])
    );
    await flushPromises();

    const calls = (probe.runProbe as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: 'p2', model: 'm2' });
  });

  test('skips disabled targets and disabled providers', async () => {
    setBaseConfig({
      enabled: true,
      stalenessThresholdSeconds: 0,
      providers: {
        p1: { enabled: true },
        p2: { enabled: false },
      },
    });
    const probe = makeProbeService();
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(
      makeGroup('latency', [
        { provider: 'p1', model: 'm1', enabled: false },
        { provider: 'p2', model: 'm2' },
      ])
    );
    await flushPromises();

    expect(probe.runProbe).not.toHaveBeenCalled();
  });

  test('does not re-probe a target whose probe is still in flight', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 0 });

    let resolveProbe: () => void = () => {};
    const probe = {
      runProbe: vi.fn(
        () =>
          new Promise<any>((resolve) => {
            resolveProbe = () =>
              resolve({
                success: true,
                durationMs: 5,
                apiType: 'chat',
                response: 'ok',
              });
          })
      ),
    } as unknown as ProbeService;
    const explorer = BackgroundExplorer.initialize(probe);

    const group = makeGroup('latency', [{ provider: 'p1', model: 'm1' }]);

    explorer.maybeTrigger(group);
    await flushPromises();
    // Probe is in flight, second trigger must not enqueue another.
    explorer.maybeTrigger(group);
    await flushPromises();

    expect(probe.runProbe).toHaveBeenCalledTimes(1);

    resolveProbe();
    await flushPromises();
  });

  test('updates lastProbedAt on both success and failure', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 1 });

    const probe = {
      runProbe: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          durationMs: 5,
          apiType: 'chat',
          error: 'fail',
        })
        .mockResolvedValueOnce({
          success: true,
          durationMs: 5,
          apiType: 'chat',
          response: 'ok',
        }),
    } as unknown as ProbeService;
    const explorer = BackgroundExplorer.initialize(probe);

    const group = makeGroup('latency', [{ provider: 'p1', model: 'm1' }]);

    // First trigger after staleness threshold elapses.
    await new Promise((r) => setTimeout(r, 1100));
    explorer.maybeTrigger(group);
    await flushPromises();
    expect(probe.runProbe).toHaveBeenCalledTimes(1);

    // Immediately re-triggering should be skipped (lastProbedAt was just updated).
    explorer.maybeTrigger(group);
    await flushPromises();
    expect(probe.runProbe).toHaveBeenCalledTimes(1);

    // Wait past the staleness window again; next trigger should fire.
    await new Promise((r) => setTimeout(r, 1100));
    explorer.maybeTrigger(group);
    await flushPromises();
    expect(probe.runProbe).toHaveBeenCalledTimes(2);
  }, 10_000);

  test('thrown probe errors are swallowed and do not break the worker', async () => {
    setBaseConfig({ enabled: true, stalenessThresholdSeconds: 0 });

    const probe = {
      runProbe: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
        success: true,
        durationMs: 5,
        apiType: 'chat',
        response: 'ok',
      }),
    } as unknown as ProbeService;
    const explorer = BackgroundExplorer.initialize(probe);

    explorer.maybeTrigger(
      makeGroup('latency', [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
      ])
    );
    await flushPromises();

    expect(probe.runProbe).toHaveBeenCalledTimes(2);
  });
});
