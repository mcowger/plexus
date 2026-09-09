import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../config';
import { registerSpy } from '../../../test/test-utils';
import { ModelAutosyncScheduler } from '../models/model-autosync-scheduler';
import * as discovery from '../providers/provider-model-discovery';
import { ConfigRepository } from '../../db/config-repository';

const makeProvider = (intervalMinutes: number): ProviderConfig => ({
  api_base_url: 'https://api.example.com/v1',
  api_key: 'sk-test',
  disable_cooldown: false,
  stall_cooldown: false,
  allow_100_percent_utilization: false,
  estimateTokens: false,
  useClaudeMasking: false,
  model_autosync: { enabled: true, intervalMinutes },
});

describe('ModelAutosyncScheduler', () => {
  it('waits for persistence and the models-changed callback, then refuses new work', async () => {
    vi.useFakeTimers();
    const persisted = Promise.withResolvers<number>();
    const callbackDone = Promise.withResolvers<void>();
    const discover = registerSpy(discovery, 'discoverProviderModelIds').mockResolvedValue([
      'new-model',
    ]);
    const save = registerSpy(
      ConfigRepository.prototype,
      'addMissingProviderModels'
    ).mockReturnValue(persisted.promise);
    const changed = vi.fn(() => callbackDone.promise);
    const scheduler = ModelAutosyncScheduler.getInstance();
    scheduler.initialize({ wafer: makeProvider(1) }, changed);
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();

    let stopped = false;
    const shutdown = scheduler.shutdown().then(() => {
      stopped = true;
    });
    expect(await scheduler.runSyncNow('wafer')).toBe(0);
    scheduler.reload({ other: makeProvider(1) });
    scheduler.initialize({ another: makeProvider(1) });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(discover).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);

    persisted.resolve(1);
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    callbackDone.resolve();
    await shutdown;
    expect(stopped).toBe(true);
  });

  afterEach(() => {
    ModelAutosyncScheduler.getInstance().stop();
    ModelAutosyncScheduler.resetInstance();
    vi.useRealTimers();
  });

  it('keeps provider configs cached when scheduling autosync', () => {
    vi.useFakeTimers();

    const scheduler = ModelAutosyncScheduler.getInstance();
    const runSyncNow = registerSpy(scheduler, 'runSyncNow').mockResolvedValue(0);

    scheduler.initialize({ wafer: makeProvider(60) });

    const configs = Reflect.get(scheduler, 'configs') as Map<string, unknown>;
    expect(configs.has('wafer')).toBe(true);
    expect(runSyncNow).toHaveBeenCalledWith('wafer');
  });

  it('keeps provider configs cached when rescheduling interval changes', () => {
    vi.useFakeTimers();

    const scheduler = ModelAutosyncScheduler.getInstance();
    const runSyncNow = registerSpy(scheduler, 'runSyncNow').mockResolvedValue(0);

    scheduler.initialize({ wafer: makeProvider(60) });
    runSyncNow.mockClear();

    scheduler.reload({ wafer: makeProvider(1) });

    const configs = Reflect.get(scheduler, 'configs') as Map<
      string,
      { intervalMinutes: number } | undefined
    >;
    expect(configs.get('wafer')?.intervalMinutes).toBe(1);
    expect(runSyncNow).toHaveBeenCalledWith('wafer');
  });
});
