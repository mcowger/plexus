import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DebugManager } from '../observability/debug-manager';
import { runInRequestContext } from '../observability/request-context';
import type { UsageStorageService } from '../observability/usage-storage';

describe('DebugManager ephemeral capture', () => {
  let debugManager: DebugManager;
  let saveDebugLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    debugManager = DebugManager.getInstance();
    debugManager.resetForTesting();
    debugManager.setEnabled(false);
    saveDebugLog = vi.fn();
    debugManager.setStorage({ saveDebugLog } as unknown as UsageStorageService);
  });

  test('discards the ephemeral trace when no debug dimension is enabled', () => {
    debugManager.startLog('req-none', { model: 'untracked-alias' });
    debugManager.markEphemeral('req-none');
    debugManager.flush('req-none');

    expect(saveDebugLog).not.toHaveBeenCalled();
    expect(debugManager.getPendingLog('req-none')).toBeUndefined();
  });

  test('discards the ephemeral trace when discardEphemeral runs and no dimension is enabled', () => {
    debugManager.setEnabled(true);
    debugManager.startLog('req-discard', { model: 'untracked-alias' });
    debugManager.setEnabled(false);
    debugManager.markEphemeral('req-discard');

    debugManager.discardEphemeral('req-discard');
    debugManager.flush('req-discard');

    expect(saveDebugLog).not.toHaveBeenCalled();
    expect(debugManager.getPendingLog('req-discard')).toBeUndefined();
  });

  test('persists the ephemeral trace when global debug capture is enabled', () => {
    debugManager.setEnabled(true);

    debugManager.startLog('req-global', { model: 'untracked-alias' });
    debugManager.markEphemeral('req-global');
    debugManager.flush('req-global');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-global',
      modelAlias: 'untracked-alias',
    });
  });

  test('persists the ephemeral trace when the usage inspector discards before flush', () => {
    // Mirrors the token-estimation flow: the usage inspector calls
    // discardEphemeral once estimation completes, and the normal flush runs
    // afterwards — the trace must survive both.
    debugManager.setEnabled(true);
    debugManager.startLog('req-estimation', { model: 'untracked-alias' });
    debugManager.markEphemeral('req-estimation');

    debugManager.discardEphemeral('req-estimation');
    debugManager.flush('req-estimation');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
  });

  test('persists the ephemeral trace when the request key is enabled', () => {
    debugManager.enableForKey('test-key');

    runInRequestContext({ keyName: 'test-key' }, () => {
      debugManager.startLog('req-key', { model: 'untracked-alias' });
      debugManager.markEphemeral('req-key');
      debugManager.flush('req-key');
    });

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-key',
      apiKey: 'test-key',
    });
  });

  test('persists the ephemeral trace when capture-on-error forces persistence', () => {
    debugManager.setCaptureOnError(true);

    debugManager.startLog('req-error', { model: 'untracked-alias' });
    debugManager.markEphemeral('req-error');
    debugManager.markForcePersist('req-error');
    debugManager.flush('req-error');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-error',
      forcePersist: true,
    });
  });

  test('keeps the trace when discardEphemeral runs under capture-on-error with an error', () => {
    debugManager.setCaptureOnError(true);

    debugManager.startLog('req-error-discard', { model: 'untracked-alias' });
    debugManager.markEphemeral('req-error-discard');
    debugManager.markForcePersist('req-error-discard');

    // The usage inspector discards after estimating tokens; the trace must
    // survive so a later flush still persists the error.
    debugManager.discardEphemeral('req-error-discard');
    debugManager.flush('req-error-discard');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
  });
});
