import { logger } from '../utils/logger';
import { UsageRecord } from '../types/usage';
import { getDatabase, getSchema } from '../db/client';
import { NewRequestUsage } from '../db/types';
import { EventEmitter } from 'node:events';
import { eq, and, gte, lte, like, desc, asc, sql, getTableName } from 'drizzle-orm';
import { DebugLogRecord } from './debug-manager';
import { getCurrentKeyName } from './request-context';
import { estimateKwhUsed, getGpuParams } from './inference-energy';
import { resolveModelParams, DEFAULT_GPU_PARAMS } from '@plexus/shared';
import type { ModelArchitecture, GpuParams } from '@plexus/shared';

// ModelArchitecture is now imported from @plexus/shared

export interface UsageFilters {
  startDate?: string;
  endDate?: string;
  apiKey?: string;
  /**
   * How to match the `apiKey` filter. Defaults to 'like' (substring match) for
   * back-compat. Limited-role users should always force 'exact' to scope
   * their view to their own key.
   */
  apiKeyMatch?: 'exact' | 'like';
  incomingApiType?: string;
  provider?: string;
  incomingModelAlias?: string;
  selectedModelName?: string;
  outgoingApiType?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  responseStatus?: string;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
  sortBy?: UsageSortField;
  sortDir?: UsageSortDirection;
}

export type UsageSortField =
  | 'date'
  | 'apiKey'
  | 'provider'
  | 'incomingModelAlias'
  | 'costTotal'
  | 'durationMs';

export type UsageSortDirection = 'asc' | 'desc';

export class UsageStorageService extends EventEmitter {
  private db: ReturnType<typeof getDatabase> | null = null;
  private schema: any = null;
  private readonly defaultPerformanceRetentionLimit = 100;
  private telemetryQueue: Promise<void> = Promise.resolve();

  constructor(connectionString?: string) {
    super();
  }

  private ensureDb() {
    if (!this.db) {
      this.db = getDatabase();
      this.schema = getSchema();
    }
    return this.db;
  }

  getDb() {
    return this.ensureDb();
  }

  private getPerformanceRetentionLimit(): number {
    const envValue = process.env.PLEXUS_PROVIDER_PERFORMANCE_RETENTION_LIMIT;
    const parsed = envValue ? parseInt(envValue, 10) : this.defaultPerformanceRetentionLimit;

    if (Number.isNaN(parsed) || parsed < 1) {
      return this.defaultPerformanceRetentionLimit;
    }

    return parsed;
  }

  async saveRequest(record: NewRequestUsage | UsageRecord) {
    try {
      const isStreamedValue =
        typeof record.isStreamed === 'boolean' ? (record.isStreamed ? 1 : 0) : record.isStreamed;
      const isPassthroughValue =
        typeof record.isPassthrough === 'boolean'
          ? record.isPassthrough
            ? 1
            : 0
          : record.isPassthrough;
      const parallelToolCallsValue =
        typeof record.parallelToolCallsEnabled === 'boolean'
          ? record.parallelToolCallsEnabled
            ? 1
            : 0
          : record.parallelToolCallsEnabled;

      const isVisionFallthroughValue =
        typeof record.isVisionFallthrough === 'boolean'
          ? record.isVisionFallthrough
            ? 1
            : 0
          : record.isVisionFallthrough;
      const isDescriptorRequestValue =
        typeof record.isDescriptorRequest === 'boolean'
          ? record.isDescriptorRequest
            ? 1
            : 0
          : record.isDescriptorRequest;

      // Prepare values for insert/update
      const values = {
        ...record,
        isStreamed: isStreamedValue,
        isPassthrough: isPassthroughValue,
        parallelToolCallsEnabled: parallelToolCallsValue,
        isVisionFallthrough: isVisionFallthroughValue,
        isDescriptorRequest: isDescriptorRequestValue,
        createdAt: record.createdAt || Date.now(),
      };

      // Use upsert: insert new record or update existing one based on requestId
      await this.ensureDb().insert(this.schema.requestUsage).values(values).onConflictDoUpdate({
        target: this.schema.requestUsage.requestId,
        set: values,
      });

      logger.debug(`Usage record saved for request ${record.requestId}`);
      // Emit both 'created' and 'completed' for backward compatibility
      this.emit('created', record);
      this.emit('completed', record);
    } catch (error) {
      logger.error('Failed to save usage record', error);
    }
  }

  emitStartedAsync(record: Partial<UsageRecord>): void {
    this.enqueueTelemetryTask(() => this.emitStarted(record));
  }

  emitUpdatedAsync(record: Partial<UsageRecord>): void {
    this.enqueueTelemetryTask(() => this.emitUpdated(record));
  }

  private enqueueTelemetryTask(task: () => Promise<void>): void {
    this.telemetryQueue = this.telemetryQueue
      .then(async () => {
        await task();
      })
      .catch((error) => {
        logger.error('Telemetry queue task failed', error);
      });
  }

  /**
   * Emit a 'started' event when a request arrives and insert a pending record to DB.
   * This allows the frontend to show in-flight requests immediately.
   * The record is inserted with durationMs=null to indicate it's still in-flight.
   */
  async emitStarted(record: Partial<UsageRecord>): Promise<void> {
    try {
      // Insert pending record with durationMs=null to indicate in-flight status
      await this.ensureDb()
        .insert(this.schema.requestUsage)
        .values({
          requestId: record.requestId!,
          date: record.date || new Date().toISOString(),
          sourceIp: record.sourceIp || null,
          apiKey: record.apiKey || null,
          attribution: record.attribution || null,
          incomingApiType: record.incomingApiType || null,
          provider: record.provider || null,
          incomingModelAlias: record.incomingModelAlias || null,
          canonicalModelName: record.canonicalModelName || null,
          selectedModelName: record.selectedModelName || null,
          outgoingApiType: record.outgoingApiType || null,
          startTime: record.startTime || Date.now(),
          durationMs: null, // null indicates pending/in-flight
          responseStatus: 'pending',
          isStreamed: record.isStreamed ? 1 : 0,
          isPassthrough: record.isPassthrough ? 1 : 0,
          createdAt: Date.now(),
        });
    } catch (error) {
      logger.error('Failed to insert pending usage record', error);
    }

    const eventData = {
      ...record,
      responseStatus: 'pending',
    };
    this.emit('started', eventData);
  }

  /**
   * Emit an 'updated' event with partial data as more information becomes available.
   * Also updates the pending DB record with provider/model info so the concurrency
   * endpoint can group in-flight requests by provider.
   */
  async emitUpdated(record: Partial<UsageRecord>): Promise<void> {
    // Update the pending record in DB if we have provider/model info
    if (record.requestId && (record.provider || record.canonicalModelName)) {
      try {
        const updateSet: Record<string, unknown> = {};
        if (record.provider) updateSet.provider = record.provider;
        if (record.canonicalModelName) updateSet.canonicalModelName = record.canonicalModelName;
        if (record.selectedModelName) updateSet.selectedModelName = record.selectedModelName;
        if (record.incomingModelAlias) updateSet.incomingModelAlias = record.incomingModelAlias;
        if (record.apiKey) updateSet.apiKey = record.apiKey;
        if (record.attribution !== undefined) updateSet.attribution = record.attribution;

        await this.ensureDb()
          .update(this.schema.requestUsage)
          .set(updateSet)
          .where(eq(this.schema.requestUsage.requestId, record.requestId));
      } catch (error) {
        logger.error('Failed to update pending usage record', error);
      }
    }
    this.emit('updated', record);
  }

  async saveDebugLog(record: DebugLogRecord) {
    try {
      await this.ensureDb()
        .insert(this.schema.debugLogs)
        .values({
          requestId: record.requestId,
          apiKey: record.apiKey ?? null,
          rawRequest: record.rawRequest
            ? typeof record.rawRequest === 'string'
              ? record.rawRequest
              : JSON.stringify(record.rawRequest)
            : null,
          transformedRequest: record.transformedRequest
            ? typeof record.transformedRequest === 'string'
              ? record.transformedRequest
              : JSON.stringify(record.transformedRequest)
            : null,
          rawResponse: record.rawResponse
            ? typeof record.rawResponse === 'string'
              ? record.rawResponse
              : JSON.stringify(record.rawResponse)
            : null,
          transformedResponse: record.transformedResponse
            ? typeof record.transformedResponse === 'string'
              ? record.transformedResponse
              : JSON.stringify(record.transformedResponse)
            : null,
          rawResponseSnapshot: record.rawResponseSnapshot
            ? JSON.stringify(record.rawResponseSnapshot)
            : null,
          transformedResponseSnapshot: record.transformedResponseSnapshot
            ? JSON.stringify(record.transformedResponseSnapshot)
            : null,
          createdAt: record.createdAt || Date.now(),
        });

      logger.debug(`Debug log saved for request ${record.requestId}`);
    } catch (error) {
      logger.error('Failed to save debug log', error);
    }
  }

  async saveError(requestId: string, error: any, details?: any, apiKey?: string | null) {
    try {
      // Resolve the owning key name in preference order:
      //   1. Explicit caller-supplied apiKey (most accurate).
      //   2. AsyncLocalStorage request context (keyName seeded by v1 auth
      //      middleware) — this catches error paths we haven't threaded
      //      apiKey through manually, without any DB round-trip.
      //   3. DB lookup on request_usage by requestId — last-resort fallback,
      //      which can miss attribution if the request_usage row hasn't been
      //      written yet (it's inserted via emitStartedAsync, which runs
      //      concurrently with the error path).
      let effectiveApiKey = apiKey ?? null;
      if (!effectiveApiKey) {
        const ctxKeyName = getCurrentKeyName();
        if (ctxKeyName) effectiveApiKey = ctxKeyName;
      }
      if (!effectiveApiKey) {
        try {
          const rows = await this.ensureDb()
            .select({ apiKey: this.schema.requestUsage.apiKey })
            .from(this.schema.requestUsage)
            .where(eq(this.schema.requestUsage.requestId, requestId))
            .limit(1);
          if (rows[0]?.apiKey) effectiveApiKey = rows[0].apiKey;
        } catch {
          // Best-effort; null apiKey is acceptable fallback.
        }
      }

      await this.ensureDb()
        .insert(this.schema.inferenceErrors)
        .values({
          requestId,
          date: new Date().toISOString(),
          apiKey: effectiveApiKey,
          errorMessage: error.message || String(error),
          errorStack: error.stack || null,
          details: details
            ? typeof details === 'string'
              ? details
              : JSON.stringify(details)
            : null,
          createdAt: Date.now(),
        });

      logger.debug(`Inference error saved for request ${requestId}`);
    } catch (e) {
      logger.error('Failed to save inference error', e);
    }
  }

  async getErrors(limit: number = 50, offset: number = 0, apiKey?: string): Promise<any[]> {
    try {
      const db = this.ensureDb();
      const where = apiKey ? eq(this.schema.inferenceErrors.apiKey, apiKey) : undefined;
      const query = db
        .select()
        .from(this.schema.inferenceErrors)
        .orderBy(desc(this.schema.inferenceErrors.createdAt))
        .limit(limit)
        .offset(offset);
      const results = where ? await query.where(where) : await query;
      return results;
    } catch (error) {
      logger.error('Failed to get inference errors', error);
      return [];
    }
  }

  async getErrorOwner(requestId: string): Promise<string | null> {
    try {
      const rows = await this.ensureDb()
        .select({ apiKey: this.schema.inferenceErrors.apiKey })
        .from(this.schema.inferenceErrors)
        .where(eq(this.schema.inferenceErrors.requestId, requestId))
        .limit(1);
      return rows[0]?.apiKey ?? null;
    } catch (error) {
      logger.error(`Failed to look up error owner for ${requestId}`, error);
      return null;
    }
  }

  async getDebugLogOwner(requestId: string): Promise<string | null> {
    try {
      const rows = await this.ensureDb()
        .select({ apiKey: this.schema.debugLogs.apiKey })
        .from(this.schema.debugLogs)
        .where(eq(this.schema.debugLogs.requestId, requestId))
        .limit(1);
      return rows[0]?.apiKey ?? null;
    } catch (error) {
      logger.error(`Failed to look up debug log owner for ${requestId}`, error);
      return null;
    }
  }

  async deleteError(requestId: string): Promise<boolean> {
    try {
      await this.ensureDb()
        .delete(this.schema.inferenceErrors)
        .where(eq(this.schema.inferenceErrors.requestId, requestId));
      return true;
    } catch (error) {
      logger.error(`Failed to delete error log for ${requestId}`, error);
      return false;
    }
  }

  async deleteAllErrors(): Promise<boolean> {
    try {
      await this.ensureDb().delete(this.schema.inferenceErrors);
      logger.info('Deleted all error logs');
      return true;
    } catch (error) {
      logger.error('Failed to delete all error logs', error);
      return false;
    }
  }

  async getDebugLogs(
    limit: number = 50,
    offset: number = 0,
    apiKey?: string
  ): Promise<{ requestId: string; createdAt: number }[]> {
    try {
      const db = this.ensureDb();
      const where = apiKey ? eq(this.schema.debugLogs.apiKey, apiKey) : undefined;
      const query = db
        .select({
          requestId: this.schema.debugLogs.requestId,
          createdAt: this.schema.debugLogs.createdAt,
        })
        .from(this.schema.debugLogs)
        .orderBy(desc(this.schema.debugLogs.createdAt))
        .limit(limit)
        .offset(offset);
      const results = where ? await query.where(where) : await query;

      return results.map((row) => ({
        requestId: row.requestId,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      logger.error('Failed to get debug logs', error);
      return [];
    }
  }

  async getDebugLog(requestId: string): Promise<DebugLogRecord | null> {
    try {
      const results = await this.ensureDb()
        .select()
        .from(this.schema.debugLogs)
        .where(eq(this.schema.debugLogs.requestId, requestId));

      if (!results || results.length === 0) return null;

      const row = results[0];
      if (!row) return null;

      return {
        requestId: row.requestId,
        createdAt: row.createdAt,
        rawRequest: row.rawRequest,
        transformedRequest: row.transformedRequest,
        rawResponse: row.rawResponse,
        transformedResponse: row.transformedResponse,
        rawResponseSnapshot: row.rawResponseSnapshot,
        transformedResponseSnapshot: row.transformedResponseSnapshot,
      };
    } catch (error) {
      logger.error(`Failed to get debug log for ${requestId}`, error);
      return null;
    }
  }

  async deleteDebugLog(requestId: string): Promise<boolean> {
    try {
      await this.ensureDb()
        .delete(this.schema.debugLogs)
        .where(eq(this.schema.debugLogs.requestId, requestId));
      return true;
    } catch (error) {
      logger.error(`Failed to delete debug log for ${requestId}`, error);
      return false;
    }
  }

  async deleteAllDebugLogs(): Promise<boolean> {
    try {
      await this.ensureDb().delete(this.schema.debugLogs);
      logger.info('Deleted all debug logs');
      return true;
    } catch (error) {
      logger.error('Failed to delete all debug logs', error);
      return false;
    }
  }

  async getUsage(
    filters: UsageFilters,
    pagination: PaginationOptions
  ): Promise<{ data: UsageRecord[]; total: number }> {
    const db = this.ensureDb();
    const schema = this.schema!;
    const conditions = [];

    if (filters.startDate) {
      conditions.push(gte(schema.requestUsage.date, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(schema.requestUsage.date, filters.endDate));
    }
    if (filters.incomingApiType) {
      conditions.push(eq(schema.requestUsage.incomingApiType, filters.incomingApiType));
    }
    if (filters.apiKey) {
      if (filters.apiKeyMatch === 'exact') {
        conditions.push(eq(schema.requestUsage.apiKey, filters.apiKey));
      } else {
        conditions.push(like(schema.requestUsage.apiKey, `%${filters.apiKey}%`));
      }
    }
    if (filters.provider) {
      conditions.push(like(schema.requestUsage.provider, `%${filters.provider}%`));
    }
    if (filters.incomingModelAlias) {
      conditions.push(
        like(schema.requestUsage.incomingModelAlias, `%${filters.incomingModelAlias}%`)
      );
    }
    if (filters.selectedModelName) {
      conditions.push(
        like(schema.requestUsage.selectedModelName, `%${filters.selectedModelName}%`)
      );
    }
    if (filters.outgoingApiType) {
      conditions.push(eq(schema.requestUsage.outgoingApiType, filters.outgoingApiType));
    }
    if (filters.minDurationMs !== undefined) {
      conditions.push(gte(schema.requestUsage.durationMs, filters.minDurationMs));
    }
    if (filters.maxDurationMs !== undefined) {
      conditions.push(lte(schema.requestUsage.durationMs, filters.maxDurationMs));
    }
    if (filters.responseStatus) {
      conditions.push(eq(schema.requestUsage.responseStatus, filters.responseStatus));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sortFieldMap = {
      date: schema.requestUsage.date,
      apiKey: schema.requestUsage.apiKey,
      provider: schema.requestUsage.provider,
      incomingModelAlias: schema.requestUsage.incomingModelAlias,
      costTotal: schema.requestUsage.costTotal,
      durationMs: schema.requestUsage.durationMs,
    } satisfies Record<UsageSortField, any>;
    const sortBy =
      pagination.sortBy && sortFieldMap[pagination.sortBy] ? pagination.sortBy : 'date';
    const sortColumn = sortFieldMap[sortBy];
    const sortDir = pagination.sortDir === 'asc' ? 'asc' : 'desc';

    try {
      const data = await db
        .select({
          requestId: schema.requestUsage.requestId,
          date: schema.requestUsage.date,
          sourceIp: schema.requestUsage.sourceIp,
          apiKey: schema.requestUsage.apiKey,
          attribution: schema.requestUsage.attribution,
          incomingApiType: schema.requestUsage.incomingApiType,
          provider: schema.requestUsage.provider,
          attemptCount: schema.requestUsage.attemptCount,
          retryHistory: schema.requestUsage.retryHistory,
          incomingModelAlias: schema.requestUsage.incomingModelAlias,
          canonicalModelName: schema.requestUsage.canonicalModelName,
          selectedModelName: schema.requestUsage.selectedModelName,
          finalAttemptProvider: schema.requestUsage.finalAttemptProvider,
          finalAttemptModel: schema.requestUsage.finalAttemptModel,
          allAttemptedProviders: schema.requestUsage.allAttemptedProviders,
          outgoingApiType: schema.requestUsage.outgoingApiType,
          tokensInput: schema.requestUsage.tokensInput,
          tokensOutput: schema.requestUsage.tokensOutput,
          tokensReasoning: schema.requestUsage.tokensReasoning,
          tokensCached: schema.requestUsage.tokensCached,
          tokensCacheWrite: schema.requestUsage.tokensCacheWrite,
          tokensEstimated: schema.requestUsage.tokensEstimated,
          costInput: schema.requestUsage.costInput,
          costOutput: schema.requestUsage.costOutput,
          costCached: schema.requestUsage.costCached,
          costCacheWrite: schema.requestUsage.costCacheWrite,
          costTotal: schema.requestUsage.costTotal,
          costSource: schema.requestUsage.costSource,
          costMetadata: schema.requestUsage.costMetadata,
          startTime: schema.requestUsage.startTime,
          durationMs: schema.requestUsage.durationMs,
          ttftMs: schema.requestUsage.ttftMs,
          tokensPerSec: schema.requestUsage.tokensPerSec,
          isStreamed: schema.requestUsage.isStreamed,
          isPassthrough: schema.requestUsage.isPassthrough,
          responseStatus: schema.requestUsage.responseStatus,
          toolsDefined: schema.requestUsage.toolsDefined,
          messageCount: schema.requestUsage.messageCount,
          parallelToolCallsEnabled: schema.requestUsage.parallelToolCallsEnabled,
          toolCallsCount: schema.requestUsage.toolCallsCount,
          finishReason: schema.requestUsage.finishReason,
          kwhUsed: schema.requestUsage.kwhUsed,
          hasDebug: sql<boolean>`EXISTS(SELECT 1 FROM ${schema.debugLogs} dl WHERE dl.request_id = request_usage.request_id)`,
          hasError: sql<boolean>`EXISTS(SELECT 1 FROM ${schema.inferenceErrors} ie WHERE ie.request_id = request_usage.request_id)`,
        })
        .from(schema.requestUsage)
        .where(whereClause)
        .orderBy(
          sortDir === 'asc' ? asc(sortColumn) : desc(sortColumn),
          desc(schema.requestUsage.date)
        )
        .limit(pagination.limit)
        .offset(pagination.offset);

      const mappedData: UsageRecord[] = data.map((row) => ({
        requestId: row.requestId,
        date: row.date,
        sourceIp: row.sourceIp,
        apiKey: row.apiKey,
        attribution: row.attribution,
        incomingApiType: row.incomingApiType ?? '',
        provider: row.provider,
        attemptCount: row.attemptCount ?? 1,
        retryHistory: row.retryHistory,
        incomingModelAlias: row.incomingModelAlias,
        canonicalModelName: row.canonicalModelName,
        selectedModelName: row.selectedModelName,
        finalAttemptProvider: row.finalAttemptProvider,
        finalAttemptModel: row.finalAttemptModel,
        allAttemptedProviders: row.allAttemptedProviders,
        outgoingApiType: row.outgoingApiType,
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        tokensReasoning: row.tokensReasoning,
        tokensCached: row.tokensCached,
        tokensCacheWrite: row.tokensCacheWrite,
        tokensEstimated: row.tokensEstimated,
        costInput: row.costInput,
        costOutput: row.costOutput,
        costCached: row.costCached,
        costCacheWrite: row.costCacheWrite,
        costTotal: row.costTotal,
        costSource: row.costSource,
        costMetadata: row.costMetadata,
        startTime: row.startTime,
        durationMs: row.durationMs ?? 0,
        isStreamed: !!row.isStreamed,
        responseStatus: row.responseStatus ?? '',
        ttftMs: row.ttftMs,
        tokensPerSec: row.tokensPerSec,
        hasDebug: !!row.hasDebug,
        hasError: !!row.hasError,
        isPassthrough: !!row.isPassthrough,
        toolsDefined: row.toolsDefined,
        messageCount: row.messageCount,
        parallelToolCallsEnabled: !!row.parallelToolCallsEnabled,
        toolCallsCount: row.toolCallsCount,
        finishReason: row.finishReason,
        kwhUsed: row.kwhUsed,
      }));

      const countResults = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.requestUsage)
        .where(whereClause);

      const total = countResults[0]?.count ?? 0;

      return {
        data: mappedData,
        total,
      };
    } catch (error) {
      logger.error('Failed to query usage', error);
      throw error;
    }
  }

  async deleteUsageLog(requestId: string): Promise<boolean> {
    try {
      await this.ensureDb()
        .delete(this.schema.requestUsage)
        .where(eq(this.schema.requestUsage.requestId, requestId));
      return true;
    } catch (error) {
      logger.error(`Failed to delete usage log for ${requestId}`, error);
      return false;
    }
  }

  async deleteAllUsageLogs(beforeDate?: Date): Promise<boolean> {
    try {
      if (beforeDate) {
        await this.ensureDb()
          .delete(this.schema.requestUsage)
          .where(lte(this.schema.requestUsage.date, beforeDate.toISOString()));
        logger.info(`Deleted usage logs older than ${beforeDate.toISOString()}`);
      } else {
        await this.ensureDb().delete(this.schema.requestUsage);
        logger.info('Deleted all usage logs');
      }
      return true;
    } catch (error) {
      logger.error('Failed to delete usage logs', error);
      return false;
    }
  }

  async deletePerformanceByModel(model: string): Promise<boolean> {
    try {
      this.ensureDb();

      await this.db!.delete(this.schema.providerPerformance).where(
        sql`COALESCE(${this.schema.providerPerformance.canonicalModelName}, ${this.schema.providerPerformance.model}) = ${model}`
      );

      logger.info(`Deleted performance data for model: ${model}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete performance data for model ${model}`, error);
      return false;
    }
  }

  async updatePerformanceMetrics(
    provider: string,
    model: string,
    canonicalModelName: string | null,
    timeToFirstTokenMs: number | null,
    outputTokens: number | null,
    durationMs: number,
    requestId: string,
    success: boolean = true
  ) {
    try {
      const retentionLimit = this.getPerformanceRetentionLimit();

      let tokensPerSec: number | null = null;
      if (success && outputTokens && durationMs > 0) {
        const streamingTimeMs = timeToFirstTokenMs ? durationMs - timeToFirstTokenMs : durationMs;
        tokensPerSec = streamingTimeMs > 0 ? (outputTokens / streamingTimeMs) * 1000 : null;
      }

      await this.ensureDb()
        .insert(this.schema.providerPerformance)
        .values({
          provider,
          model,
          canonicalModelName,
          requestId,
          timeToFirstTokenMs: success ? timeToFirstTokenMs : null,
          totalTokens: success ? outputTokens : null,
          durationMs: success ? durationMs : null,
          tokensPerSec,
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1,
          createdAt: Date.now(),
        });

      const subquery = this.ensureDb()
        .select({ id: this.schema.providerPerformance.id })
        .from(this.schema.providerPerformance)
        .where(
          and(
            sql`${this.schema.providerPerformance.provider} = ${provider}`,
            sql`${this.schema.providerPerformance.model} = ${model}`
          )
        )
        .orderBy(desc(this.schema.providerPerformance.createdAt))
        .limit(retentionLimit)
        .as('sub');

      await this.ensureDb()
        .delete(this.schema.providerPerformance)
        .where(
          and(
            eq(this.schema.providerPerformance.provider, provider),
            eq(this.schema.providerPerformance.model, model),
            sql`${this.schema.providerPerformance.id} NOT IN (SELECT id FROM ${subquery})`
          )
        );

      logger.debug(`Performance metrics updated for ${provider}:${model}`);
    } catch (error) {
      logger.error(`Failed to update performance metrics for ${provider}:${model}`, error);
    }
  }

  async recordSuccessfulAttempt(
    provider: string,
    model: string,
    canonicalModelName: string | null,
    requestId: string,
    metadata?: {
      isVisionFallthrough?: boolean;
      isDescriptorRequest?: boolean;
      visionFallthroughModel?: string;
    }
  ) {
    if (metadata) {
      try {
        await this.ensureDb()
          .update(this.schema.requestUsage)
          .set({
            isVisionFallthrough: metadata.isVisionFallthrough ? 1 : 0,
            isDescriptorRequest: metadata.isDescriptorRequest ? 1 : 0,
            visionFallthroughModel: metadata.visionFallthroughModel ?? null,
          })
          .where(eq(this.schema.requestUsage.requestId, requestId));
      } catch (error) {
        logger.error('Failed to update vision fallthrough metadata', error);
      }
    }

    await this.updatePerformanceMetrics(
      provider,
      model,
      canonicalModelName,
      null,
      null,
      0,
      requestId,
      true
    );
  }

  async recordFailedAttempt(
    provider: string,
    model: string,
    canonicalModelName: string | null,
    requestId: string,
    metadata?: {
      isVisionFallthrough?: boolean;
      isDescriptorRequest?: boolean;
      visionFallthroughModel?: string;
    }
  ) {
    if (metadata) {
      try {
        await this.ensureDb()
          .update(this.schema.requestUsage)
          .set({
            isVisionFallthrough: metadata.isVisionFallthrough ? 1 : 0,
            isDescriptorRequest: metadata.isDescriptorRequest ? 1 : 0,
            visionFallthroughModel: metadata.visionFallthroughModel ?? null,
          })
          .where(eq(this.schema.requestUsage.requestId, requestId));
      } catch (error) {
        logger.error('Failed to update vision fallthrough metadata for failed attempt', error);
      }
    }

    await this.updatePerformanceMetrics(
      provider,
      model,
      canonicalModelName,
      null,
      null,
      0,
      requestId,
      false
    );
  }

  async getProviderPerformance(provider?: string, model?: string): Promise<any[]> {
    this.ensureDb();

    try {
      const conditions = [];

      if (provider) {
        conditions.push(eq(this.schema.providerPerformance.provider, provider));
      }
      if (model) {
        conditions.push(
          sql`COALESCE(${this.schema.providerPerformance.canonicalModelName}, ${this.schema.requestUsage.canonicalModelName}, ${this.schema.providerPerformance.model}) = ${model}`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const perfRows = await this.db!.select({
        provider: this.schema.providerPerformance.provider,
        model: sql<string>`COALESCE(${this.schema.providerPerformance.canonicalModelName}, ${this.schema.requestUsage.canonicalModelName}, ${this.schema.providerPerformance.model})`,
        targetModel: this.schema.providerPerformance.model,
        avgTtftMs: sql<number>`AVG(${this.schema.providerPerformance.timeToFirstTokenMs})`,
        minTtftMs: sql<number>`MIN(${this.schema.providerPerformance.timeToFirstTokenMs})`,
        maxTtftMs: sql<number>`MAX(${this.schema.providerPerformance.timeToFirstTokenMs})`,
        avgTokensPerSec: sql<number>`AVG(${this.schema.providerPerformance.tokensPerSec})`,
        minTokensPerSec: sql<number>`MIN(${this.schema.providerPerformance.tokensPerSec})`,
        maxTokensPerSec: sql<number>`MAX(${this.schema.providerPerformance.tokensPerSec})`,
        sampleCount: sql<number>`COUNT(*)`,
        successCount: sql<number>`SUM(${this.schema.providerPerformance.successCount})`,
        failureCount: sql<number>`SUM(${this.schema.providerPerformance.failureCount})`,
        lastUpdated: sql<number>`MAX(${this.schema.providerPerformance.createdAt})`,
      })
        .from(this.schema.providerPerformance)
        .leftJoin(
          this.schema.requestUsage,
          eq(this.schema.providerPerformance.requestId, this.schema.requestUsage.requestId)
        )
        .where(whereClause)
        .groupBy(
          this.schema.providerPerformance.provider,
          this.schema.providerPerformance.model,
          this.schema.providerPerformance.canonicalModelName,
          this.schema.requestUsage.canonicalModelName
        )
        .orderBy(desc(sql`AVG(${this.schema.providerPerformance.tokensPerSec})`));

      const mappedRows = perfRows.map((row) => ({
        provider: row.provider,
        model: row.model,
        target_model: row.targetModel,
        avg_ttft_ms: row.avgTtftMs ?? 0,
        min_ttft_ms: row.minTtftMs ?? 0,
        max_ttft_ms: row.maxTtftMs ?? 0,
        avg_tokens_per_sec: row.avgTokensPerSec ?? 0,
        min_tokens_per_sec: row.minTokensPerSec ?? 0,
        max_tokens_per_sec: row.maxTokensPerSec ?? 0,
        sample_count: row.sampleCount ?? 0,
        success_count: row.successCount ?? 0,
        failure_count: row.failureCount ?? 0,
        last_updated: row.lastUpdated ?? 0,
      }));

      // When filtering by canonical model, include providers seen in request usage
      // even if no provider_performance row exists yet for that provider/model.
      if (model) {
        const usageConditions = [eq(this.schema.requestUsage.canonicalModelName, model)];
        if (provider) {
          usageConditions.push(eq(this.schema.requestUsage.provider, provider));
        }

        const usageProviders = await this.db!.select({
          provider: this.schema.requestUsage.provider,
        })
          .from(this.schema.requestUsage)
          .where(and(...usageConditions))
          .groupBy(this.schema.requestUsage.provider);

        const existingProviders = new Set(mappedRows.map((row) => row.provider));
        for (const usageProvider of usageProviders) {
          if (!existingProviders.has(usageProvider.provider)) {
            mappedRows.push({
              provider: usageProvider.provider,
              model,
              target_model: model,
              avg_ttft_ms: 0,
              min_ttft_ms: 0,
              max_ttft_ms: 0,
              avg_tokens_per_sec: 0,
              min_tokens_per_sec: 0,
              max_tokens_per_sec: 0,
              sample_count: 0,
              success_count: 0,
              failure_count: 0,
              last_updated: 0,
            });
          }
        }
      }

      return mappedRows;
    } catch (error) {
      logger.error('Failed to get provider performance', { provider, model, error });
      return [];
    }
  }

  /**
   * Recalculate energy usage for all requests associated with an alias.
   * This is called when an alias's model_architecture is updated.
   *
   * @param aliasSlug - The alias slug to recalculate energy for
   * @param modelArchitecture - The new model architecture parameters
   * @param providerGpuParams - Optional map of provider -> resolved GpuParams
   * @returns The number of records updated
   */
  async recalculateEnergyForAlias(
    aliasSlug: string,
    modelArchitecture: ModelArchitecture,
    providerGpuParams?: Record<string, GpuParams>
  ): Promise<number> {
    try {
      const db = this.ensureDb();
      const BATCH_SIZE = 500;
      let totalUpdated = 0;
      let offset = 0;

      logger.info(`Recalculating energy for alias ${aliasSlug} (batched)`);

      // Process in batches using limit+offset to avoid loading all rows into memory
      while (true) {
        const batch = await db
          .select({
            requestId: this.schema.requestUsage.requestId,
            tokensInput: this.schema.requestUsage.tokensInput,
            tokensOutput: this.schema.requestUsage.tokensOutput,
            provider: this.schema.requestUsage.finalAttemptProvider,
          })
          .from(this.schema.requestUsage)
          .where(eq(this.schema.requestUsage.incomingModelAlias, aliasSlug))
          .limit(BATCH_SIZE)
          .offset(offset);

        if (batch.length === 0) break;

        // Process this batch
        await Promise.all(
          batch.map(async (request) => {
            const tokensInput = request.tokensInput || 0;
            const tokensOutput = request.tokensOutput || 0;

            if (tokensInput === 0 && tokensOutput === 0) {
              return; // Skip requests with no tokens
            }

            // Get GPU params for this provider (use default H100 if not specified)
            const gpuParams = providerGpuParams?.[request.provider || ''] ?? DEFAULT_GPU_PARAMS;

            // Build model params from architecture using shared resolver
            const modelParams = resolveModelParams(modelArchitecture);

            // Calculate new energy
            const kwhUsed = estimateKwhUsed(tokensInput, tokensOutput, modelParams, gpuParams);

            // Update the record
            await db
              .update(this.schema.requestUsage)
              .set({ kwhUsed })
              .where(eq(this.schema.requestUsage.requestId, request.requestId));

            totalUpdated++;
          })
        );

        offset += BATCH_SIZE;

        // If we got fewer than BATCH_SIZE rows, we've reached the end
        if (batch.length < BATCH_SIZE) break;
      }

      if (totalUpdated === 0) {
        logger.debug(`No requests found for alias ${aliasSlug}`);
      } else {
        logger.info(`Recalculated energy for ${totalUpdated} requests for alias ${aliasSlug}`);
      }
      return totalUpdated;
    } catch (error) {
      logger.error(`Failed to recalculate energy for alias ${aliasSlug}`, error);
      throw error;
    }
  }
}
