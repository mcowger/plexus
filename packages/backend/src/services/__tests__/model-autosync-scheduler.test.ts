import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../config';
import { registerSpy } from '../../../test/test-utils';
import { ModelAutosyncScheduler } from '../model-autosync-scheduler';

const makeProvider = (intervalMinutes: number): ProviderConfig => ({
  api_base_url: 'https://api.example.com/v1',
  api_key: 'sk-test',
  disable_cooldown: false,
  stall_cooldown: false,
  estimateTokens: false,
  useClaudeMasking: false,
  model_autosync: { enabled: true, intervalMinutes },
});

describe('ModelAutosyncScheduler', () => {
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
