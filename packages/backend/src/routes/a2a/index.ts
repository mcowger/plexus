import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { A2AService, mapA2AServiceError } from '../../services/a2a/a2a-service';
import { getConfig } from '../../config';

type RequestAuthContext = {
  keyName: string;
  attribution: string | null;
  isAdmin: boolean;
};

const requestAuthContext = new WeakMap<FastifyRequest, RequestAuthContext>();

type SubscribeQuery = {
  afterSequence?: string;
  a2a_version?: string;
  key?: string;
  admin_key?: string;
};

type SendMessageBody = {
  message: {
    role: 'user' | 'agent' | 'system';
    parts: Array<
      | { type: 'text'; text: string; metadata?: Record<string, unknown> }
      | {
          type: 'file';
          file: { name?: string; mimeType?: string; uri?: string; bytesBase64?: string };
          metadata?: Record<string, unknown>;
        }
      | { type: 'data'; data: Record<string, unknown>; metadata?: Record<string, unknown> }
    >;
    metadata?: Record<string, unknown>;
  };
  taskId?: string;
  contextId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  configuration?: {
    idempotencyKey?: string;
  };
};

type ListTasksQuery = {
  contextId?: string;
  status?:
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'auth-required'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'rejected';
  limit?: string;
  offset?: string;
};

type CancelTaskBody = {
  reason?: string;
};

type PushConfigBody = {
  configId?: string;
  config: {
    endpoint: string;
    authentication?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

type A2ACapability = 'streaming' | 'pushNotifications' | 'stateTransitionHistory';

type A2ARateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetAtMs: number;
};

const SUPPORTED_A2A_VERSIONS = new Set(['0.3', '0.3.0']);

class A2ARateLimiter {
  private readonly entries = new Map<string, { count: number; resetAtMs: number }>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxStreamRequests: number;
  private readonly maxBuckets: number;

  constructor() {
    const configuredWindow = Number(process.env.A2A_RATE_LIMIT_WINDOW_MS || '60000');
    const configuredMax = Number(process.env.A2A_RATE_LIMIT_MAX_REQUESTS || '120');
    const configuredStreamMax = Number(process.env.A2A_RATE_LIMIT_MAX_STREAM_REQUESTS || '30');
    const configuredMaxBuckets = Number(process.env.A2A_RATE_LIMIT_MAX_BUCKETS || '10000');

    this.windowMs = Number.isFinite(configuredWindow) && configuredWindow > 0 ? configuredWindow : 60000;
    this.maxRequests = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 120;
    this.maxStreamRequests = Number.isFinite(configuredStreamMax) && configuredStreamMax > 0 ? configuredStreamMax : 30;
    this.maxBuckets = Number.isFinite(configuredMaxBuckets) && configuredMaxBuckets > 0 ? configuredMaxBuckets : 10000;
  }

  private cleanupExpired(now: number): void {
    if (this.entries.size === 0) {
      return;
    }
    for (const [bucketKey, entry] of this.entries.entries()) {
      if (now >= entry.resetAtMs) {
        this.entries.delete(bucketKey);
      }
    }

    if (this.entries.size <= this.maxBuckets) {
      return;
    }

    const oldest = [...this.entries.entries()].sort((a, b) => a[1].resetAtMs - b[1].resetAtMs);
    const overflow = this.entries.size - this.maxBuckets;
    for (let index = 0; index < overflow; index += 1) {
      const bucket = oldest[index];
      if (!bucket) {
        break;
      }
      this.entries.delete(bucket[0]);
    }
  }

  check(request: FastifyRequest): A2ARateLimitResult {
    const keyName = getRequestScope(request)?.keyName || 'unknown';
    const routePath = (request.url || '').split('?')[0] || '';
    const isStreamRoute = routePath.endsWith('/subscribe') || routePath.endsWith('/message/stream');
    const threshold = isStreamRoute ? this.maxStreamRequests : this.maxRequests;
    const bucketKey = `${keyName}:${routePath}`;
    const now = Date.now();
    this.cleanupExpired(now);

    const current = this.entries.get(bucketKey);
    if (!current || now >= current.resetAtMs) {
      const resetAtMs = now + this.windowMs;
      this.entries.set(bucketKey, { count: 1, resetAtMs });
      return {
        allowed: true,
        retryAfterSeconds: 0,
        limit: threshold,
        remaining: Math.max(0, threshold - 1),
        resetAtMs,
      };
    }

    if (current.count >= threshold) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAtMs - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds,
        limit: threshold,
        remaining: 0,
        resetAtMs: current.resetAtMs,
      };
    }

    current.count += 1;
    this.entries.set(bucketKey, current);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      limit: threshold,
      remaining: Math.max(0, threshold - current.count),
      resetAtMs: current.resetAtMs,
    };
  }
}

const A2A_RATE_LIMIT_ENABLED = process.env.A2A_RATE_LIMIT_ENABLED !== 'false';
const a2aRateLimiter = new A2ARateLimiter();

function ensureVersionHeader(request: FastifyRequest, reply: FastifyReply): boolean {
  const versionHeader = request.headers['a2a-version'];
  const queryVersion =
    request.query && typeof request.query === 'object' && 'a2a_version' in request.query
      ? (request.query as { a2a_version?: unknown }).a2a_version
      : undefined;
  const resolvedVersion =
    typeof versionHeader === 'string' && versionHeader.trim().length > 0
      ? versionHeader
      : typeof queryVersion === 'string' && queryVersion.trim().length > 0
        ? queryVersion
        : null;
  if (!resolvedVersion) {
    reply.code(400).send({
      error: {
        code: 'INVALID_REQUEST',
        message: 'A2A-Version header is required',
      },
    });
    return false;
  }

  if (!SUPPORTED_A2A_VERSIONS.has(resolvedVersion)) {
    reply.code(400).send({
      error: {
        code: 'INVALID_REQUEST',
        message: `Unsupported A2A version: ${resolvedVersion}`,
        details: {
          supportedVersions: [...SUPPORTED_A2A_VERSIONS],
        },
      },
    });
    return false;
  }

  return true;
}

function setRequestScope(request: FastifyRequest, scope: RequestAuthContext): void {
  requestAuthContext.set(request, scope);
}

function getRequestScope(request: FastifyRequest): RequestAuthContext | null {
  return requestAuthContext.get(request) || null;
}

function requireRequestScope(request: FastifyRequest): RequestAuthContext {
  const scope = getRequestScope(request);
  if (!scope) {
    throw new Error('missing A2A request scope');
  }
  return scope;
}

function getBaseUrl(request: FastifyRequest): string {
  const host = request.headers.host || 'localhost';
  const protocol = request.protocol || 'http';
  return `${protocol}://${host}`;
}

function extractAuthToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.length > 0) {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7);
    }
    return authHeader;
  }

  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.length > 0) {
    return xApiKey;
  }

  const xGoogApiKey = request.headers['x-goog-api-key'];
  if (typeof xGoogApiKey === 'string' && xGoogApiKey.length > 0) {
    return xGoogApiKey;
  }

  const query = request.query;
  if (query && typeof query === 'object') {
    const key = (query as { key?: unknown }).key;
    if (typeof key === 'string' && key.length > 0) {
      return key;
    }
  }

  return null;
}

function isAuthorizedA2ARequest(request: FastifyRequest): boolean {
  const config = getConfig();
  const adminHeader = request.headers['x-admin-key'];
  const adminFromHeader = typeof adminHeader === 'string' ? adminHeader : undefined;

  const query = request.query;
  const adminFromQuery =
    query && typeof query === 'object' && typeof (query as { admin_key?: unknown }).admin_key === 'string'
      ? ((query as { admin_key?: string }).admin_key || '').trim()
      : '';

  if ((adminFromHeader && adminFromHeader === config.adminKey) || (adminFromQuery && adminFromQuery === config.adminKey)) {
    setRequestScope(request, { keyName: 'admin', attribution: null, isAdmin: true });
    return true;
  }

  const token = extractAuthToken(request);
  if (!token || !config.keys) {
    return false;
  }

  let secretPart: string;
  let attributionPart: string | null = null;
  const firstColonIndex = token.indexOf(':');
  if (firstColonIndex !== -1) {
    secretPart = token.substring(0, firstColonIndex);
    attributionPart = token.substring(firstColonIndex + 1).toLowerCase() || null;
  } else {
    secretPart = token;
  }

  const matched = Object.entries(config.keys).find(([_, keyConfig]) => (keyConfig as { secret: string }).secret === secretPart);
  if (!matched) {
    return false;
  }

  setRequestScope(request, { keyName: matched[0], attribution: attributionPart, isAdmin: false });
  return true;
}

function sendA2AError(reply: FastifyReply, error: unknown): void {
  const mapped = mapA2AServiceError(error);
  reply.code(mapped.statusCode).send({
    error: {
      code: mapped.code,
      message: mapped.message,
    },
  });
}

function sendCapabilityError(reply: FastifyReply, capability: A2ACapability): void {
  reply.code(422).send({
    error: {
      code: 'CAPABILITY_NOT_SUPPORTED',
      message: `Capability '${capability}' is not supported`,
    },
  });
}

function sendRateLimitedError(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  reply.header('Retry-After', String(retryAfterSeconds));
  return reply.code(429).send({
    error: {
      code: 'RATE_LIMITED',
      message: 'A2A rate limit exceeded',
      details: {
        retryAfterSeconds,
      },
    },
  });
}

function setRateLimitHeaders(reply: FastifyReply, result: A2ARateLimitResult): void {
  const resetInSeconds = Math.max(0, Math.ceil((result.resetAtMs - Date.now()) / 1000));
  reply.header('X-RateLimit-Limit', String(result.limit));
  reply.header('X-RateLimit-Remaining', String(result.remaining));
  reply.header('X-RateLimit-Reset', String(resetInSeconds));
}

function ensureCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  a2aService: A2AService,
  capability: A2ACapability
): boolean {
  const card = a2aService.getPublicAgentCard(getBaseUrl(request));
  if (card.capabilities?.[capability] !== true) {
    sendCapabilityError(reply, capability);
    return false;
  }

  return true;
}

function enforceRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!A2A_RATE_LIMIT_ENABLED) {
    return false;
  }

  const rateResult = a2aRateLimiter.check(request);
  setRateLimitHeaders(reply, rateResult);
  if (rateResult.allowed) {
    return false;
  }

  sendRateLimitedError(reply, rateResult.retryAfterSeconds);
  return true;
}

function readReplayCursor(request: FastifyRequest<{ Querystring: SubscribeQuery }>): number {
  const headerCursor = request.headers['last-event-id'];
  const queryCursor = request.query?.afterSequence;
  const headerValue = typeof headerCursor === 'string' ? Number(headerCursor) : Number.NaN;
  if (!Number.isNaN(headerValue) && Number.isFinite(headerValue) && headerValue >= 0) {
    return headerValue;
  }

  const queryValue = queryCursor ? Number(queryCursor) : Number.NaN;
  if (!Number.isNaN(queryValue) && Number.isFinite(queryValue) && queryValue >= 0) {
    return queryValue;
  }

  return 0;
}

function writeSseEvent(reply: FastifyReply, event: { eventType: string; sequence: number; data: unknown }): boolean {
  if (reply.raw.writableEnded || reply.raw.destroyed) {
    return false;
  }

  try {
    reply.raw.write(`id: ${event.sequence}\n`);
    reply.raw.write(`event: ${event.eventType}\n`);
    reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function validateSendMessageBody(body: SendMessageBody | undefined): string | null {
  if (!body || typeof body !== 'object') {
    return 'request body is required';
  }
  if (!body.message || typeof body.message !== 'object') {
    return 'message is required';
  }
  if (body.message.role !== 'user' && body.message.role !== 'agent' && body.message.role !== 'system') {
    return 'message.role must be user, agent, or system';
  }
  if (!Array.isArray(body.message.parts) || body.message.parts.length === 0) {
    return 'message.parts must contain at least one part';
  }
  for (const rawPart of body.message.parts as Array<Record<string, unknown>>) {
    const partType = typeof rawPart.type === 'string' ? rawPart.type : null;
    if (!partType) {
      return 'each message part must include a type';
    }
    if (partType === 'text') {
      if (typeof rawPart.text !== 'string' || rawPart.text.trim().length === 0) {
        return 'text part requires non-empty text';
      }
      continue;
    }
    if (partType === 'file') {
      if (!rawPart.file || typeof rawPart.file !== 'object') {
        return 'file part requires file object';
      }
      continue;
    }
    if (partType === 'data') {
      if (!rawPart.data || typeof rawPart.data !== 'object') {
        return 'data part requires data object';
      }
      continue;
    }
    return 'unsupported message part type';
  }

  if (body.configuration?.idempotencyKey !== undefined && typeof body.configuration.idempotencyKey !== 'string') {
    return 'configuration.idempotencyKey must be a string';
  }

  return null;
}

function isKnownTaskState(value: string): value is
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected' {
  return (
    value === 'submitted' ||
    value === 'working' ||
    value === 'input-required' ||
    value === 'auth-required' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled' ||
    value === 'rejected'
  );
}

function startSse(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

function closeSse(reply: FastifyReply): void {
  if (!reply.raw.writableEnded) {
    reply.raw.end();
  }
}

async function streamTaskEvents(
  request: FastifyRequest<{ Params: { taskId: string }; Querystring: SubscribeQuery }>,
  reply: FastifyReply,
  a2aService: A2AService,
  options?: { autoCloseAfterMs?: number }
): Promise<void> {
  const taskId = request.params.taskId;
  const scope = requireRequestScope(request);
  let cursor = readReplayCursor(request);
  const task = await a2aService.getTask(taskId, scope);

  startSse(reply);

  const replay = await a2aService.listTaskEvents(taskId, { afterSequence: cursor, limit: 500 }, scope);
  for (const event of replay) {
    const didWrite = writeSseEvent(reply, {
      eventType: event.eventType,
      sequence: event.sequence,
      data: {
        taskId: event.taskId,
        payload: event.payload,
        createdAt: event.createdAt,
      },
    });
    if (!didWrite) {
      break;
    }
    cursor = event.sequence;
  }

  if (a2aService.isTerminalState(task.status.state)) {
    closeSse(reply);
    return;
  }

  const listener = (event: { taskId: string; eventType: string; sequence: number; payload: Record<string, unknown>; createdAt: string }) => {
    if (event.taskId !== taskId || event.sequence <= cursor || reply.raw.writableEnded) {
      return;
    }

    cursor = event.sequence;
    const didWrite = writeSseEvent(reply, {
      eventType: event.eventType,
      sequence: event.sequence,
      data: {
        taskId: event.taskId,
        payload: event.payload,
        createdAt: event.createdAt,
      },
    });
    if (!didWrite) {
      cleanup();
      return;
    }

    const stateValue = event.payload.state;
    if (typeof stateValue === 'string' && isKnownTaskState(stateValue) && a2aService.isTerminalState(stateValue)) {
      cleanup();
      closeSse(reply);
    }
  };

  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) {
      reply.raw.write(': keepalive\n\n');
    }
  }, 15000);

  const timeout = options?.autoCloseAfterMs
    ? setTimeout(() => {
        cleanup();
        closeSse(reply);
      }, options.autoCloseAfterMs)
    : null;

  const cleanup = () => {
    clearInterval(heartbeat);
    if (timeout) {
      clearTimeout(timeout);
    }
    a2aService.off('task-event', listener);
    request.raw.off('close', cleanup);
  };

  a2aService.on('task-event', listener);
  request.raw.on('close', cleanup);
}

export async function registerA2ARoutes(fastify: FastifyInstance) {
  const a2aService = A2AService.getInstance();

  fastify.get('/.well-known/agent-card.json', async (request, reply) => {
    return reply.send(a2aService.getPublicAgentCard(getBaseUrl(request)));
  });

  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('onRequest', async (request, reply) => {
      if (isAuthorizedA2ARequest(request)) {
        return;
      }

      return reply.code(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Unauthorized',
        },
      });
    });

    protectedRoutes.get('/a2a/extendedAgentCard', async (request, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      return reply.send(a2aService.getExtendedAgentCard(getBaseUrl(request)));
    });

    protectedRoutes.post('/a2a/message/send', async (request: FastifyRequest<{ Body: SendMessageBody }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      try {
        const body = request.body;
        const bodyError = validateSendMessageBody(body);
        if (bodyError) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REQUEST',
              message: bodyError,
            },
          });
        }
        const scope = requireRequestScope(request);
        const task = await a2aService.sendMessage({
          message: body.message,
          taskId: body?.taskId,
          contextId: body?.contextId,
          agentId: body?.agentId,
          metadata: body?.metadata,
          configuration: body?.configuration,
        }, scope);
        return reply.code(200).send({ task });
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.post('/a2a/message/stream', async (request: FastifyRequest<{ Body: SendMessageBody }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      if (!ensureCapability(request, reply, a2aService, 'streaming')) {
        return;
      }
      try {
        const body = request.body;
        const bodyError = validateSendMessageBody(body);
        if (bodyError) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REQUEST',
              message: bodyError,
            },
          });
        }
        const scope = requireRequestScope(request);
        const task = await a2aService.sendMessage({
          message: body.message,
          taskId: body?.taskId,
          contextId: body?.contextId,
          agentId: body?.agentId,
          metadata: body?.metadata,
          configuration: body?.configuration,
        }, scope);

        const streamRequest = {
          ...request,
          params: { taskId: task.id },
          query: {},
        } as FastifyRequest<{ Params: { taskId: string }; Querystring: SubscribeQuery }>;
        setRequestScope(streamRequest, scope);

        await streamTaskEvents(streamRequest, reply, a2aService, { autoCloseAfterMs: 5000 });
        return;
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.get('/a2a/tasks/:taskId', async (request: FastifyRequest<{ Params: { taskId: string } }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      try {
        const scope = requireRequestScope(request);
        const task = await a2aService.getTask(request.params.taskId, scope);
        return reply.send({ task });
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.get('/a2a/tasks', async (request: FastifyRequest<{ Querystring: ListTasksQuery }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      try {
        const scope = requireRequestScope(request);
        const { contextId, status, limit, offset } = request.query || {};
        const tasks = await a2aService.listTasks({
          contextId,
          status,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        }, scope);
        return reply.send(tasks);
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.post(
      '/a2a/tasks/:taskId/cancel',
      async (request: FastifyRequest<{ Params: { taskId: string }; Body: CancelTaskBody }>, reply) => {
        if (enforceRateLimit(request, reply)) {
          return;
        }
        if (!ensureVersionHeader(request, reply)) {
          return;
        }
        try {
          const scope = requireRequestScope(request);
          const task = await a2aService.cancelTask(request.params.taskId, request.body?.reason, scope);
          return reply.send({ task });
        } catch (error) {
          return sendA2AError(reply, error);
        }
      }
    );

    protectedRoutes.post('/a2a/tasks/:taskId/subscribe', async (request: FastifyRequest<{ Params: { taskId: string }; Querystring: SubscribeQuery }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      if (!ensureCapability(request, reply, a2aService, 'streaming')) {
        return;
      }
      try {
        await streamTaskEvents(request, reply, a2aService);
        return;
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.get('/a2a/tasks/:taskId/subscribe', async (request: FastifyRequest<{ Params: { taskId: string }; Querystring: SubscribeQuery }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      if (!ensureCapability(request, reply, a2aService, 'streaming')) {
        return;
      }
      try {
        await streamTaskEvents(request, reply, a2aService);
        return;
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.post(
      '/a2a/tasks/:taskId/pushNotificationConfigs',
      async (request: FastifyRequest<{ Params: { taskId: string }; Body: PushConfigBody }>, reply) => {
        if (enforceRateLimit(request, reply)) {
          return;
        }
        if (!ensureVersionHeader(request, reply)) {
          return;
        }
        if (!ensureCapability(request, reply, a2aService, 'pushNotifications')) {
          return;
        }
        try {
          const scope = requireRequestScope(request);
          const body = request.body;
          const config = await a2aService.createPushNotificationConfig(request.params.taskId, {
            configId: body?.configId,
            endpoint: body?.config?.endpoint,
            authentication: body?.config?.authentication,
            metadata: body?.config?.metadata,
          }, scope);
          return reply.code(201).send({ config });
        } catch (error) {
          return sendA2AError(reply, error);
        }
      }
    );

    protectedRoutes.get(
      '/a2a/tasks/:taskId/pushNotificationConfigs/:configId',
      async (request: FastifyRequest<{ Params: { taskId: string; configId: string } }>, reply) => {
        if (enforceRateLimit(request, reply)) {
          return;
        }
        if (!ensureVersionHeader(request, reply)) {
          return;
        }
        if (!ensureCapability(request, reply, a2aService, 'pushNotifications')) {
          return;
        }
        try {
          const scope = requireRequestScope(request);
          const config = await a2aService.getPushNotificationConfig(request.params.taskId, request.params.configId, scope);
          return reply.send({ config });
        } catch (error) {
          return sendA2AError(reply, error);
        }
      }
    );

    protectedRoutes.get('/a2a/tasks/:taskId/pushNotificationConfigs', async (request: FastifyRequest<{ Params: { taskId: string } }>, reply) => {
      if (enforceRateLimit(request, reply)) {
        return;
      }
      if (!ensureVersionHeader(request, reply)) {
        return;
      }
      if (!ensureCapability(request, reply, a2aService, 'pushNotifications')) {
        return;
      }
      try {
        const scope = requireRequestScope(request);
        const configs = await a2aService.listPushNotificationConfigs(request.params.taskId, scope);
        return reply.send({ configs });
      } catch (error) {
        return sendA2AError(reply, error);
      }
    });

    protectedRoutes.delete(
      '/a2a/tasks/:taskId/pushNotificationConfigs/:configId',
      async (request: FastifyRequest<{ Params: { taskId: string; configId: string } }>, reply) => {
        if (enforceRateLimit(request, reply)) {
          return;
        }
        if (!ensureVersionHeader(request, reply)) {
          return;
        }
        if (!ensureCapability(request, reply, a2aService, 'pushNotifications')) {
          return;
        }
        try {
          const scope = requireRequestScope(request);
          await a2aService.deletePushNotificationConfig(request.params.taskId, request.params.configId, scope);
          return reply.code(204).send();
        } catch (error) {
          return sendA2AError(reply, error);
        }
      }
    );
  });
}
