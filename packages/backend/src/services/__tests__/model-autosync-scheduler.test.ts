import { afterEach, describe, expect, it, jest, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import type { ProviderConfig } from '../../config';
import { ModelAutosyncScheduler } from '../models/model-autosync-scheduler';

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
  afterEach(() => {
    ModelAutosyncScheduler.getInstance().stop();
    ModelAutosyncScheduler.resetInstance();
    jest.useRealTimers();
  });

  it('keeps provider configs cached when scheduling autosync', () => {
    jest.useFakeTimers();

    const scheduler = ModelAutosyncScheduler.getInstance();
    const runSyncNow = registerSpy(scheduler, 'runSyncNow').mockResolvedValue(0);

    scheduler.initialize({ wafer: makeProvider(60) });

    const configs = Reflect.get(scheduler, 'configs') as Map<string, unknown>;
    expect(configs.has('wafer')).toBe(true);
    expect(runSyncNow).toHaveBeenCalledWith('wafer');
  });

  it('keeps provider configs cached when rescheduling interval changes', () => {
    jest.useFakeTimers();

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
