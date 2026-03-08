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


  /**
   * Get status for a specific provider/model.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Status or null if not shaped
   */
  getStatus(provider: string, model: string, alias?: string): ShaperTargetStatus | null {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return null;
    }
    this.refillBudgetIfNeeded(key);
    return this.toStatus(target);
  }

  /**
   * Get status for all shaped targets.
   */
  getAllStatus(): ShaperStatus {
    const targets: ShaperTargetStatus[] = [];
    for (const [key, target] of this.targets.entries()) {
      this.refillBudgetIfNeeded(key);
      targets.push(this.toStatus(target));
    }
    return {
      totalTargets: targets.length,
      targets,
    };
  }

  /**
   * Check if a provider/model is being shaped.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   */
  isShaped(provider: string, model: string, alias?: string): boolean {
    const key = this.resolveLookupKey(provider, model, alias);
    return this.targets.has(key);
  }

  /**
   * Check if a request can be dispatched now (budget available).
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns true if budget is available
   */
  canDispatchNow(provider: string, model: string, alias?: string): boolean {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return true; // Not shaped = always allow
    }

    this.refillBudgetIfNeeded(key);
    return target.currentBudget > 0;
  }

  /**
   * Attempt to consume 1 permit from the budget.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns true if permit was consumed, false if no budget available
   */
  consumeBudget(provider: string, model: string, alias?: string): boolean {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return true; // Not shaped = always allow (no-op)
    }

    this.refillBudgetIfNeeded(key);

    if (target.currentBudget > 0) {
      target.currentBudget--;
      this.persistToPersistence(target).catch((error) => {
        logger.debug(`[RequestShaper] Failed to persist budget change: ${error}`);
      });
      return true;
    }

    return false;
  }

  /**
   * Get remaining budget (permits available now).
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Current available permits (0 if not shaped)
   */
  getRemainingBudget(provider: string, model: string, alias?: string): number {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return 0; // Not shaped = no budget tracking
    }

    this.refillBudgetIfNeeded(key);
    return target.currentBudget;
  }

  /**
   * Calculate milliseconds until next permit is available.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Milliseconds to wait (0 if budget available now)
   */
  getWaitTimeMs(provider: string, model: string, alias?: string): number {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return 0; // Not shaped = no wait
    }

    const now = Date.now();
    this.refillBudgetIfNeeded(key, now);

    // If budget is available now, no wait needed
    if (target.currentBudget > 0) {
      return 0;
    }

    // Calculate time until next permit is available
    const msPerPermit = 60000 / target.requestsPerMinute;
    const timeSinceLastRefill = now - target.lastRefillAt;
    const timeUntilNext = msPerPermit - (timeSinceLastRefill % msPerPermit);

    return Math.ceil(timeUntilNext);
  }

  /**
   * Lazily refill budget based on elapsed time since last refill.
   * Uses token bucket algorithm with lazy refill on access.
   *
   * @param key - Shaper key (provider:model)
   * @param now - Optional timestamp for testing (defaults to Date.now())
   */
  refillBudgetIfNeeded(key: string, now?: number): void {
    const target = this.targets.get(key);
    if (!target) {
      return;
    }

    const currentTime = now ?? Date.now();
    const elapsedMs = currentTime - target.lastRefillAt;

    // Calculate how many tokens to add based on elapsed time
    // Refill rate: rpm tokens per 60 seconds = 1 token per (60000 / rpm) ms
    const msPerPermit = 60000 / target.requestsPerMinute;
    const tokensToAdd = Math.floor(elapsedMs / msPerPermit);

    if (tokensToAdd > 0) {
      target.currentBudget = Math.min(target.maxBudget, target.currentBudget + tokensToAdd);
      // Update lastRefillAt to reflect only the time consumed for whole tokens
      target.lastRefillAt = target.lastRefillAt + tokensToAdd * msPerPermit;
    }
  }

  /**
   * Get the total count of shaped targets.
   */
  getShapedCount(): number {
    return this.targets.size;
  }


  /**
   * Acquire a permit for the given provider/model.
   * Main API for dispatcher integration.
   *
   * - If budget available: consume immediately, return immediate result
   * - If budget exhausted and queue not full: enqueue, return promise
   * - If queue full: reject immediately with QueueFullError
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Promise resolving to QueueResult
   * @throws QueueFullError if queue is full
   */
  async acquirePermit(provider: string, model: string, alias?: string): Promise<QueueResult> {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);

    // Not shaped = no queueing needed, return immediate
    if (!target) {
      return { type: 'immediate' };
    }

    // Refill budget if needed before checking
    this.refillBudgetIfNeeded(key);

    // Budget available: consume and return immediately
    if (target.currentBudget > 0) {
      target.currentBudget--;
      this.persistToPersistence(target).catch((error) => {
        logger.debug(`[RequestShaper] Failed to persist budget change: ${error}`);
      });
      return { type: 'immediate' };
    }

    // Budget exhausted: try to queue
    const queueDepth = target.queueDepth ?? 10;
    if (target.queue.length >= queueDepth) {
      target.dropCount++;
      logger.debug(`[RequestShaper] Dropped request for ${key} because queue is full`);
      throw new QueueFullError(provider, model, queueDepth);
    }

    // Create waiter entry
    const now = Date.now();
    const waiter: QueueWaiter = {
      id: `${key}:${now}:${Math.random().toString(36).slice(2, 9)}`,
      enqueueTime: now,
      timeoutAt: now + target.queueTimeoutMs,
      resolve: () => {},
      reject: () => {},
    };

    // Create promise that resolves when admitted or times out
    const promise = new Promise<QueueResult>((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });

    // Add to queue
    target.queue.push(waiter);
    target.currentQueueDepth = target.queue.length;

    logger.debug(
      `[RequestShaper] Queued request ${waiter.id} for ${key} (queue depth: ${target.queue.length})`
    );

    return promise;
  }

  /**
   * Release a permit back to the budget.
   * Called after request completes (success or failure).
   *
   * - Increments currentBudget (capped at maxBudget)
   * - If queue has waiters: dequeue next and resolve its promise
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   */
  releasePermit(provider: string, model: string, alias?: string): void {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);

    // Not shaped = no-op
    if (!target) {
      return;
    }

    // Increment budget (capped at maxBudget)
    target.currentBudget = Math.min(target.maxBudget, target.currentBudget + 1);

    // If queue has waiters, admit the next one (FIFO)
    this.admitNextIfAvailable(key);
  }

  /**
   * Get current queue depth for a provider/model.
   *
   * @param provider - Provider identifier
   * @param model - Model identifier
   * @returns Current queue size (0 if not shaped)
   */
  getQueueDepth(provider: string, model: string, alias?: string): number {
    const key = this.resolveLookupKey(provider, model, alias);
    const target = this.targets.get(key);
    if (!target) {
      return 0;
    }
    return target.queue.length;
  }

}
