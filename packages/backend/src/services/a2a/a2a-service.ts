import { EventEmitter } from 'node:events';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { getConfig } from '../../config';
import { getCurrentDialect, getDatabase, getSchema } from '../../db/client';
import type { A2AAgentCard, A2AArtifact, A2AMessage, A2ATask, A2ATaskState } from '../../types/a2a';
import { toDbTimestamp, toIsoString } from '../../utils/normalize';
import { logger } from '../../utils/logger';

const ENCRYPTED_AUTH_PREFIX = 'enc:v1:';

const TERMINAL_STATES = new Set<A2ATaskState>(['completed', 'failed', 'canceled', 'rejected']);

const ALLOWED_TRANSITIONS: Record<A2ATaskState, Set<A2ATaskState>> = {
  submitted: new Set(['working', 'input-required', 'auth-required', 'completed', 'failed', 'canceled', 'rejected']),
  working: new Set(['completed', 'failed', 'canceled', 'input-required', 'auth-required']),
  'input-required': new Set(['working', 'canceled']),
  'auth-required': new Set(['working', 'canceled']),
  completed: new Set(),
  failed: new Set(),
  canceled: new Set(),
  rejected: new Set(),
};

export interface SendMessageInput {
  message: A2AMessage;
  contextId?: string;
  taskId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  configuration?: {
    idempotencyKey?: string;
  };
}

export interface A2AAccessScope {
  keyName: string;
  attribution?: string | null;
  isAdmin?: boolean;
}

export interface ListTasksInput {
  contextId?: string;
  status?: A2ATaskState;
  limit?: number;
  offset?: number;
}

export interface CreatePushNotificationConfigInput {
  configId?: string;
  endpoint: string;
  authentication?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

type A2ATaskRow = {
  id: string;
  contextId: string;
  ownerKey: string;
  ownerAttribution: string | null;
  agentId: string;
  status: string;
  latestMessage: string | null;
  requestMessage: string | null;
  artifacts: string | null;
  metadata: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  submittedAt: string | Date;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  canceledAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type A2APushConfigRow = {
  configId: string;
  taskId: string;
  ownerKey: string;
  endpoint: string;
  authentication: string | null;
  metadata: string | null;
  enabled: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export interface A2ATaskEventRecord {
  taskId: string;
  eventType: string;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

class A2AServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code:
      | 'INVALID_REQUEST'
      | 'UNAUTHENTICATED'
      | 'FORBIDDEN'
      | 'TASK_NOT_FOUND'
      | 'INVALID_TASK_STATE'
      | 'CAPABILITY_NOT_SUPPORTED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RATE_LIMITED'
      | 'INTERNAL_ERROR'
  ) {
    super(message);
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('unique') || message.includes('duplicate key');
}

export class A2AService extends EventEmitter {
  private static instance: A2AService;
  private readonly idempotencyRetentionHours: number;
  private readonly dbTimeoutMs: number;
  private readonly pushAuthEncryptionKey: Buffer | null;
  private lastIdempotencyCleanupAtMs = 0;

  private constructor() {
    super();
    const configuredRetention = Number(process.env.A2A_IDEMPOTENCY_RETENTION_HOURS || '24');
    const configuredDbTimeoutMs = Number(process.env.A2A_DB_TIMEOUT_MS || '10000');
    this.idempotencyRetentionHours = Number.isFinite(configuredRetention) && configuredRetention > 0
      ? configuredRetention
      : 24;
    this.dbTimeoutMs = Number.isFinite(configuredDbTimeoutMs) && configuredDbTimeoutMs > 0
      ? configuredDbTimeoutMs
      : 10000;
    this.pushAuthEncryptionKey = this.resolvePushAuthEncryptionKey();
  }

  static getInstance(): A2AService {
    if (!A2AService.instance) {
      A2AService.instance = new A2AService();
    }
    return A2AService.instance;
  }

  private ensureDb() {
    return {
      db: getDatabase(),
      schema: getSchema(),
    };
  }

  private async withDbTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new A2AServiceError(`database operation timed out: ${operationName}`, 503, 'INTERNAL_ERROR'));
      }, this.dbTimeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private resolvePushAuthEncryptionKey(): Buffer | null {
    const configuredKey = process.env.A2A_PUSH_AUTH_ENCRYPTION_KEY?.trim();
    if (configuredKey) {
      try {
        const asBase64 = Buffer.from(configuredKey, 'base64');
        if (asBase64.length === 32 && asBase64.toString('base64') === configuredKey) {
          return asBase64;
        }
      } catch {
      }

      try {
        const asHex = Buffer.from(configuredKey, 'hex');
        if (asHex.length === 32 && asHex.toString('hex') === configuredKey.toLowerCase()) {
          return asHex;
        }
      } catch {
      }

      const raw = Buffer.from(configuredKey, 'utf8');
      if (raw.length >= 32) {
        return createHash('sha256').update(raw).digest();
      }
    }

    const fallbackAdminKey = getConfig().adminKey?.trim();
    if (fallbackAdminKey) {
      logger.warn('A2A push auth encryption key not configured; deriving key from adminKey as fallback');
      return createHash('sha256').update(fallbackAdminKey).digest();
    }

    logger.warn('A2A push auth encryption key is unavailable; push auth configs cannot be stored securely');
    return null;
  }

  private encryptPushAuthentication(value: Record<string, unknown>): string {
    if (!this.pushAuthEncryptionKey) {
      throw new A2AServiceError('push authentication encryption key is not configured', 500, 'INTERNAL_ERROR');
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.pushAuthEncryptionKey, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTED_AUTH_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptPushAuthentication(value: string): Record<string, unknown> | undefined {
    if (!value) {
      return undefined;
    }

    if (!value.startsWith(ENCRYPTED_AUTH_PREFIX)) {
      return this.jsonParse<Record<string, unknown> | undefined>(value, undefined);
    }

    if (!this.pushAuthEncryptionKey) {
      logger.error('Cannot decrypt push authentication: encryption key unavailable');
      return undefined;
    }

    const encoded = value.slice(ENCRYPTED_AUTH_PREFIX.length);
    const segments = encoded.split(':');
    if (segments.length !== 3) {
      logger.error('Invalid encrypted push authentication payload format');
      return undefined;
    }

    const ivBase64 = segments[0] ?? '';
    const tagBase64 = segments[1] ?? '';
    const ciphertextBase64 = segments[2] ?? '';
    if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
      logger.error('Encrypted push authentication payload is incomplete');
      return undefined;
    }

    try {
      const iv = Buffer.from(ivBase64, 'base64');
      const tag = Buffer.from(tagBase64, 'base64');
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.pushAuthEncryptionKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      logger.error('Failed to decrypt push authentication payload', error);
      return undefined;
    }
  }

  private buildScopedIdempotencyKey(ownerKey: string, idempotencyKey: string): string {
    const digest = createHash('sha256').update(`${ownerKey}:${idempotencyKey}`).digest('hex');
    return `scope:${digest}`;
  }

  private normalizeScope(scope?: A2AAccessScope): Required<Pick<A2AAccessScope, 'keyName'>> & A2AAccessScope {
    if (!scope) {
      return { keyName: 'system', attribution: null, isAdmin: true };
    }
    return {
      keyName: scope.keyName,
      attribution: scope.attribution ?? null,
      isAdmin: scope.isAdmin ?? false,
    };
  }

  private jsonParse<T>(value: string | null, fallback: T): T {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private normalizeTaskState(value: string): A2ATaskState {
    const state = value as A2ATaskState;
    if (
      state === 'submitted' ||
      state === 'working' ||
      state === 'input-required' ||
      state === 'auth-required' ||
      state === 'completed' ||
      state === 'failed' ||
      state === 'canceled' ||
      state === 'rejected'
    ) {
      return state;
    }

    return 'failed';
  }

  private mapTaskRow(row: A2ATaskRow): A2ATask {
    return {
      id: row.id,
      contextId: row.contextId,
      status: {
        state: this.normalizeTaskState(row.status),
        timestamp: toIsoString(row.updatedAt) || new Date().toISOString(),
        message: this.jsonParse<A2AMessage | undefined>(row.latestMessage, undefined),
      },
      artifacts: this.jsonParse<A2AArtifact[] | undefined>(row.artifacts, undefined),
      metadata: this.jsonParse<Record<string, unknown> | undefined>(row.metadata, undefined),
    };
  }

  private mapPushConfigRow(row: A2APushConfigRow) {
    return {
      configId: row.configId,
      taskId: row.taskId,
      endpoint: row.endpoint,
      authentication: row.authentication ? this.decryptPushAuthentication(row.authentication) : undefined,
      metadata: this.jsonParse<Record<string, unknown> | undefined>(row.metadata, undefined),
      enabled: row.enabled === 1,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private async getTaskRowOrThrow(taskId: string, scope?: A2AAccessScope): Promise<A2ATaskRow> {
    const normalizedScope = this.normalizeScope(scope);
    const { db, schema } = this.ensureDb();
    const tasks = schema.a2aTasks;

    const conditions = [eq(tasks.id, taskId)];
    if (!normalizedScope.isAdmin) {
      conditions.push(eq(tasks.ownerKey, normalizedScope.keyName));
    }

    const rows = await this.withDbTimeout(
      db.select().from(tasks).where(and(...conditions)).limit(1),
      'get-task-row'
    );

    const row = rows[0] as A2ATaskRow | undefined;
    if (!row) {
      throw new A2AServiceError('task not found', 404, 'TASK_NOT_FOUND');
    }

    return row;
  }

  private async recordEvent(taskId: string, eventType: string, payload: Record<string, unknown>) {
    const { db, schema } = this.ensureDb();
    const events = schema.a2aTaskEvents;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await db
        .select({ sequence: events.sequence })
        .from(events)
        .where(eq(events.taskId, taskId))
        .orderBy(desc(events.sequence))
        .limit(1);

      const nextSequence = (existing[0]?.sequence ?? 0) + 1;
      const now = new Date();
      const createdAt = toDbTimestamp(now, getCurrentDialect()) as string & Date;

      try {
        await db.insert(events).values({
          taskId,
          eventType,
          sequence: nextSequence,
          payload: JSON.stringify(payload),
          createdAt,
        });
        const eventRecord: A2ATaskEventRecord = {
          taskId,
          eventType,
          sequence: nextSequence,
          payload,
          createdAt: now.toISOString(),
        };
        this.emit('task-event', eventRecord);
        return;
      } catch (error) {
        if (!isUniqueConstraintViolation(error) || attempt === 4) {
          throw error;
        }
      }
    }
  }

  private ensureTransitionAllowed(current: A2ATaskState, next: A2ATaskState): void {
    if (current === next) {
      return;
    }

    if (TERMINAL_STATES.has(current)) {
      throw new A2AServiceError('task is already terminal', 422, 'INVALID_TASK_STATE');
    }

    const allowedTargets = ALLOWED_TRANSITIONS[current];
    if (!allowedTargets.has(next)) {
      throw new A2AServiceError(
        `invalid task transition: ${current} -> ${next}`,
        422,
        'INVALID_TASK_STATE'
      );
    }
  }

  private getIdempotencyCutoff(now: Date): Date {
    const cutoffMs = now.getTime() - this.idempotencyRetentionHours * 60 * 60 * 1000;
    return new Date(cutoffMs);
  }

  private async clearExpiredIdempotencyKeys(now: Date): Promise<void> {
    const nowMs = now.getTime();
    if (nowMs - this.lastIdempotencyCleanupAtMs < 10 * 60 * 1000) {
      return;
    }

    const { db, schema } = this.ensureDb();
    const tasks = schema.a2aTasks;
    const cutoff = this.getIdempotencyCutoff(now);
    const cutoffDb = toDbTimestamp(cutoff, getCurrentDialect()) as string & Date;
    const nowDb = toDbTimestamp(now, getCurrentDialect()) as string & Date;

    await db
      .update(tasks)
      .set({
        idempotencyKey: null,
        updatedAt: nowDb,
      })
      .where(and(isNotNull(tasks.idempotencyKey), lt(tasks.createdAt, cutoffDb)));

    this.lastIdempotencyCleanupAtMs = nowMs;
  }

  isTerminalState(state: A2ATaskState): boolean {
    return TERMINAL_STATES.has(state);
  }

  getPublicAgentCard(baseUrl: string): A2AAgentCard {
    return {
      name: 'Plexus A2A Gateway',
      description: 'Unified LLM gateway with A2A task orchestration support',
      version: '0.3.0',
      url: `${baseUrl}/a2a`,
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      skills: [
        {
          id: 'proxy-routing',
          name: 'Provider Routing',
          description: 'Routes model requests across configured providers',
          tags: ['routing', 'llm-gateway'],
        },
        {
          id: 'task-orchestration',
          name: 'Task Orchestration',
          description: 'Manages asynchronous task lifecycle and status',
          tags: ['tasks', 'async'],
        },
      ],
      defaultInputModes: ['application/json', 'text/plain'],
      defaultOutputModes: ['application/json', 'text/plain'],
      additionalInterfaces: [
        {
          protocol: 'a2a',
          transport: 'http+json',
          url: `${baseUrl}/a2a`,
        },
      ],
      metadata: {
        product: 'plexus',
      },
    };
  }

  getExtendedAgentCard(baseUrl: string): A2AAgentCard {
    const card = this.getPublicAgentCard(baseUrl);
    return {
      ...card,
      metadata: {
        ...(card.metadata || {}),
        adminKeyConfigured: Boolean(getConfig().adminKey),
      },
    };
  }

  async sendMessage(input: SendMessageInput, scope?: A2AAccessScope): Promise<A2ATask> {
    if (!input.message || !Array.isArray(input.message.parts) || input.message.parts.length === 0) {
      throw new A2AServiceError('message.parts is required', 400, 'INVALID_REQUEST');
    }

    const normalizedScope = this.normalizeScope(scope);
    const { db, schema } = this.ensureDb();
    const tasks = schema.a2aTasks;
    const now = new Date();
    const nowDb = toDbTimestamp(now, getCurrentDialect()) as string & Date;
    const rawIdempotencyKey = input.configuration?.idempotencyKey?.trim() || null;
    const idempotencyKey = rawIdempotencyKey ? this.buildScopedIdempotencyKey(normalizedScope.keyName, rawIdempotencyKey) : null;
    const requestMessage = JSON.stringify(input.message);

    await this.clearExpiredIdempotencyKeys(now);

    if (idempotencyKey) {
      const idempotencyCutoff = this.getIdempotencyCutoff(now);
      const existing = await this.withDbTimeout(
        db.select().from(tasks).where(eq(tasks.idempotencyKey, idempotencyKey)).limit(1),
        'lookup-idempotency-key'
      );

      const first = existing[0] as A2ATaskRow | undefined;
      if (first) {
        const createdAtIso = toIsoString(first.createdAt);
        const createdAt = createdAtIso ? new Date(createdAtIso) : null;
        const isExpired = !createdAt || createdAt.getTime() <= idempotencyCutoff.getTime();

        if (isExpired) {
          await this.withDbTimeout(
            db
              .update(tasks)
              .set({
                idempotencyKey: null,
                updatedAt: nowDb,
              })
              .where(eq(tasks.id, first.id)),
            'clear-expired-idempotency-key'
          );
        } else {
          if ((first.requestMessage || '') !== requestMessage) {
            throw new A2AServiceError(
              'idempotency key already used with different payload',
              409,
              'IDEMPOTENCY_CONFLICT'
            );
          }

          return this.mapTaskRow(first);
        }
      }
    }

    const taskId = input.taskId?.trim() || crypto.randomUUID();
    const contextId = input.contextId?.trim() || crypto.randomUUID();
    const agentId = input.agentId?.trim() || 'plexus-local';

    await this.withDbTimeout(
      db.insert(tasks).values({
        id: taskId,
        contextId,
        ownerKey: normalizedScope.keyName,
        ownerAttribution: normalizedScope.attribution || null,
        agentId,
        status: 'submitted',
        latestMessage: null,
        requestMessage,
        artifacts: JSON.stringify([]),
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        idempotencyKey,
        errorCode: null,
        errorMessage: null,
        submittedAt: nowDb,
        startedAt: null,
        completedAt: null,
        canceledAt: null,
        createdAt: nowDb,
        updatedAt: nowDb,
      }),
      'insert-task'
    );

    await this.recordEvent(taskId, 'task-status-update', {
      state: 'submitted',
      timestamp: now.toISOString(),
    });

    const created = await this.withDbTimeout(
      db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1),
      'fetch-created-task'
    );
    const createdRow = created[0] as A2ATaskRow | undefined;

    if (!createdRow) {
      throw new A2AServiceError('failed to persist task', 500, 'INTERNAL_ERROR');
    }

    return this.mapTaskRow(createdRow);
  }

  async getTask(taskId: string, scope?: A2AAccessScope): Promise<A2ATask> {
    const row = await this.getTaskRowOrThrow(taskId, scope);
    return this.mapTaskRow(row);
  }

  async listTaskEvents(
    taskId: string,
    options?: { afterSequence?: number; limit?: number },
    scope?: A2AAccessScope
  ): Promise<A2ATaskEventRecord[]> {
    await this.getTaskRowOrThrow(taskId, scope);
    const { db, schema } = this.ensureDb();
    const events = schema.a2aTaskEvents;
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 200));

    const conditions = [eq(events.taskId, taskId)];
    if ((options?.afterSequence ?? 0) > 0) {
      conditions.push(gt(events.sequence, options?.afterSequence as number));
    }

    const rows = await this.withDbTimeout(
      db
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.sequence))
        .limit(limit),
      'list-task-events'
    );

    return rows.map((row: unknown) => {
      const typed = row as {
        taskId: string;
        eventType: string;
        sequence: number;
        payload: string;
        createdAt: string | Date;
      };
      return {
        taskId: typed.taskId,
        eventType: typed.eventType,
        sequence: typed.sequence,
        payload: this.jsonParse<Record<string, unknown>>(typed.payload, {}),
        createdAt: toIsoString(typed.createdAt) || new Date().toISOString(),
      };
    });
  }

  async listTasks(input: ListTasksInput, scope?: A2AAccessScope): Promise<{ tasks: A2ATask[]; total: number }> {
    const normalizedScope = this.normalizeScope(scope);
    const { db, schema } = this.ensureDb();
    const tasks = schema.a2aTasks;
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);

    const conditions = [];
    if (!normalizedScope.isAdmin) {
      conditions.push(eq(tasks.ownerKey, normalizedScope.keyName));
    }
    if (input.contextId) {
      conditions.push(eq(tasks.contextId, input.contextId));
    }
    if (input.status) {
      conditions.push(eq(tasks.status, input.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      this.withDbTimeout(
        db.select().from(tasks).where(whereClause).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset),
        'list-tasks'
      ),
      this.withDbTimeout(db.select({ count: sql<number>`count(*)` }).from(tasks).where(whereClause), 'count-tasks'),
    ]);

    return {
      tasks: rows.map((row: unknown) => this.mapTaskRow(row as A2ATaskRow)),
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async cancelTask(taskId: string, reason?: string, scope?: A2AAccessScope): Promise<A2ATask> {
    return this.transitionTask(taskId, 'canceled', {
      reason: reason || null,
      errorCode: reason ? 'CANCELED_BY_CLIENT' : null,
      errorMessage: reason || null,
      eventType: 'task-status-update',
    }, scope);
  }

  async transitionTask(
    taskId: string,
    nextState: A2ATaskState,
    options?: {
      reason?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      latestMessage?: A2AMessage | null;
      artifacts?: A2AArtifact[] | null;
      eventType?: string;
    },
    scope?: A2AAccessScope
  ): Promise<A2ATask> {
    const row = await this.getTaskRowOrThrow(taskId, scope);
    const { db, schema } = this.ensureDb();
    const tasks = schema.a2aTasks;

    const currentState = this.normalizeTaskState(row.status);
    this.ensureTransitionAllowed(currentState, nextState);

    const now = new Date();
    const nowDb = toDbTimestamp(now, getCurrentDialect()) as string & Date;
    const updateValues: Record<string, unknown> = {
      status: nextState,
      updatedAt: nowDb,
    };

    if (nextState === 'working' && !row.startedAt) {
      updateValues.startedAt = nowDb;
    }

    if (nextState === 'canceled') {
      updateValues.canceledAt = nowDb;
    }

    if (TERMINAL_STATES.has(nextState)) {
      updateValues.completedAt = nowDb;
    }

    if (options?.errorCode !== undefined) {
      updateValues.errorCode = options.errorCode;
    }
    if (options?.errorMessage !== undefined) {
      updateValues.errorMessage = options.errorMessage;
    }
    if (options?.latestMessage !== undefined) {
      updateValues.latestMessage = options.latestMessage ? JSON.stringify(options.latestMessage) : null;
    }
    if (options?.artifacts !== undefined) {
      updateValues.artifacts = options.artifacts ? JSON.stringify(options.artifacts) : JSON.stringify([]);
    }

    await this.withDbTimeout(db.update(tasks).set(updateValues).where(eq(tasks.id, taskId)), 'transition-task');

    await this.recordEvent(taskId, options?.eventType || 'task-status-update', {
      state: nextState,
      previousState: currentState,
      timestamp: now.toISOString(),
      reason: options?.reason || null,
    });

    return this.getTask(taskId, scope);
  }

  async createPushNotificationConfig(taskId: string, input: CreatePushNotificationConfigInput, scope?: A2AAccessScope) {
    if (!input.endpoint || !input.endpoint.trim()) {
      throw new A2AServiceError('endpoint is required', 400, 'INVALID_REQUEST');
    }

    const normalizedScope = this.normalizeScope(scope);
    const { db, schema } = this.ensureDb();
    const pushConfigs = schema.a2aPushNotificationConfigs;
    await this.getTaskRowOrThrow(taskId, scope);

    const now = new Date();
    const nowDb = toDbTimestamp(now, getCurrentDialect()) as string & Date;
    const configId = input.configId?.trim() || crypto.randomUUID();

    await this.withDbTimeout(
      db.insert(pushConfigs).values({
        taskId,
        ownerKey: normalizedScope.keyName,
        configId,
        endpoint: input.endpoint,
        authentication: input.authentication ? this.encryptPushAuthentication(input.authentication) : null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        enabled: 1,
        createdAt: nowDb,
        updatedAt: nowDb,
      }),
      'create-push-config'
    );

    const rows = await this.withDbTimeout(
      db
        .select()
        .from(pushConfigs)
        .where(and(eq(pushConfigs.taskId, taskId), eq(pushConfigs.configId, configId)))
        .limit(1),
      'get-created-push-config'
    );

    return this.mapPushConfigRow(rows[0] as A2APushConfigRow);
  }

  async getPushNotificationConfig(taskId: string, configId: string, scope?: A2AAccessScope) {
    const { db, schema } = this.ensureDb();
    const pushConfigs = schema.a2aPushNotificationConfigs;
    await this.getTaskRowOrThrow(taskId, scope);

    const rows = await this.withDbTimeout(
      db
        .select()
        .from(pushConfigs)
        .where(and(eq(pushConfigs.taskId, taskId), eq(pushConfigs.configId, configId)))
        .limit(1),
      'get-push-config'
    );

    const row = rows[0] as A2APushConfigRow | undefined;
    if (!row) {
      throw new A2AServiceError('push notification config not found', 404, 'TASK_NOT_FOUND');
    }

    return this.mapPushConfigRow(row);
  }

  async listPushNotificationConfigs(taskId: string, scope?: A2AAccessScope) {
    await this.getTaskRowOrThrow(taskId, scope);
    const { db, schema } = this.ensureDb();
    const pushConfigs = schema.a2aPushNotificationConfigs;
    const rows = await this.withDbTimeout(
      db.select().from(pushConfigs).where(eq(pushConfigs.taskId, taskId)).orderBy(desc(pushConfigs.createdAt)),
      'list-push-configs'
    );
    return rows.map((row: unknown) => this.mapPushConfigRow(row as A2APushConfigRow));
  }

  async deletePushNotificationConfig(taskId: string, configId: string, scope?: A2AAccessScope): Promise<void> {
    await this.getTaskRowOrThrow(taskId, scope);
    const { db, schema } = this.ensureDb();
    const pushConfigs = schema.a2aPushNotificationConfigs;

    const rows = await this.withDbTimeout(
      db
        .select()
        .from(pushConfigs)
        .where(and(eq(pushConfigs.taskId, taskId), eq(pushConfigs.configId, configId)))
        .limit(1),
      'get-push-config-for-delete'
    );

    if (!rows[0]) {
      throw new A2AServiceError('push notification config not found', 404, 'TASK_NOT_FOUND');
    }

    await this.withDbTimeout(
      db
        .delete(pushConfigs)
        .where(and(eq(pushConfigs.taskId, taskId), eq(pushConfigs.configId, configId))),
      'delete-push-config'
    );
  }
}

export function mapA2AServiceError(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof A2AServiceError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'code' in error &&
    'message' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return {
      statusCode: (error as { statusCode: number }).statusCode,
      code: (error as { code: string }).code,
      message: (error as { message: string }).message,
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'internal error',
  };
}
