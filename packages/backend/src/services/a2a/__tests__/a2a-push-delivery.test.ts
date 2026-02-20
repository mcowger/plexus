import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { A2APushDeliveryService } from '../a2a-push-delivery';
import type { A2ATaskEventRecord } from '../a2a-service';

class FakeA2AService extends EventEmitter {
  async listPushNotificationConfigs(taskId: string) {
    if (taskId !== 'task-1') {
      return [];
    }

    return [
      {
        configId: 'cfg-1',
        endpoint: 'https://example.test/push',
        authentication: { type: 'bearer', token: 'secret-token' },
        metadata: { env: 'test' },
        enabled: true,
      },
    ];
  }
}

class FakeBlockedEndpointService extends EventEmitter {
  async listPushNotificationConfigs() {
    return [
      {
        configId: 'cfg-blocked',
        endpoint: 'http://127.0.0.1:9999/push',
        authentication: undefined,
        metadata: undefined,
        enabled: true,
      },
    ];
  }
}

class FakeHmacService extends EventEmitter {
  async listPushNotificationConfigs() {
    return [
      {
        configId: 'cfg-hmac',
        endpoint: 'https://example.test/push',
        authentication: { type: 'hmac-sha256', secret: 'super-secret' },
        metadata: undefined,
        enabled: true,
      },
    ];
  }
}

describe('A2APushDeliveryService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    A2APushDeliveryService.getInstance().stop();
  });

  afterEach(() => {
    A2APushDeliveryService.getInstance().stop();
    global.fetch = originalFetch;
    delete process.env.A2A_PUSH_ALLOW_INSECURE_ENDPOINTS;
  });

  test('delivers task events to configured push endpoints', async () => {
    const fetchMock = mock(async () => {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const fakeService = new FakeA2AService();
    const delivery = A2APushDeliveryService.getInstance();
    const startService = fakeService as unknown as Parameters<A2APushDeliveryService['start']>[0];
    delivery.start(startService);

    const event: A2ATaskEventRecord = {
      taskId: 'task-1',
      eventType: 'task-status-update',
      sequence: 1,
      payload: { state: 'submitted' },
      createdAt: new Date().toISOString(),
    };

    fakeService.emit('task-event', event);
    expect(delivery.getQueueDepth()).toBe(1);

    await delivery.flushNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe('https://example.test/push');
    const init = firstCall[1];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');

    const payload = JSON.parse(String(init.body || '{}'));
    expect(payload.taskId).toBe('task-1');
    expect(payload.sequence).toBe(1);
  });

  test('skips blocked local push endpoints', async () => {
    const fetchMock = mock(async () => {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const fakeService = new FakeBlockedEndpointService();
    const delivery = A2APushDeliveryService.getInstance();
    const startService = fakeService as unknown as Parameters<A2APushDeliveryService['start']>[0];
    delivery.start(startService);

    const event: A2ATaskEventRecord = {
      taskId: 'task-1',
      eventType: 'task-status-update',
      sequence: 1,
      payload: { state: 'submitted' },
      createdAt: new Date().toISOString(),
    };

    fakeService.emit('task-event', event);
    await delivery.flushNow();

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test('adds HMAC signature header when configured', async () => {
    const fetchMock = mock(async () => {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const fakeService = new FakeHmacService();
    const delivery = A2APushDeliveryService.getInstance();
    const startService = fakeService as unknown as Parameters<A2APushDeliveryService['start']>[0];
    delivery.start(startService);

    const event: A2ATaskEventRecord = {
      taskId: 'task-1',
      eventType: 'task-status-update',
      sequence: 7,
      payload: { state: 'working' },
      createdAt: new Date().toISOString(),
    };

    fakeService.emit('task-event', event);
    await delivery.flushNow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = firstCall[1];
    const headers = (init.headers as Record<string, string>) || {};
    const signature = headers['x-a2a-signature'] || '';
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });
});
