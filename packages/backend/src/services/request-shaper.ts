/**
 * Request Shaper Service
 *
 * Provides proactive rate limiting for low-RPM providers through an internal
 * singleton service with explicit lifecycle management.
 *
 * Lifecycle:
 * - initialize(config): Called after DB + config readiness at startup
 * - reload(config): Called on config file changes (hot reload)
 * - stop(): Called during graceful shutdown
 *
 * Shapes low-RPM provider traffic with per-provider or per-model budgets,
 * bounded queueing, and read-only runtime status.
 */

import { logger } from '../utils/logger';
import { getDatabase, getSchema, getCurrentDialect } from '../db/client';
import { and, eq } from 'drizzle-orm';
import { toDbTimestampMs } from '../utils/normalize';
import type { PlexusConfig, ProviderConfig, ShaperRuntimeConfig } from '../config';

/**
 * Unique key for a provider/model combination being shaped.
 * Format: "provider:model"
 */
type ShaperKey = string;

/**
 * Represents a request waiting in the queue.
 */
interface QueueWaiter {
  /** Unique request ID */
  id: string;
  /** Timestamp when queued */
  enqueueTime: number;
  /** Timeout deadline */
  timeoutAt: number;
  /** Promise resolver */
  resolve: (value: QueueResult) => void;
  /** Promise rejecter (for queue full errors) */
  reject: (reason: Error) => void;
}

/**
 * Result type for acquirePermit.
 */
export type QueueResult =
  | { type: 'immediate' }
  | { type: 'queued'; waitTimeMs: number }
  | { type: 'timeout' };

/**
 * Error thrown when queue is full.
 */
export class QueueFullError extends Error {
  constructor(provider: string, model: string, queueDepth: number) {
    super(`Queue full for ${provider}:${model} (max depth: ${queueDepth})`);
    this.name = 'QueueFullError';
  }
}

/**
 * Runtime state for a single shaped provider/model target.
 */
interface ShaperTarget {
  /** Provider identifier */
  provider: string;
  /** Model identifier */
  model: string;
  /** Canonical alias key when the limiter only applies to a single alias. */
  alias?: string;
  scope: 'provider' | 'model' | 'alias';
  isExplicit: boolean;
  /** Requests per minute limit */
  requestsPerMinute: number;
  /** Queue depth limit (optional) */
  queueDepth?: number;
  /** Queue timeout in milliseconds */
  queueTimeoutMs: number;
  /** Maximum budget (currently equal to the configured RPM). */
  maxBudget: number;
  /** Current budget (permits available) */
  currentBudget: number;
  /** Last time budget was refilled */
  lastRefillAt: number;
  /** Current queue depth (tracked in-memory). */
  currentQueueDepth: number;
  /**
   * Pending queue for requests waiting on budget.
   * FIFO queue with timeout handling.
   */
  queue: Array<QueueWaiter>;
  timeoutCount: number;
  dropCount: number;
}

/**
 * Status information for a shaped target (read-only API).
 */
export interface ShaperTargetStatus {
  provider: string;
  model: string;
  alias?: string;
  scope: 'provider' | 'model' | 'alias';
  isExplicit: boolean;
  requestsPerMinute: number;
  queueDepth?: number;
  queueTimeoutMs: number;
  maxBudget: number;
  currentBudget: number;
  lastRefillAt: number;
  currentQueueDepth: number;
  queueWaiters: number;
  oldestWaitMs: number | null;
  timeoutCount: number;
  dropCount: number;
}

/**
 * Summary status across all shaped targets.
 */
export interface ShaperStatus {
  totalTargets: number;
  targets: ShaperTargetStatus[];
}

/**
 * Singleton request shaper service for low-RPM provider rate limiting.
 *
 * Pattern matches QuotaScheduler for lifecycle consistency.
 */
export class RequestShaper {
  private static instance: RequestShaper | null = null;

  /**
   * In-memory state keyed by provider:model[:alias].
   * Alias-specific targets shadow the shared provider:model limiter when present.
   */
  private targets: Map<ShaperKey, ShaperTarget> = new Map();

  /** Runtime config from config.shaper */
  private runtimeConfig: ShaperRuntimeConfig | null = null;

  /** Cleanup interval timer */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether the service has been initialized */
  private initialized = false;

  private constructor() {}

  /**
   * Get the singleton instance of RequestShaper.
   */
  static getInstance(): RequestShaper {
    if (!RequestShaper.instance) {
      RequestShaper.instance = new RequestShaper();
    }
    return RequestShaper.instance;
  }

}
