import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { ResponsesStorageService } from '../../responses/responses-storage';
import { ConfigService } from '../../configuration/config-service';
import { ConfigRepository } from '../../../db/config-repository';
import { BackgroundExplorer } from '../../routing/background-explorer';
import { CooldownManager } from '../cooldown-manager';
import type { ProbeService } from '../../probes/probe-service';
import { setConfigForTesting, type ModelTargetGroup } from '../../../config';

beforeEach(() => BackgroundExplorer.resetForTesting());
afterEach(() => vi.useRealTimers());

describe('background drain', () => {
  test('waits for response cleanup and never schedules another sweep', async () => {
    vi.useFakeTimers();
    const storage = new ResponsesStorageService();
    const sweep = Promise.withResolvers<{
      deletedResponses: number;
      deletedItems: number;
      deletedConversations: number;
    }>();
    const cleanup = registerSpy(storage, 'cleanupOldResponses').mockReturnValue(sweep.promise);
    storage.startCleanupJob(1, 7);
    let drained = false;
    const draining = storage.shutdown().then(() => {
      drained = true;
    });
    storage.startCleanupJob(1, 7);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(drained).toBe(false);
    sweep.resolve({ deletedResponses: 1, deletedItems: 1, deletedConversations: 1 });
    await draining;
  });

  test('keeps persisted config changes without restarting cache refresh during shutdown', async () => {
    vi.useFakeTimers();
    const repo = new ConfigRepository();
    const save = registerSpy(repo, 'setSetting').mockResolvedValue(undefined);
    const load = registerSpy(repo, 'getAllProviders').mockResolvedValue([]);
    const config = new ConfigService(repo);
    await config.setSetting('test', 1);
    await config.shutdown();
    // An already-admitted request may finish its write after shutdown begins.
    await config.setSetting('test', 2);
    await config.flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();
  });

  test('drains an active probe but discards queued targets', async () => {
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const runProbe = vi.fn(async () => {
      started.resolve();
      await finished.promise;
      return { success: true, durationMs: 1, apiType: 'chat', response: 'ok' };
    });
    registerSpy(CooldownManager.getInstance(), 'isProviderHealthy').mockResolvedValue(true);
    setConfigForTesting({
      providers: {
        p: { api_base_url: 'https://example.test', api_key: 'test', models: ['one', 'two'] },
      },
      models: {},
      keys: {},
      quotas: [],
      backgroundExploration: { enabled: true, stalenessThresholdSeconds: 0, workerConcurrency: 1 },
    } as any);
    const explorer = BackgroundExplorer.initialize({ runProbe } as unknown as ProbeService);
    const group = {
      name: 'test',
      selector: 'latency',
      targets: [
        { provider: 'p', model: 'one' },
        { provider: 'p', model: 'two' },
      ],
    } as ModelTargetGroup;
    explorer.maybeTrigger(group);
    await started.promise;
    let drained = false;
    const draining = explorer.shutdown().then(() => {
      drained = true;
    });
    explorer.maybeTrigger(group);
    await Promise.resolve();
    expect(drained).toBe(false);
    finished.resolve();
    await draining;
    expect(runProbe).toHaveBeenCalledTimes(1);
  });
});
