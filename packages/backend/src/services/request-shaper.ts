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

  /**
   * Initialize the shaper service from configuration.
   * Must be called after database and config are ready.
   *
   * @param config - The loaded Plexus configuration
   */
  async initialize(config: PlexusConfig): Promise<void> {
    if (this.initialized) {
      logger.warn('[RequestShaper] Already initialized, skipping');
      return;
    }

    logger.info('[RequestShaper] Initializing...');

    // Store runtime config for defaults
    this.runtimeConfig = config.shaper;

    // Discover shaped targets from provider configurations
    const shapedTargets = this.discoverShapedTargets(config);

    if (shapedTargets.length === 0) {
      logger.info('[RequestShaper] No providers with rate_limit configured, service is no-op');
      this.initialized = true;
      return;
    }

    // Initialize each target (optionally hydrating from persistence)
    for (const target of shapedTargets) {
      await this.initializeTarget(target);
    }

    // Start cleanup timer for stale queue entries
    this.startCleanupTimer();

    this.initialized = true;
    logger.info(`[RequestShaper] Initialized with ${this.targets.size} shaped target(s)`);
  }

  /**
   * Reload configuration, safely adding/removing shaped targets.
   * Called during config file hot-reload.
   *
   * @param config - The updated Plexus configuration
   */
  async reload(config: PlexusConfig): Promise<void> {
    if (!this.initialized) {
      logger.warn('[RequestShaper] Reload called before initialization');
      return;
    }

    logger.info('[RequestShaper] Reloading configuration...');

    // Update runtime config
    this.runtimeConfig = config.shaper;

    // Discover new target set
    const newTargets = this.discoverShapedTargets(config);
    const newKeys = new Set(newTargets.map((t) => this.makeKey(t.provider, t.model, t.alias)));
    const existingKeys = new Set(this.targets.keys());

    // Remove targets that are no longer configured
    for (const key of existingKeys) {
      if (!newKeys.has(key)) {
        // Reject any pending queue entries before removing
        const target = this.targets.get(key);
        if (target) {
          this.clearQueue(target, 'Target removed during reload');
        }
        this.targets.delete(key);
        logger.info(`[RequestShaper] Removed target ${key}`);
      }
    }

    // Add new targets and update existing ones
    for (const target of newTargets) {
      const key = this.makeKey(target.provider, target.model, target.alias);
      if (!this.targets.has(key)) {
        await this.initializeTarget(target);
        logger.info(`[RequestShaper] Added target ${key}`);
        continue;
      }

      const existing = this.targets.get(key);
      if (!existing) {
        continue;
      }

      existing.requestsPerMinute = target.requestsPerMinute;
      existing.queueDepth = target.queueDepth;
      existing.queueTimeoutMs = target.queueTimeoutMs;
      existing.scope = target.scope;
      existing.isExplicit = target.isExplicit;
      existing.maxBudget = target.requestsPerMinute;
      existing.currentBudget = Math.min(existing.currentBudget, existing.maxBudget);
    }

    // If we went from no targets to some targets, start cleanup timer
    if (this.targets.size > 0 && !this.cleanupInterval) {
      this.startCleanupTimer();
    }

    // If we now have no targets, stop cleanup timer
    if (this.targets.size === 0 && this.cleanupInterval) {
      this.stopCleanupTimer();
    }

    logger.info(`[RequestShaper] Reload complete: ${this.targets.size} active target(s)`);
  }

  /**
   * Stop the shaper service and clean up all state.
   * Called during graceful shutdown.
   */
  stop(): void {
    if (!this.initialized) {
      return;
    }

    logger.info('[RequestShaper] Stopping...');

    // Stop cleanup timer
    this.stopCleanupTimer();

    // Clear all in-memory state (reject pending queue entries)
    for (const target of this.targets.values()) {
      this.clearQueue(target, 'Service stopped');
    }
    this.targets.clear();
    this.initialized = false;
    this.runtimeConfig = null;

    logger.info('[RequestShaper] Stopped and state cleared');
  }


  /**
   * Get number of queued waiters for a provider/model.
   * Alias for getQueueDepth for clarity.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Number of queued requests (0 if not shaped)
   */
  getQueueWaiters(provider: string, model: string, alias?: string): number {
    return this.getQueueDepth(provider, model, alias);
  }

  /**
   * Clean up expired requests from all queues.
   * Called periodically by the cleanup timer.
   * Removes timed-out entries and resolves them with timeout result.
   */
  cleanupExpiredRequests(): void {
    const now = Date.now();

    for (const [key, target] of this.targets.entries()) {
      if (target.queue.length === 0) {
        continue;
      }

      const expiredWaiters: QueueWaiter[] = [];
      const remainingWaiters: QueueWaiter[] = [];

      for (const waiter of target.queue) {
        if (waiter.timeoutAt <= now) {
          expiredWaiters.push(waiter);
        } else {
          remainingWaiters.push(waiter);
        }
      }

      // Update queue with remaining waiters
      target.queue = remainingWaiters;
      target.currentQueueDepth = remainingWaiters.length;
      target.timeoutCount += expiredWaiters.length;

      // Resolve expired waiters with timeout result
      for (const waiter of expiredWaiters) {
        logger.debug(`[RequestShaper] Request ${waiter.id} timed out`);
        waiter.resolve({ type: 'timeout' });
      }

      if (expiredWaiters.length > 0) {
        logger.debug(
          `[RequestShaper] Cleaned up ${expiredWaiters.length} expired requests from ${key}`
        );
      }
    }
  }


}
