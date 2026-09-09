import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaConfig } from '../../../config';
import { QuotaScheduler } from '../quota-scheduler';
import * as registry from '../checker-registry';
import { registerSpy } from '../../../../test/test-utils';

vi.mock('../checker-registry', () => ({
  loadAllCheckers: vi.fn(async () => {}),
  loadCustomCheckers: vi.fn(async () => {}),
  getCheckerDefinition: vi.fn(() => ({ check: async () => [] })),
  createMeterContext: vi.fn(() => ({})),
}));

const config: QuotaConfig = {
  id: 'shutdown-checker',
  provider: 'test',
  type: 'synthetic',
  enabled: true,
  intervalMinutes: 1,
  options: {},
};

describe('QuotaScheduler shutdown', () => {
  beforeEach(() => {
    QuotaScheduler.resetForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    QuotaScheduler.resetForTesting();
    vi.useRealTimers();
  });

  it('waits for result persistence and cooldown updates while refusing new checks', async () => {
    const scheduler = QuotaScheduler.getInstance();
    const persisted = Promise.withResolvers<void>();
    const persistenceStarted = Promise.withResolvers<void>();
    const cooldownDone = Promise.withResolvers<void>();
    const persist = registerSpy(scheduler as any, 'persistResult').mockImplementation(() => {
      persistenceStarted.resolve();
      return persisted.promise;
    });
    const cooldown = registerSpy(scheduler as any, 'applyCooldownsFromResult').mockReturnValue(
      cooldownDone.promise
    );
    await scheduler.initialize([config]);
    await persistenceStarted.promise;
    expect(persist).toHaveBeenCalledOnce();

    let stopped = false;
    const shutdown = scheduler.shutdown().then(() => {
      stopped = true;
    });
    expect(await scheduler.runCheckNow(config.id)).toBeNull();
    await scheduler.reload([config]);
    await scheduler.initialize([config]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);

    persisted.resolve();
    await Promise.resolve();
    expect(cooldown).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    cooldownDone.resolve();
    await shutdown;
    expect(scheduler.getCheckerIds()).toEqual([]);
  });

  it.each(['initialize', 'reload'] as const)(
    'does not schedule after an in-flight %s finishes',
    async (method) => {
      const scheduler = QuotaScheduler.getInstance();
      const loaded = Promise.withResolvers<void>();
      registerSpy(registry, 'loadAllCheckers').mockReturnValueOnce(loaded.promise);
      const check = registerSpy(scheduler, 'runCheckNow').mockResolvedValue(null);
      const loading = scheduler[method]([config]);
      let stopped = false;
      const shutdown = scheduler.shutdown().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      loaded.resolve();
      await loading;
      await shutdown;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(check).not.toHaveBeenCalled();
      expect(scheduler.getCheckerIds()).toEqual([]);
    }
  );
});
