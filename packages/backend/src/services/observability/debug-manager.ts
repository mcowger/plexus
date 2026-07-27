import { UsageStorageService } from './usage-storage';
import { logger } from '../../utils/logger';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { getCurrentKeyName, setCurrentRequestId } from './request-context';

export interface DebugLogRecord {
  requestId: string;
  apiKey?: string | null;
  modelAlias?: string | null;
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
  deferPayloadCapture?: boolean;
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
  private enabledAliases: Set<string> = new Set();
  private enabledProviders: Set<string> = new Set();
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

  isKeyDimensionEnabled(keyName: string | null | undefined): boolean {
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
    return (
      this.captureOnError ||
      this.enabledGlobal ||
      this.isKeyDimensionEnabled(getCurrentKeyName() ?? null) ||
      this.enabledAliases.size > 0 ||
      this.enabledProviders.size > 0
    );
  }

  getEnabledKeys(): string[] {
    return Array.from(this.enabledKeys).sort();
  }

  setEnabledKeys(keys: string[] | null | undefined): void {
    this.enabledKeys = new Set((keys ?? []).map((key) => key.trim()).filter(Boolean));
    logger.warn(
      `Debug key capture ${this.enabledKeys.size > 0 ? 'set to: ' + this.getEnabledKeys().join(', ') : 'cleared'}`
    );
  }

  // ─── Per-alias toggle ───────────────────────────────────────────
  enableForAlias(alias: string): void {
    this.enabledAliases.add(alias);
    logger.warn(`Debug mode enabled for alias '${alias}'`);
  }

  disableForAlias(alias: string): void {
    this.enabledAliases.delete(alias);
    logger.warn(`Debug mode disabled for alias '${alias}'`);
  }

  setEnabledAliases(aliases: string[] | null | undefined): void {
    this.enabledAliases = new Set((aliases ?? []).map((alias) => alias.trim()).filter(Boolean));
    logger.warn(
      `Debug alias capture ${this.enabledAliases.size > 0 ? 'set to: ' + this.getEnabledAliases().join(', ') : 'cleared'}`
    );
  }

  getEnabledAliases(): string[] {
    return Array.from(this.enabledAliases).sort();
  }

  isEnabledForAlias(alias: string | null | undefined): boolean {
    if (this.enabledGlobal) return true;
    return this.isAliasDimensionEnabled(alias);
  }

  isAliasDimensionEnabled(alias: string | null | undefined): boolean {
    if (!alias) return false;
    return this.enabledAliases.has(alias);
  }

  // ─── Provider filter ────────────────────────────────────────────
  setProviderFilter(providers: string[] | null) {
    this.setEnabledProviders(providers);
  }

  setEnabledProviders(providers: string[] | null | undefined) {
    this.enabledProviders = new Set(
      (providers ?? []).map((provider) => provider.trim()).filter(Boolean)
    );
    logger.warn(
      `Debug provider capture ${this.enabledProviders.size > 0 ? 'set to: ' + this.getProviderFilter()?.join(', ') : 'cleared'}`
    );
  }

  getProviderFilter(): string[] | null {
    const providers = Array.from(this.enabledProviders).sort();
    return providers.length > 0 ? providers : null;
  }

  shouldLogProvider(provider: string): boolean {
    if (this.enabledGlobal) return true;
    return this.isProviderDimensionEnabled(provider);
  }

  isProviderDimensionEnabled(provider: string | null | undefined): boolean {
    if (!provider) return false;
    return this.enabledProviders.has(provider);
  }

  setProviderForRequest(requestId: string, provider: string) {
    const log = this.pendingLogs.get(requestId);
    if (log) {
      log.provider = provider;
    }
  }

  setModelAliasForRequest(
    requestId: string,
    modelAlias: string | null | undefined,
    rawRequest?: any,
    requestHeaders?: Record<string, string | string[]>
  ) {
    const log = this.pendingLogs.get(requestId);
    if (log && modelAlias) {
      log.modelAlias = modelAlias;
      if (log.deferPayloadCapture && this.isAliasDimensionEnabled(modelAlias)) {
        log.deferPayloadCapture = false;
        log.rawRequest = rawRequest;
        log.requestHeaders = requestHeaders;
      }
    }
  }

  // ─── Log capture ────────────────────────────────────────────────
  startLog(requestId: string, rawRequest: any, requestHeaders?: Record<string, string | string[]>) {
    // Seed the request id into the async-local context so the cooldown path
    // (which lacks a requestId) can force-persist this request's trace.
    setCurrentRequestId(requestId);
    const modelAlias = this.getRequestModelAlias(rawRequest);
    const shouldCapturePayload = this.shouldCapturePayloadAtStart(modelAlias);
    const shouldDeferAliasCapture =
      !shouldCapturePayload && this.enabledAliases.size > 0 && this.enabledProviders.size === 0;

    if (!shouldCapturePayload && !shouldDeferAliasCapture) return;

    this.pendingLogs.set(requestId, {
      requestId,
      apiKey: getCurrentKeyName() ?? null,
      modelAlias,
      rawRequest: shouldCapturePayload ? rawRequest : undefined,
      requestHeaders: shouldCapturePayload ? requestHeaders : undefined,
      createdAt: Date.now(),
      deferPayloadCapture: shouldDeferAliasCapture,
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

  private getRequestModelAlias(rawRequest: any): string | null {
    return rawRequest && typeof rawRequest === 'object' && typeof rawRequest.model === 'string'
      ? rawRequest.model
      : null;
  }

  private shouldCapturePayloadAtStart(modelAlias: string | null): boolean {
    return (
      this.captureOnError ||
      this.enabledGlobal ||
      this.isKeyDimensionEnabled(getCurrentKeyName() ?? null) ||
      this.enabledProviders.size > 0 ||
      this.isAliasDimensionEnabled(modelAlias)
    );
  }

  private shouldCapturePayloadForRequest(requestId: string): boolean {
    const log = this.pendingLogs.get(requestId);
    return !log?.deferPayloadCapture;
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
    if (!this.shouldCapturePayloadForRequest(requestId)) return;
    const log = this.ensureLog(requestId);
    log.transformedRequest = payload;
  }

  addRawResponse(requestId: string, payload: any) {
    if (!this.isCaptureEnabled()) return;
    if (!this.shouldCapturePayloadForRequest(requestId)) return;
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
    if (!this.shouldCapturePayloadForRequest(requestId)) return;
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
    if (!this.shouldCapturePayloadForRequest(requestId)) return;
    const log = this.ensureLog(requestId);
    log.responseStatus = status;
    log.responseHeaders = headers;
  }

  /**
   * True when any debug dimension (global, key, alias, or provider) matches
   * this request, or when the request was flagged for forced persistence
   * (capture-on-error mode). Ephemeral traces captured for token estimation
   * are only kept when this returns true.
   */
  private shouldPersistLog(log: DebugLogRecord): boolean {
    return (
      this.enabledGlobal ||
      this.isKeyDimensionEnabled(log.apiKey ?? null) ||
      this.isAliasDimensionEnabled(log.modelAlias ?? null) ||
      this.isProviderDimensionEnabled(log.provider ?? null) ||
      !!log.forcePersist
    );
  }

  flush(requestId: string) {
    const log = this.pendingLogs.get(requestId);
    if (!log) return;

    // Skip flushing ephemeral requests, unless a debug dimension also wants
    // the trace — ephemeral capture exists for token estimation, but an
    // enabled dimension (or a forced persist) takes precedence.
    if (this.ephemeralRequests.has(requestId) && !this.shouldPersistLog(log)) {
      logger.debug(`Skipping flush for ephemeral request ${requestId}`);
      this.pendingLogs.delete(requestId);
      this.ephemeralRequests.delete(requestId);
      return;
    }

    // Persist when any debug dimension matches this request, or when the
    // request was flagged for forced persistence (capture-on-error mode).
    if (!this.shouldPersistLog(log)) {
      logger.debug(
        `Skipping flush for ${requestId} - debug mode not enabled for key '${log.apiKey ?? '(none)'}', alias '${log.modelAlias ?? '(none)'}', provider '${log.provider ?? '(none)'}'`
      );
      this.pendingLogs.delete(requestId);
      this.ephemeralRequests.delete(requestId);
      return;
    }

    if (!this.storage) return;

    logger.debug(`Flushing debug log for ${requestId}`);
    if (typeof this.storage.saveDebugLog === 'function') {
      this.storage.saveDebugLog(log);
    }
    this.pendingLogs.delete(requestId);
    this.ephemeralRequests.delete(requestId);
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
   * Mark a request as ephemeral (debug data won't be persisted unless a
   * debug dimension matches it — see shouldPersistLog)
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
   * Discard ephemeral debug data without saving to database.
   *
   * The trace is kept (and persisted on the next flush) when a debug
   * dimension matches the request — an enabled dimension takes precedence
   * over the ephemeral marker.
   */
  discardEphemeral(requestId: string): void {
    if (this.ephemeralRequests.has(requestId)) {
      const log = this.pendingLogs.get(requestId);
      if (log && this.shouldPersistLog(log)) {
        logger.debug(`Keeping ephemeral data for ${requestId} - debug mode wants it persisted`);
        return;
      }
      this.pendingLogs.delete(requestId);
      this.ephemeralRequests.delete(requestId);
      logger.debug(`Discarded ephemeral data for ${requestId}`);
    }
  }

  resetForTesting(): void {
    this.pendingLogs.clear();
    this.ephemeralRequests.clear();
    this.enabledKeys.clear();
    this.enabledAliases.clear();
    this.enabledProviders.clear();
    this.captureOnError = false;
  }

  getPendingLog(requestId: string): DebugLogRecord | undefined {
    return this.pendingLogs.get(requestId);
  }
}
