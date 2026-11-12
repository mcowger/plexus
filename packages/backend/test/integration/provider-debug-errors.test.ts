import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { ProviderConfigSchema, setConfigForTesting } from '../../src/config';
import { registerChatRoute } from '../../src/routes/inference/chat';
import { Dispatcher } from '../../src/services/dispatch/dispatcher';
import { type DebugLogRecord, DebugManager } from '../../src/services/observability/debug-manager';
import type { UsageStorageService } from '../../src/services/observability/usage-storage';
import { CooldownManager } from '../../src/services/runtime/cooldown-manager';
import { asFetch } from '../test-utils';

describe('Provider-targeted debug capture on dispatch errors', () => {
  const debugManager = DebugManager.getInstance();
  let app: FastifyInstance;
  let savedLogs: DebugLogRecord[];
  let wasDebugEnabled: boolean;
  let previousStorage: UsageStorageService;
  let dispatcher: Dispatcher;

  beforeEach(async () => {
    setConfigForTesting({
      providers: {
        uberllm: ProviderConfigSchema.parse({
          api_base_url: 'https://upstream.example/v1',
          api_key: 'test-key',
          models: { 'test-model': { pricing: { source: 'simple', input: 0, output: 0 } } },
        }),
      },
      models: {
        'test-model': {
          priority: 'selector',
          sticky_session: false,
          targets: [{ provider: 'uberllm', model: 'test-model' }],
        },
      },
      keys: {},
      quotas: [],
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
    });
    await CooldownManager.getInstance().clearCooldown();
    savedLogs = [];
    previousStorage = debugManager['storage']!;
    wasDebugEnabled = debugManager.isEnabled();
    debugManager.resetForTesting();
    debugManager.setEnabled(false);
    debugManager.setEnabledProviders(['uberllm']);
    const storage = {
      saveRequest: mock(),
      saveError: mock(),
      emitStartedAsync: mock(),
      emitUpdatedAsync: mock(),
      recordFailedAttempt: mock(),
      saveDebugLog: mock((log: DebugLogRecord) => savedLogs.push(log)),
    } as unknown as UsageStorageService;
    debugManager.setStorage(storage);
    dispatcher = new Dispatcher();
    dispatcher.setUsageStorage(storage);
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => Response.json({ error: { message: 'invalid params' } }, { status: 400 }))
    );
    app = Fastify();
    await registerChatRoute(app, dispatcher, storage);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await CooldownManager.getInstance().clearCooldown();
    debugManager.resetForTesting();
    debugManager.setEnabled(wasDebugEnabled);
    debugManager.setStorage(previousStorage);
  });

  const payload = { model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] };

  test.each([400, 503])('persists a matching provider trace after HTTP %s', async (status) => {
    const body = { error: { message: 'upstream rejected the request' } };
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => Response.json(body, { status, headers: { 'x-upstream': 'test' } }))
    );

    const response = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload });

    expect(response.statusCode).toBe(status);
    expect(savedLogs).toEqual([
      expect.objectContaining({
        provider: 'uberllm',
        rawRequest: payload,
        transformedRequest: expect.objectContaining({ model: 'test-model' }),
        responseStatus: status,
        responseHeaders: expect.objectContaining({ 'x-upstream': 'test' }),
        rawResponse: JSON.stringify(body),
      }),
    ]);
  });

  test('drops failed traces for providers outside the capture targets', async () => {
    debugManager.setEnabledProviders(['other-provider']);

    const response = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload });

    expect(response.statusCode).toBe(400);
    expect(savedLogs).toEqual([]);
  });

  test('persists transport failures without dispatcher usage storage', async () => {
    dispatcher = new Dispatcher();
    const storage = {
      saveRequest: mock(),
      saveError: mock(),
      emitStartedAsync: mock(),
      emitUpdatedAsync: mock(),
    };
    // The route needs usage persistence; the dispatcher intentionally has none.
    const routeStorage = storage as unknown as UsageStorageService;
    await app.close();
    app = Fastify();
    await registerChatRoute(app, dispatcher, routeStorage);
    await app.ready();
    spyOn(globalThis, 'fetch').mockImplementation(
      asFetch(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    const response = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload });

    expect(response.statusCode).toBe(500);
    expect(savedLogs).toEqual([
      expect.objectContaining({ provider: 'uberllm', rawRequest: payload }),
    ]);
  });
});
