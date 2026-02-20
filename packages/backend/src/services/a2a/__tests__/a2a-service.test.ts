import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { desc, eq } from 'drizzle-orm';
import { setConfigForTesting } from '../../../config';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../../db/client';
import { runMigrations } from '../../../db/migrate';
import { A2AService } from '../a2a-service';

describe('A2AService lifecycle and idempotency', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = 'sqlite://:memory:';
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    setConfigForTesting({
      providers: {},
      models: {},
      keys: {},
      adminKey: 'admin-secret',
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
      quotas: [],
      mcpServers: {},
    });
  });

  afterEach(async () => {
    await closeDatabase();
  });

  test('allows valid transitions and records ordered task events', async () => {
    const service = A2AService.getInstance();
    const task = await service.sendMessage({
      contextId: 'ctx-transition-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'transition test' }],
      },
    });

    const working = await service.transitionTask(task.id, 'working', { reason: 'picked up by worker' });
    const completed = await service.transitionTask(task.id, 'completed', { reason: 'done' });

    expect(task.status.state).toBe('submitted');
    expect(working.status.state).toBe('working');
    expect(completed.status.state).toBe('completed');

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const events = await db
      .select()
      .from(schema.a2aTaskEvents)
      .where(eq(schema.a2aTaskEvents.taskId, task.id))
      .orderBy(desc(schema.a2aTaskEvents.sequence));

    expect(events.length).toBe(3);
    expect(events.map((row: any) => row.sequence).sort((a: number, b: number) => a - b)).toEqual([1, 2, 3]);

    const replay = await service.listTaskEvents(task.id, { afterSequence: 1, limit: 10 });
    expect(replay.length).toBe(2);
    expect(replay[0]?.sequence).toBe(2);
    expect(replay[1]?.sequence).toBe(3);
  });

  test('rejects transitions from terminal state', async () => {
    const service = A2AService.getInstance();
    const task = await service.sendMessage({
      contextId: 'ctx-terminal-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'cancel test' }],
      },
    });

    const canceled = await service.cancelTask(task.id, 'client canceled');
    expect(canceled.status.state).toBe('canceled');

    try {
      await service.transitionTask(task.id, 'working', { reason: 'invalid restart' });
      throw new Error('expected transition to fail');
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(422);
      expect(e.code).toBe('INVALID_TASK_STATE');
    }
  });

  test('enforces idempotency conflict for mismatched payload', async () => {
    const service = A2AService.getInstance();

    const first = await service.sendMessage({
      contextId: 'ctx-idem-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'same message' }],
      },
      configuration: {
        idempotencyKey: 'idem-conflict-1',
      },
    });

    const replay = await service.sendMessage({
      contextId: 'ctx-idem-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'same message' }],
      },
      configuration: {
        idempotencyKey: 'idem-conflict-1',
      },
    });

    expect(replay.id).toBe(first.id);

    try {
      await service.sendMessage({
        contextId: 'ctx-idem-1',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'different message' }],
        },
        configuration: {
          idempotencyKey: 'idem-conflict-1',
        },
      });
      throw new Error('expected idempotency conflict');
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  test('allows idempotency key reuse after retention window expiration', async () => {
    const service = A2AService.getInstance();

    const first = await service.sendMessage({
      contextId: 'ctx-expiry-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'initial payload' }],
      },
      configuration: {
        idempotencyKey: 'idem-expired-1',
      },
    });

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const threeDaysAgoIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    await db
      .update(schema.a2aTasks)
      .set({ createdAt: threeDaysAgoIso, updatedAt: threeDaysAgoIso })
      .where(eq(schema.a2aTasks.id, first.id));

    (service as any).lastIdempotencyCleanupAtMs = 0;

    const second = await service.sendMessage({
      contextId: 'ctx-expiry-1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'new payload after expiry' }],
      },
      configuration: {
        idempotencyKey: 'idem-expired-1',
      },
    });

    expect(second.id).not.toBe(first.id);
  });

  test('enforces per-key ownership scoping for task access', async () => {
    const service = A2AService.getInstance();
    const ownerScope = { keyName: 'owner-key', attribution: null, isAdmin: false };
    const otherScope = { keyName: 'other-key', attribution: null, isAdmin: false };

    const task = await service.sendMessage(
      {
        contextId: 'ctx-owner-scope',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'owner-only task' }],
        },
      },
      ownerScope
    );

    const ownerList = await service.listTasks({}, ownerScope);
    expect(ownerList.tasks.some((item) => item.id === task.id)).toBe(true);

    const otherList = await service.listTasks({}, otherScope);
    expect(otherList.tasks.some((item) => item.id === task.id)).toBe(false);

    try {
      await service.getTask(task.id, otherScope);
      throw new Error('expected task lookup to fail for non-owner');
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(404);
      expect(e.code).toBe('TASK_NOT_FOUND');
    }
  });

  test('encrypts push authentication payloads at rest', async () => {
    const service = A2AService.getInstance();
    const scope = { keyName: 'owner-key', attribution: null, isAdmin: false };
    const task = await service.sendMessage(
      {
        contextId: 'ctx-push-encryption',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'encrypt push auth' }],
        },
      },
      scope
    );

    await service.createPushNotificationConfig(
      task.id,
      {
        endpoint: 'https://example.test/webhook',
        authentication: { type: 'bearer', token: 'top-secret-token' },
      },
      scope
    );

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const rows = await db
      .select()
      .from(schema.a2aPushNotificationConfigs)
      .where(eq(schema.a2aPushNotificationConfigs.taskId, task.id))
      .limit(1);

    const storedAuth = String(rows[0]?.authentication || '');
    expect(storedAuth.startsWith('enc:v1:')).toBe(true);

    const listed = await service.listPushNotificationConfigs(task.id, scope);
    const listedToken = (listed[0]?.authentication as { token?: string } | undefined)?.token;
    expect(listedToken).toBe('top-secret-token');
  });
});
