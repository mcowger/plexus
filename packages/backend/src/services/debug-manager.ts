import { UsageStorageService } from './usage-storage';
import { logger } from '../utils/logger';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { getCurrentKeyName, setCurrentRequestId } from './request-context';

export interface DebugLogRecord {
  requestId: string;
  apiKey?: string | null;
  rawRequest?: any;
  transformedRequest?: any;
  rawResponse?: any;
  transformedResponse?: any;
  rawResponseSnapshot?: any;
  transformedResponseSnapshot?: any;
  requestHeaders?: Record<string, string | string[]>;
  responseHeaders?: Record<string, string>;
  responseStatus?: number;
  provider?: string;
  createdAt?: number;
  /**
   * When true, this log is persisted on flush even if debug capture is not
   * otherwise enabled for its key. Set by the "capture trace on error" mode
   * when a request writes an inference error or triggers a cooldown.
   */
  forcePersist?: boolean;
}

export class DebugManager {
  private static instance: DebugManager;
  private storage: UsageStorageService | null = null;
  private enabledGlobal: boolean = false;
  private captureOnError: boolean = false;
  private enabledKeys: Set<string> = new Set();
  private providerFilter: string[] | null = null;
  private pendingLogs: Map<string, DebugLogRecord> = new Map();
  private ephemeralRequests: Set<string> = new Set();

  private constructor() {}

  static getInstance(): DebugManager {
    if (!DebugManager.instance) {
      DebugManager.instance = new DebugManager();
    }
    return DebugManager.instance;
  }

  setStorage(storage: UsageStorageService) {
    this.storage = storage;
  }

  // ─── Global toggle ──────────────────────────────────────────────
  setEnabled(enabled: boolean) {
    this.enabledGlobal = enabled;
    logger.warn(`Debug mode (global) ${enabled ? 'enabled' : 'disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabledGlobal;
  }

  // ─── Capture-on-error toggle ────────────────────────────────────
  // When enabled, traces are captured in memory for every request but only
  // persisted if the request writes an inference error or triggers a cooldown
  // (see markForcePersist). Successful requests are discarded on flush.
  setCaptureOnError(enabled: boolean) {
    this.captureOnError = enabled;
    logger.warn(`Debug capture-on-error ${enabled ? 'enabled' : 'disabled'}`);
  }

  isCaptureOnError(): boolean {
    return this.captureOnError;
  }

  // ─── Per-key toggle ─────────────────────────────────────────────
  enableForKey(keyName: string): void {
    this.enabledKeys.add(keyName);
    logger.warn(`Debug mode enabled for key '${keyName}'`);
  }

  disableForKey(keyName: string): void {
    this.enabledKeys.delete(keyName);
    logger.warn(`Debug mode disabled for key '${keyName}'`);
  }

  isEnabledForKey(keyName: string | null | undefined): boolean {
    if (this.enabledGlobal) return true;
    if (!keyName) return false;
    return this.enabledKeys.has(keyName);
  }

  /**
   * Whether ANY capture should happen for the current async context.
   * Reads the key name from the request context when one is available.
   */
  isCaptureEnabled(): boolean {
    // Capture-on-error mode buffers every request so a trace exists to persist
    // if the request later errors or triggers a cooldown.
    return this.captureOnError || this.isEnabledForKey(getCurrentKeyName() ?? null);
  }

  getEnabledKeys(): string[] {
    return Array.from(this.enabledKeys).sort();
  }

  // ─── Provider filter ────────────────────────────────────────────
  setProviderFilter(providers: string[] | null) {
    this.providerFilter = providers;
    logger.warn(
      `Debug provider filter ${providers ? 'set to: ' + providers.join(', ') : 'cleared'}`
    );
  }

  getProviderFilter(): string[] | null {
    return this.providerFilter;
  }

  shouldLogProvider(provider: string): boolean {
    if (!this.providerFilter || this.providerFilter.length === 0) {
      return true; // No filter set, log all providers
    }
    return this.providerFilter.includes(provider);
  }

  setProviderForRequest(requestId: string, provider: string) {
    const log = this.pendingLogs.get(requestId);
    if (log) {
      log.provider = provider;
    }
  }

  // ─── Log capture ────────────────────────────────────────────────
  startLog(requestId: string, rawRequest: any, requestHeaders?: Record<string, string | string[]>) {
    // Seed the request id into the async-local context so the cooldown path
    // (which lacks a requestId) can force-persist this request's trace.
    setCurrentRequestId(requestId);
    if (!this.isCaptureEnabled()) return;
    this.pendingLogs.set(requestId, {
      requestId,
      apiKey: getCurrentKeyName() ?? null,
      rawRequest,
      requestHeaders,
      createdAt: Date.now(),
    });

    // Auto-cleanup after 5 minutes to prevent memory leaks if streams hang or fail to flush
    setTimeout(
      () => {
        if (this.pendingLogs.has(requestId)) {
          logger.debug(`Auto-flushing stale debug log for ${requestId}`);
          this.flush(requestId);
        }
      },
      5 * 60 * 1000
    );
  }

  private ensureLog(requestId: string): DebugLogRecord {
    let log = this.pendingLogs.get(requestId);
    if (!log) {
      log = {
        requestId,
        apiKey: getCurrentKeyName() ?? null,
        createdAt: Date.now(),
      };
      this.pendingLogs.set(requestId, log);
    }
    return log;
  }

  addTransformedRequest(requestId: string, payload: any) {
    if (!this.isCaptureEnabled()) return;
    const log = this.ensureLog(requestId);
    log.transformedRequest = payload;
  }

  addRawResponse(requestId: string, payload: any) {
    if (!this.isCaptureEnabled()) return;
    const log = this.ensureLog(requestId);
    log.rawResponse = payload;
  }

  addReconstructedRawResponse(requestId: string, payload: any) {
    // ALWAYS save to memory for usage extraction/estimation, regardless of debug mode
    // The enabled flag only controls DB persistence via flush()
    const log = this.ensureLog(requestId);
    log.rawResponseSnapshot = payload;
  }

  addTransformedResponse(requestId: string, payload: any) {
    // Only save full response bodies if debug mode is enabled (for DB persistence)
    if (!this.isCaptureEnabled()) return;
    const log = this.ensureLog(requestId);
    log.transformedResponse = payload;
  }

  addTransformedResponseSnapshot(requestId: string, payload: any) {
    // ALWAYS save to memory for usage extraction/estimation
    const log = this.ensureLog(requestId);
    log.transformedResponseSnapshot = payload;
  }

  addResponseMeta(requestId: string, status: number, headers: Record<string, string>) {
    if (!this.isCaptureEnabled()) return;
    const log = this.ensureLog(requestId);
    log.responseStatus = status;
    log.responseHeaders = headers;
  }

  flush(requestId: string) {
    // Skip flushing ephemeral requests
    if (this.ephemeralRequests.has(requestId)) {
      logger.debug(`Skipping flush for ephemeral request ${requestId}`);
      this.pendingLogs.delete(requestId);
      return;
    }

    const log = this.pendingLogs.get(requestId);
    if (!log) return;

    // Persist if debug mode is enabled for this request's key, or if the
    // request was flagged for forced persistence (capture-on-error mode).
    if (!this.isEnabledForKey(log.apiKey ?? null) && !log.forcePersist) {
      logger.debug(
        `Skipping flush for ${requestId} - debug mode not enabled for key '${log.apiKey ?? '(none)'}'`
      );
      this.pendingLogs.delete(requestId);
      return;
    }

    if (!this.storage) return;

    // Check provider filter
    if (log.provider && !this.shouldLogProvider(log.provider)) {
      logger.debug(`Skipping flush for ${requestId} - provider '${log.provider}' not in filter`);
      this.pendingLogs.delete(requestId);
      return;
    }

    logger.debug(`Flushing debug log for ${requestId}`);
    if (typeof this.storage.saveDebugLog === 'function') {
      this.storage.saveDebugLog(log);
    }
    this.pendingLogs.delete(requestId);
  }

  /**
   * Flag a request's pending trace for persistence on flush even when debug
   * capture is not otherwise enabled for its key. Used by capture-on-error
   * mode when a request writes an inference error or triggers a cooldown.
   * No-op unless capture-on-error is enabled and a pending log exists.
   */
  markForcePersist(requestId: string | undefined | null): void {
    if (!this.captureOnError || !requestId) return;
    const log = this.pendingLogs.get(requestId);
    if (log) log.forcePersist = true;
  }

  /**
   * Mark a request as ephemeral (debug data won't be persisted)
   */
  markEphemeral(requestId: string): void {
    this.ephemeralRequests.add(requestId);
    logger.debug(`Marked ${requestId} as ephemeral`);
  }

  /**
   * Check if a request is ephemeral
   */
  isEphemeral(requestId: string): boolean {
    return this.ephemeralRequests.has(requestId);
  }

  /**
   * Get reconstructed raw response for token estimation
   */
  getReconstructedRawResponse(requestId: string): any | null {
    const log = this.pendingLogs.get(requestId);
    return log?.rawResponseSnapshot || null;
  }

  /**
   * Discard ephemeral debug data without saving to database
   */
  discardEphemeral(requestId: string): void {
    if (this.ephemeralRequests.has(requestId)) {
      this.pendingLogs.delete(requestId);
      this.ephemeralRequests.delete(requestId);
      logger.debug(`Discarded ephemeral data for ${requestId}`);
    }
  }

  resetForTesting(): void {
    this.pendingLogs.clear();
    this.ephemeralRequests.clear();
  }

  getPendingLog(requestId: string): DebugLogRecord | undefined {
    return this.pendingLogs.get(requestId);
  }
}
