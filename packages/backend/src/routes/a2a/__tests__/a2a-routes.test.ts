import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import Fastify, { FastifyInstance } from 'fastify';
import { registerA2ARoutes } from '../index';
import { setConfigForTesting } from '../../../config';
import { A2AService } from '../../../services/a2a/a2a-service';
import type { A2ATask } from '../../../types/a2a';

describe('A2A Routes', () => {
  let fastify: FastifyInstance;
  const spies: Array<{ mockRestore: () => void }> = [];
  const authHeaders = {
    authorization: 'Bearer sk-valid-key',
    'content-type': 'application/json',
    'a2a-version': '0.3',
  };

  beforeAll(async () => {
    fastify = Fastify();

    const service = A2AService.getInstance();
    const tasks = new Map<string, A2ATask>();
    const idempotency = new Map<string, string>();
    const pushConfigs = new Map<
      string,
      Map<
        string,
        {
          configId: string;
          taskId: string;
          endpoint: string;
          authentication: Record<string, unknown> | undefined;
          metadata: Record<string, unknown> | undefined;
          enabled: boolean;
          createdAt: string;
          updatedAt: string;
        }
      >
    >();

    const getTaskOrThrow = (taskId: string): A2ATask => {
      const task = tasks.get(taskId);
      if (!task) {
        throw { statusCode: 404, code: 'TASK_NOT_FOUND', message: 'task not found' };
      }
      return task;
    };

    spies.push(spyOn(service, 'getPublicAgentCard').mockImplementation(() => ({
      name: 'Plexus A2A Gateway',
      version: '0.3.0',
      url: 'http://localhost/a2a',
      capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
      skills: [],
    })));

    spies.push(spyOn(service, 'getExtendedAgentCard').mockImplementation(() => ({
      name: 'Plexus A2A Gateway',
      version: '0.3.0',
      url: 'http://localhost/a2a',
      capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
      skills: [],
      metadata: { adminKeyConfigured: true },
    })));

    spies.push(spyOn(service, 'sendMessage').mockImplementation(async (input) => {
      if (!input.message?.parts?.length) {
        throw { statusCode: 400, code: 'INVALID_REQUEST', message: 'message.parts is required' };
      }

      const idemKey = input.configuration?.idempotencyKey;
      if (idemKey && idempotency.has(idemKey)) {
        const existing = tasks.get(idempotency.get(idemKey) || '');
        if (!existing) {
          throw { statusCode: 500, code: 'INTERNAL_ERROR', message: 'idempotency store mismatch' };
        }
        return existing;
      }

      const taskId = input.taskId || `task-${crypto.randomUUID()}`;
      const task: A2ATask = {
        id: taskId,
        contextId: input.contextId || `ctx-${crypto.randomUUID()}`,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        metadata: input.metadata,
      };
      tasks.set(taskId, task);
      if (idemKey) {
        idempotency.set(idemKey, taskId);
      }
      return task;
    }));

    spies.push(spyOn(service, 'getTask').mockImplementation(async (taskId: string) => {
      return getTaskOrThrow(taskId);
    }));

    spies.push(spyOn(service, 'listTasks').mockImplementation(async () => {
      const items = Array.from(tasks.values());
      return { tasks: items, total: items.length };
    }));

    spies.push(spyOn(service, 'cancelTask').mockImplementation(async (taskId: string) => {
      const task = getTaskOrThrow(taskId);
      if (task.status.state === 'completed' || task.status.state === 'failed' || task.status.state === 'canceled' || task.status.state === 'rejected') {
        throw { statusCode: 422, code: 'INVALID_TASK_STATE', message: 'task is already terminal' };
      }
      const canceled: A2ATask = {
        ...task,
        status: {
          state: 'canceled',
          timestamp: new Date().toISOString(),
        },
      };
      tasks.set(taskId, canceled);
      return canceled;
    }));

    spies.push(spyOn(service, 'createPushNotificationConfig').mockImplementation(async (taskId: string, input) => {
      getTaskOrThrow(taskId);
      const configId = input.configId || `cfg-${crypto.randomUUID()}`;
      const forTask =
        pushConfigs.get(taskId) ||
        new Map<
          string,
          {
            configId: string;
            taskId: string;
            endpoint: string;
            authentication: Record<string, unknown> | undefined;
            metadata: Record<string, unknown> | undefined;
            enabled: boolean;
            createdAt: string;
            updatedAt: string;
          }
        >();
      const timestamp = new Date().toISOString();
      const config = {
        configId,
        taskId,
        endpoint: input.endpoint,
        authentication: input.authentication,
        metadata: input.metadata,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      forTask.set(configId, config);
      pushConfigs.set(taskId, forTask);
      return config;
    }));

    spies.push(spyOn(service, 'getPushNotificationConfig').mockImplementation(async (taskId: string, configId: string) => {
      const config = pushConfigs.get(taskId)?.get(configId);
      if (!config) {
        throw { statusCode: 404, code: 'TASK_NOT_FOUND', message: 'push notification config not found' };
      }
      return config;
    }));

    spies.push(spyOn(service, 'listPushNotificationConfigs').mockImplementation(async (taskId: string) => {
      return Array.from(pushConfigs.get(taskId)?.values() || []);
    }));

    spies.push(spyOn(service, 'deletePushNotificationConfig').mockImplementation(async (taskId: string, configId: string) => {
      const forTask = pushConfigs.get(taskId);
      if (!forTask || !forTask.has(configId)) {
        throw { statusCode: 404, code: 'TASK_NOT_FOUND', message: 'push notification config not found' };
      }
      forTask.delete(configId);
    }));

    setConfigForTesting({
      providers: {},
      models: {},
      keys: {
        'test-key': { secret: 'sk-valid-key', comment: 'test key' },
      },
      adminKey: 'admin-secret',
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
      quotas: [],
      mcpServers: {},
    });

    await registerA2ARoutes(fastify);
    await fastify.ready();
  });

  afterAll(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    await fastify.close();
  });

  test('GET /.well-known/agent-card.json returns card without auth', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/.well-known/agent-card.json',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.name).toContain('Plexus');
    expect(body.capabilities.streaming).toBe(true);
  });

  test('GET /a2a/extendedAgentCard requires auth', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/extendedAgentCard',
      headers: {
        'a2a-version': '0.3',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  test('A2A routes require A2A-Version header', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/tasks',
      headers: {
        authorization: 'Bearer sk-valid-key',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  test('rejects unsupported A2A version', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/tasks',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '9.9',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  test('returns CAPABILITY_NOT_SUPPORTED when streaming capability is disabled', async () => {
    const service = A2AService.getInstance();
    const capabilitySpy = spyOn(service, 'getPublicAgentCard').mockImplementationOnce(() => ({
      name: 'Plexus A2A Gateway',
      version: '0.3.0',
      url: 'http://localhost/a2a',
      capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
      skills: [],
    }));

    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/tasks/task-any/subscribe',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });

    capabilitySpy.mockRestore();
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
  });

  test('POST /a2a/message/send creates task', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/a2a/message/send',
      headers: authHeaders,
      payload: {
        contextId: 'ctx-test-send-1',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'hello A2A' }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.task).toBeDefined();
    expect(body.task.status.state).toBe('submitted');
  });

  test('POST /a2a/message/send honors idempotency key', async () => {
    const payload = {
      contextId: 'ctx-test-send-2',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'idempotent hello' }],
      },
      configuration: {
        idempotencyKey: 'idem-key-1',
      },
    };

    const first = await fastify.inject({
      method: 'POST',
      url: '/a2a/message/send',
      headers: authHeaders,
      payload,
    });
    const second = await fastify.inject({
      method: 'POST',
      url: '/a2a/message/send',
      headers: authHeaders,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);
    expect(firstBody.task.id).toBe(secondBody.task.id);
  });

  test('GET /a2a/tasks lists tasks', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/tasks?limit=5&offset=0',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  test('GET /a2a/tasks/:taskId returns 404 for unknown task', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/a2a/tasks/not-found-task',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('TASK_NOT_FOUND');
  });

  test('POST /a2a/tasks/:taskId/cancel cancels active task and rejects repeat cancel', async () => {
    const createResponse = await fastify.inject({
      method: 'POST',
      url: '/a2a/message/send',
      headers: authHeaders,
      payload: {
        contextId: 'ctx-cancel-1',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'cancel me' }],
        },
      },
    });
    const taskId = JSON.parse(createResponse.body).task.id;

    const firstCancel = await fastify.inject({
      method: 'POST',
      url: `/a2a/tasks/${taskId}/cancel`,
      headers: authHeaders,
      payload: { reason: 'test cancel' },
    });

    expect(firstCancel.statusCode).toBe(200);
    const firstBody = JSON.parse(firstCancel.body);
    expect(firstBody.task.status.state).toBe('canceled');

    const secondCancel = await fastify.inject({
      method: 'POST',
      url: `/a2a/tasks/${taskId}/cancel`,
      headers: authHeaders,
      payload: { reason: 'repeat cancel' },
    });

    expect(secondCancel.statusCode).toBe(422);
    const secondBody = JSON.parse(secondCancel.body);
    expect(secondBody.error.code).toBe('INVALID_TASK_STATE');
  });

  test('Push notification config CRUD works', async () => {
    const createTask = await fastify.inject({
      method: 'POST',
      url: '/a2a/message/send',
      headers: authHeaders,
      payload: {
        contextId: 'ctx-push-1',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'push config test' }],
        },
      },
    });
    const taskId = JSON.parse(createTask.body).task.id;

    const createConfig = await fastify.inject({
      method: 'POST',
      url: `/a2a/tasks/${taskId}/pushNotificationConfigs`,
      headers: authHeaders,
      payload: {
        configId: 'cfg-1',
        config: {
          endpoint: 'https://example.test/webhook',
          authentication: { type: 'bearer', token: 'redacted' },
          metadata: { env: 'test' },
        },
      },
    });

    expect(createConfig.statusCode).toBe(201);

    const listConfigs = await fastify.inject({
      method: 'GET',
      url: `/a2a/tasks/${taskId}/pushNotificationConfigs`,
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });
    expect(listConfigs.statusCode).toBe(200);
    const listBody = JSON.parse(listConfigs.body);
    expect(listBody.configs.length).toBeGreaterThanOrEqual(1);

    const getConfig = await fastify.inject({
      method: 'GET',
      url: `/a2a/tasks/${taskId}/pushNotificationConfigs/cfg-1`,
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });
    expect(getConfig.statusCode).toBe(200);

    const deleteConfig = await fastify.inject({
      method: 'DELETE',
      url: `/a2a/tasks/${taskId}/pushNotificationConfigs/cfg-1`,
      headers: {
        authorization: 'Bearer sk-valid-key',
        'a2a-version': '0.3',
      },
    });
    expect(deleteConfig.statusCode).toBe(204);
  });

  test('enforces A2A rate limit with RATE_LIMITED code', async () => {
    let limitedResponseStatus = 0;
    let limitedErrorCode = '';

    for (let index = 0; index < 140; index += 1) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/a2a/tasks?limit=1&offset=0',
        headers: {
          authorization: 'Bearer sk-valid-key',
          'a2a-version': '0.3',
        },
      });

      if (response.statusCode === 429) {
        limitedResponseStatus = response.statusCode;
        const body = JSON.parse(response.body);
        limitedErrorCode = body.error.code;
        break;
      }
    }

    expect(limitedResponseStatus).toBe(429);
    expect(limitedErrorCode).toBe('RATE_LIMITED');
  });
});
