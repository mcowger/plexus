import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DebugManager } from '../observability/debug-manager';
import { runInRequestContext } from '../observability/request-context';
import type { UsageStorageService } from '../observability/usage-storage';

describe('DebugManager target capture', () => {
  let debugManager: DebugManager;
  let saveDebugLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    debugManager = DebugManager.getInstance();
    debugManager.resetForTesting();
    debugManager.setEnabled(false);
    saveDebugLog = vi.fn();
    debugManager.setStorage({ saveDebugLog } as unknown as UsageStorageService);
  });

  test('persists when the request key is enabled', () => {
    debugManager.enableForKey('test-key');

    runInRequestContext({ keyName: 'test-key' }, () => {
      debugManager.startLog('req-key', { model: 'untracked-alias' });
      debugManager.flush('req-key');
    });

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-key',
      apiKey: 'test-key',
      modelAlias: 'untracked-alias',
    });
  });

  test('persists auto routing decisions without modifying the upstream payload', () => {
    debugManager.setEnabled(true);
    const payload = { model: 'magic', messages: [{ role: 'user', content: 'hello' }] };
    const decision = { reasons: ['quality_upgrade'], requiredTier: 2 };
    debugManager.startLog('auto-request', payload);
    debugManager.addTransformedRequest('auto-request', payload);
    debugManager.addRoutingDecision('auto-request', decision);
    debugManager.flush('auto-request');
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      rawRequest: { plexus_auto_routing: decision },
      transformedRequest: payload,
    });
    expect(payload).not.toHaveProperty('plexus_auto_routing');
  });

  test('persists when the incoming alias is enabled', () => {
    debugManager.enableForAlias('tracked-alias');

    debugManager.startLog('req-alias', { model: 'tracked-alias' });
    debugManager.flush('req-alias');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-alias',
      modelAlias: 'tracked-alias',
    });
  });

  test('persists when routing resolves an alternate alias to an enabled canonical alias', () => {
    debugManager.enableForAlias('canonical-alias');

    const rawRequest = { model: 'alternate-alias', messages: [{ role: 'user', content: 'hello' }] };
    const requestHeaders = { 'x-test': 'yes' };

    debugManager.startLog('req-canonical-alias', rawRequest, requestHeaders);
    expect(debugManager.getPendingLog('req-canonical-alias')).toMatchObject({
      requestId: 'req-canonical-alias',
      modelAlias: 'alternate-alias',
      deferPayloadCapture: true,
    });
    expect(debugManager.getPendingLog('req-canonical-alias')?.rawRequest).toBeUndefined();

    debugManager.setModelAliasForRequest(
      'req-canonical-alias',
      'canonical-alias',
      rawRequest,
      requestHeaders
    );
    debugManager.flush('req-canonical-alias');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-canonical-alias',
      modelAlias: 'canonical-alias',
      rawRequest,
      requestHeaders,
    });
  });

  test('persists when the selected provider is enabled', () => {
    debugManager.setEnabledProviders(['tracked-provider']);

    const rawRequest = { model: 'untracked-alias', messages: [{ role: 'user', content: 'hello' }] };

    debugManager.startLog('req-provider', rawRequest);
    expect(debugManager.getPendingLog('req-provider')).toMatchObject({
      requestId: 'req-provider',
      rawRequest,
    });
    debugManager.setProviderForRequest('req-provider', 'tracked-provider');
    debugManager.flush('req-provider');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-provider',
      provider: 'tracked-provider',
    });
  });

  test('global capture persists regardless of unmatched provider target', () => {
    debugManager.setEnabled(true);
    debugManager.setEnabledProviders(['other-provider']);

    debugManager.startLog('req-global', { model: 'untracked-alias' });
    debugManager.setProviderForRequest('req-global', 'untracked-provider');
    debugManager.flush('req-global');

    expect(saveDebugLog).toHaveBeenCalledTimes(1);
    expect(saveDebugLog.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'req-global',
      provider: 'untracked-provider',
    });
  });

  test('drops traces when no enabled dimension matches', () => {
    debugManager.setEnabledProviders(['tracked-provider']);
    debugManager.setEnabledAliases(['tracked-alias']);
    debugManager.setEnabledKeys(['tracked-key']);

    runInRequestContext({ keyName: 'other-key' }, () => {
      debugManager.startLog('req-drop', { model: 'other-alias' });
      debugManager.setProviderForRequest('req-drop', 'other-provider');
      debugManager.flush('req-drop');
    });

    expect(saveDebugLog).not.toHaveBeenCalled();
  });

  test('does not buffer full payloads when only unmatched aliases are enabled', () => {
    debugManager.setEnabledAliases(['tracked-alias']);

    const rawRequest = { model: 'other-alias', messages: [{ role: 'user', content: 'hello' }] };
    debugManager.startLog('req-unmatched-alias', rawRequest, { 'x-test': 'yes' });
    debugManager.addTransformedRequest('req-unmatched-alias', {
      model: 'provider-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    debugManager.addResponseMeta('req-unmatched-alias', 200, {
      'content-type': 'application/json',
    });

    const pendingLog = debugManager.getPendingLog('req-unmatched-alias');
    expect(pendingLog).toMatchObject({
      requestId: 'req-unmatched-alias',
      modelAlias: 'other-alias',
      deferPayloadCapture: true,
    });
    expect(pendingLog?.rawRequest).toBeUndefined();
    expect(pendingLog?.requestHeaders).toBeUndefined();
    expect(pendingLog?.transformedRequest).toBeUndefined();
    expect(pendingLog?.responseHeaders).toBeUndefined();

    debugManager.flush('req-unmatched-alias');
    expect(saveDebugLog).not.toHaveBeenCalled();
  });
});
