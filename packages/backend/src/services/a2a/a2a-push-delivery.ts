import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import type { A2ATaskEventRecord } from './a2a-service';

type PushJob = {
  taskId: string;
  event: A2ATaskEventRecord;
  attempt: number;
};

type ServiceLike = {
  on(eventName: string, listener: (...args: any[]) => void): unknown;
  off(eventName: string, listener: (...args: any[]) => void): unknown;
  listPushNotificationConfigs(taskId: string): Promise<Array<{
    configId: string;
    endpoint: string;
    authentication: Record<string, unknown> | undefined;
    metadata: Record<string, unknown> | undefined;
    enabled: boolean;
  }>>;
};

function redactEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}/...`;
  } catch {
    return '[invalid-endpoint]';
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return true;
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    return true;
  }

  if (host.startsWith('10.') || host.startsWith('192.168.')) {
    return true;
  }

  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  return false;
}

function isPushEndpointAllowed(endpoint: string): boolean {
  const allowInsecure = process.env.A2A_PUSH_ALLOW_INSECURE_ENDPOINTS === 'true';

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    return false;
  }

  if (!allowInsecure && isBlockedHost(parsed.hostname)) {
    return false;
  }

  return true;
}

export class A2APushDeliveryService {
  private static instance: A2APushDeliveryService;
  private queue: PushJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: ((event: A2ATaskEventRecord) => void) | null = null;
  private service: ServiceLike | null = null;
  private active = false;
  private readonly maxQueueDepth = Number.isFinite(Number(process.env.A2A_PUSH_MAX_QUEUE_DEPTH || '10000'))
    ? Math.max(1, Number(process.env.A2A_PUSH_MAX_QUEUE_DEPTH || '10000'))
    : 10000;

  static getInstance(): A2APushDeliveryService {
    if (!A2APushDeliveryService.instance) {
      A2APushDeliveryService.instance = new A2APushDeliveryService();
    }
    return A2APushDeliveryService.instance;
  }

  start(service: ServiceLike): void {
    if (this.active) {
      return;
    }

    this.active = true;
    this.service = service;
    this.listener = (event: A2ATaskEventRecord) => {
      if (this.queue.length >= this.maxQueueDepth) {
        logger.error(`A2A push queue is full (max=${this.maxQueueDepth}), dropping event for task ${event.taskId}`);
        return;
      }
      this.queue.push({ taskId: event.taskId, event, attempt: 0 });
    };
    service.on('task-event', this.listener);
    this.timer = setInterval(() => {
      void this.flushNow();
    }, 250);
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.listener && this.service) {
      this.service.off('task-event', this.listener);
    }
    this.listener = null;
    this.service = null;
    this.queue = [];
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  async flushNow(): Promise<void> {
    if (!this.service || this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.queue.length);
    for (const job of batch) {
      await this.processJob(job);
    }
  }

  private async processJob(job: PushJob): Promise<void> {
    if (!this.service) {
      return;
    }

    let configs: Array<{
      configId: string;
      endpoint: string;
      authentication: Record<string, unknown> | undefined;
      metadata: Record<string, unknown> | undefined;
      enabled: boolean;
    }> = [];

    try {
      configs = await this.service.listPushNotificationConfigs(job.taskId);
    } catch (error) {
      logger.error(`Failed to load push configs for task ${job.taskId}`, error);
      return;
    }

    if (configs.length === 0) {
      return;
    }

    for (const config of configs) {
      if (!config.enabled) {
        continue;
      }

      if (!isPushEndpointAllowed(config.endpoint)) {
        logger.warn(
          `Skipping push config ${config.configId}: blocked endpoint ${redactEndpoint(config.endpoint)}`
        );
        continue;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.authentication && config.authentication.type === 'bearer' && typeof config.authentication.token === 'string') {
        headers.authorization = `Bearer ${config.authentication.token}`;
      }

      if (config.authentication && typeof config.authentication.headers === 'object' && config.authentication.headers !== null) {
        for (const [key, value] of Object.entries(config.authentication.headers as Record<string, unknown>)) {
          if (typeof value === 'string') {
            headers[key] = value;
          }
        }
      }

      const payloadBody = JSON.stringify({
        configId: config.configId,
        taskId: job.taskId,
        eventType: job.event.eventType,
        sequence: job.event.sequence,
        createdAt: job.event.createdAt,
        payload: job.event.payload,
        metadata: config.metadata,
      });

      if (
        config.authentication &&
        config.authentication.type === 'hmac-sha256' &&
        typeof config.authentication.secret === 'string' &&
        config.authentication.secret.length > 0
      ) {
        headers['x-a2a-signature'] = crypto
          .createHmac('sha256', config.authentication.secret)
          .update(payloadBody)
          .digest('hex');
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
          response = await fetch(config.endpoint, {
            method: 'POST',
            headers,
            body: payloadBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new Error(`Push endpoint ${redactEndpoint(config.endpoint)} returned ${response.status}`);
        }
      } catch (error) {
        if (job.attempt < 3) {
          const nextAttempt = job.attempt + 1;
          const delayMs = 500 * Math.pow(2, nextAttempt - 1);
          setTimeout(() => {
            if (this.queue.length >= this.maxQueueDepth) {
              logger.error(`A2A push queue is full (max=${this.maxQueueDepth}), dropping retry for task ${job.taskId}`);
              return;
            }
            this.queue.push({ ...job, attempt: nextAttempt });
          }, delayMs);
        } else {
          logger.error(
            `Push notification delivery failed after retries for ${redactEndpoint(config.endpoint)}`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  }
}
