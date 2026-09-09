import { UsageInspector } from '../../inspectors/usage-logging';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { UsageStorageService } from '../usage-storage';
import { DebugManager } from '../debug-manager';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  DebugManager.getInstance().resetForTesting();
  DebugManager.getInstance().setEnabled(false);
});
afterEach(() => vi.useRealTimers());

describe('telemetry drain', () => {
  test('waits for usage writes queued by a pending event', async () => {
    const storage = new UsageStorageService();
    const started = deferred();
    const updated = deferred();
    registerSpy(storage, 'emitStarted').mockImplementation(async () => {
      await started.promise;
      storage.emitUpdatedAsync({ requestId: 'one' });
    });
    const update = registerSpy(storage, 'emitUpdated').mockImplementation(() => updated.promise);
    storage.emitStartedAsync({ requestId: 'one' });
    let drained = false;
    const draining = storage.drain().then(() => {
      drained = true;
    });
    started.resolve();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(drained).toBe(false);
    updated.resolve();
    await draining;
  });

  test('waits for a direct fire-and-forget usage upsert and writes from its completion listener', async () => {
    const storage = new UsageStorageService();
    const write = deferred();
    const errorWrite = deferred();
    const values = vi.fn(() => ({ onConflictDoUpdate: () => write.promise }));
    const errorValues = vi.fn(() => errorWrite.promise);
    (storage as any).db = {
      insert: vi.fn().mockReturnValueOnce({ values }).mockReturnValueOnce({ values: errorValues }),
    };
    (storage as any).schema = { requestUsage: { requestId: 'request_id' }, inferenceErrors: {} };
    storage.on('completed', () => {
      void storage.saveError('one', new Error('late error'), undefined, 'test-key');
    });
    void storage.saveRequest({ requestId: 'one' } as any);
    let drained = false;
    const draining = storage.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    write.resolve();
    await vi.waitFor(() => expect(errorValues).toHaveBeenCalledOnce());
    expect(drained).toBe(false);
    errorWrite.resolve();
    await draining;
    expect(drained).toBe(true);
  });

  test('waits for detached streaming quota accounting after the stream finishes', async () => {
    const storage = new UsageStorageService();
    registerSpy(storage, 'saveRequest').mockResolvedValue(undefined);
    registerSpy(storage, 'updatePerformanceMetrics').mockResolvedValue(undefined);
    const quota = deferred();
    const recordUsage = vi.fn(() => quota.promise);
    const inspector = new UsageInspector(
      'stream',
      storage,
      { requestId: 'stream' },
      undefined,
      undefined,
      Date.now(),
      false,
      'chat',
      'chat',
      undefined,
      { recordUsage },
      'test-key'
    );
    inspector.resume();
    const finished = new Promise<void>((resolve) => inspector.on('finish', resolve));
    inspector.end();
    await finished;
    expect(recordUsage).toHaveBeenCalledOnce();
    let drained = false;
    const draining = storage.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    quota.resolve();
    await draining;
    expect(drained).toBe(true);
  });

  test('waits for prior debug writes and flushes remaining eligible traces', async () => {
    vi.useFakeTimers();
    const manager = DebugManager.getInstance();
    const storage = new UsageStorageService();
    const prior = deferred();
    const remaining = deferred();
    const save = registerSpy(storage, 'saveDebugLog')
      .mockImplementationOnce(() => prior.promise)
      .mockImplementationOnce(() => remaining.promise);
    manager.setStorage(storage);
    manager.setEnabled(true);
    manager.startLog('prior', { model: 'test' });
    manager.flush('prior');
    manager.startLog('remaining', { model: 'test' });
    let drained = false;
    const draining = manager.drain().then(() => {
      drained = true;
    });
    expect(save).toHaveBeenCalledTimes(2);
    remaining.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    prior.resolve();
    await draining;
    expect(manager.getPendingLog('remaining')).toBeUndefined();
  });
});
