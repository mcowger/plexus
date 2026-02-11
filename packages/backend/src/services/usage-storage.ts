import { logger } from '../utils/logger';
import { UsageRecord } from '../types/usage';
import { getDatabase, getSchema } from '../db/client';
import { NewRequestUsage } from '../db/types';
import { EventEmitter } from 'node:events';
import { eq, and, gte, lte, like, desc, sql, getTableName } from 'drizzle-orm';
import { DebugLogRecord } from './debug-manager';


export interface UsageFilters {
    startDate?: string;
    endDate?: string;
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
}

export class UsageStorageService extends EventEmitter {
    private db: ReturnType<typeof getDatabase> | null = null;
    private schema: any = null;
    private readonly defaultPerformanceRetentionLimit = 100;

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
            const isStreamedValue = typeof record.isStreamed === 'boolean' ? (record.isStreamed ? 1 : 0) : record.isStreamed;
            const isPassthroughValue = typeof record.isPassthrough === 'boolean' ? (record.isPassthrough ? 1 : 0) : record.isPassthrough;
            const parallelToolCallsValue = typeof record.parallelToolCallsEnabled === 'boolean' ? (record.parallelToolCallsEnabled ? 1 : 0) : record.parallelToolCallsEnabled;

            await this.ensureDb().insert(this.schema.requestUsage).values({
                ...record,
                isStreamed: isStreamedValue,
                isPassthrough: isPassthroughValue,
                parallelToolCallsEnabled: parallelToolCallsValue,
                createdAt: record.createdAt || Date.now(),
            });

            logger.debug(`Usage record saved for request ${record.requestId}`);
            this.emit('created', record);
        } catch (error) {
            logger.error('Failed to save usage record', error);
        }
    }

    async saveDebugLog(record: DebugLogRecord) {
        try {
            await this.ensureDb().insert(this.schema.debugLogs).values({
                requestId: record.requestId,
                rawRequest: record.rawRequest ? (typeof record.rawRequest === 'string' ? record.rawRequest : JSON.stringify(record.rawRequest)) : null,
                transformedRequest: record.transformedRequest ? (typeof record.transformedRequest === 'string' ? record.transformedRequest : JSON.stringify(record.transformedRequest)) : null,
                rawResponse: record.rawResponse ? (typeof record.rawResponse === 'string' ? record.rawResponse : JSON.stringify(record.rawResponse)) : null,
                transformedResponse: record.transformedResponse ? (typeof record.transformedResponse === 'string' ? record.transformedResponse : JSON.stringify(record.transformedResponse)) : null,
                rawResponseSnapshot: record.rawResponseSnapshot ? JSON.stringify(record.rawResponseSnapshot) : null,
                transformedResponseSnapshot: record.transformedResponseSnapshot ? JSON.stringify(record.transformedResponseSnapshot) : null,
                createdAt: record.createdAt || Date.now()
            });

            logger.debug(`Debug log saved for request ${record.requestId}`);
        } catch (error) {
            logger.error('Failed to save debug log', error);
        }
    }

    async saveError(requestId: string, error: any, details?: any) {
        try {
            await this.ensureDb().insert(this.schema.inferenceErrors).values({
                requestId,
                date: new Date().toISOString(),
                errorMessage: error.message || String(error),
                errorStack: error.stack || null,
                details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
                createdAt: Date.now(),
            });

            logger.debug(`Inference error saved for request ${requestId}`);
        } catch (e) {
            logger.error('Failed to save inference error', e);
        }
    }

    async getErrors(limit: number = 50, offset: number = 0): Promise<any[]> {
        try {
            const results = await this.ensureDb()
                .select()
                .from(this.schema.inferenceErrors)
                .orderBy(desc(this.schema.inferenceErrors.createdAt))
                .limit(limit)
                .offset(offset);
            
            return results;
        } catch (error) {
            logger.error('Failed to get inference errors', error);
            return [];
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

    async getDebugLogs(limit: number = 50, offset: number = 0): Promise<{ requestId: string, createdAt: number }[]> {
        try {
            const results = await this.ensureDb()
                .select({
                    requestId: this.schema.debugLogs.requestId,
                    createdAt: this.schema.debugLogs.createdAt
                })
                .from(this.schema.debugLogs)
                .orderBy(desc(this.schema.debugLogs.createdAt))
                .limit(limit)
                .offset(offset);

            return results.map(row => ({
                requestId: row.requestId,
                createdAt: row.createdAt
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
                transformedResponseSnapshot: row.transformedResponseSnapshot
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

    async getUsage(filters: UsageFilters, pagination: PaginationOptions): Promise<{ data: UsageRecord[], total: number }> {
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
        if (filters.provider) {
            conditions.push(like(schema.requestUsage.provider, `%${filters.provider}%`));
        }
        if (filters.incomingModelAlias) {
            conditions.push(like(schema.requestUsage.incomingModelAlias, `%${filters.incomingModelAlias}%`));
        }
        if (filters.selectedModelName) {
            conditions.push(like(schema.requestUsage.selectedModelName, `%${filters.selectedModelName}%`));
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
                    incomingModelAlias: schema.requestUsage.incomingModelAlias,
                    canonicalModelName: schema.requestUsage.canonicalModelName,
                    selectedModelName: schema.requestUsage.selectedModelName,
                    outgoingApiType: schema.requestUsage.outgoingApiType,
                    tokensInput: schema.requestUsage.tokensInput,
                    tokensOutput: schema.requestUsage.tokensOutput,
                    tokensReasoning: schema.requestUsage.tokensReasoning,
                    tokensCached: schema.requestUsage.tokensCached,
                    tokensEstimated: schema.requestUsage.tokensEstimated,
                    costInput: schema.requestUsage.costInput,
                    costOutput: schema.requestUsage.costOutput,
                    costCached: schema.requestUsage.costCached,
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
                    hasDebug: sql<boolean>`EXISTS(SELECT 1 FROM ${schema.debugLogs} dl WHERE dl.request_id = request_usage.request_id)`,
                    hasError: sql<boolean>`EXISTS(SELECT 1 FROM ${schema.inferenceErrors} ie WHERE ie.request_id = request_usage.request_id)`,
                })
                .from(schema.requestUsage)
                .where(whereClause)
                .orderBy(desc(schema.requestUsage.date))
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
                incomingModelAlias: row.incomingModelAlias,
                canonicalModelName: row.canonicalModelName,
                selectedModelName: row.selectedModelName,
                outgoingApiType: row.outgoingApiType,
                tokensInput: row.tokensInput,
                tokensOutput: row.tokensOutput,
                tokensReasoning: row.tokensReasoning,
                tokensCached: row.tokensCached,
                tokensEstimated: row.tokensEstimated,
                costInput: row.costInput,
                costOutput: row.costOutput,
                costCached: row.costCached,
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
                finishReason: row.finishReason
            }));

            const countResults = await db
                .select({ count: sql<number>`count(*)` })
                .from(schema.requestUsage)
                .where(whereClause);

            const total = countResults[0]?.count ?? 0;

            return {
                data: mappedData,
                total
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

    async updatePerformanceMetrics(
        provider: string,
        model: string,
        timeToFirstTokenMs: number | null,
        outputTokens: number | null,
        durationMs: number,
        requestId: string
    ) {
        try {
            const retentionLimit = this.getPerformanceRetentionLimit();

            let tokensPerSec: number | null = null;
            if (outputTokens && durationMs > 0) {
                tokensPerSec = (outputTokens / durationMs) * 1000;
            }

            await this.ensureDb().insert(this.schema.providerPerformance).values({
                provider,
                model,
                requestId,
                timeToFirstTokenMs,
                totalTokens: outputTokens,
                durationMs,
                tokensPerSec,
                createdAt: Date.now()
            });

            const subquery = this.ensureDb()
                .select({ id: this.schema.providerPerformance.id })
                .from(this.schema.providerPerformance)
                .where(and(
                    sql`${this.schema.providerPerformance.provider} = ${provider}`,
                    sql`${this.schema.providerPerformance.model} = ${model}`
                ))
                .orderBy(desc(this.schema.providerPerformance.createdAt))
                .limit(retentionLimit)
                .as('sub');

            await this.ensureDb()
                .delete(this.schema.providerPerformance)
                .where(and(
                    eq(this.schema.providerPerformance.provider, provider),
                    eq(this.schema.providerPerformance.model, model),
                    sql`${this.schema.providerPerformance.id} NOT IN (SELECT id FROM ${subquery})`
                ));

            logger.debug(`Performance metrics updated for ${provider}:${model}`);
        } catch (error) {
            logger.error(`Failed to update performance metrics for ${provider}:${model}`, error);
        }
    }

    async getProviderPerformance(provider?: string, model?: string): Promise<any[]> {
        this.ensureDb();

        const describeError = (error: unknown) => {
            if (error instanceof Error) {
                return {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                };
            }
            return { value: String(error) };
        };

        const getFallbackFromUsage = async () => {
            try {
                const modelNameExpr = sql<string>`COALESCE(${this.schema.requestUsage.canonicalModelName}, ${this.schema.requestUsage.incomingModelAlias}, ${this.schema.requestUsage.selectedModelName})`;
                const conditions = [
                    sql`${this.schema.requestUsage.provider} IS NOT NULL`,
                    sql`${modelNameExpr} IS NOT NULL`,
                    sql`(${this.schema.requestUsage.ttftMs} IS NOT NULL OR ${this.schema.requestUsage.tokensPerSec} IS NOT NULL)`
                ];

                if (provider) {
                    conditions.push(eq(this.schema.requestUsage.provider, provider));
                }
                if (model) {
                    conditions.push(sql`${modelNameExpr} = ${model}`);
                }

                const whereClause = and(...conditions);

                const rows = await this.ensureDb()
                    .select({
                        provider: this.schema.requestUsage.provider,
                        model: modelNameExpr,
                        targetModel: this.schema.requestUsage.selectedModelName,
                        avgTtftMs: sql<number>`AVG(${this.schema.requestUsage.ttftMs})`,
                        minTtftMs: sql<number>`MIN(${this.schema.requestUsage.ttftMs})`,
                        maxTtftMs: sql<number>`MAX(${this.schema.requestUsage.ttftMs})`,
                        avgTokensPerSec: sql<number>`AVG(${this.schema.requestUsage.tokensPerSec})`,
                        minTokensPerSec: sql<number>`MIN(${this.schema.requestUsage.tokensPerSec})`,
                        maxTokensPerSec: sql<number>`MAX(${this.schema.requestUsage.tokensPerSec})`,
                        sampleCount: sql<number>`COUNT(*)`,
                        lastUpdated: sql<number>`MAX(${this.schema.requestUsage.createdAt})`
                    })
                    .from(this.schema.requestUsage)
                    .where(whereClause)
                    .groupBy(
                        this.schema.requestUsage.provider,
                        this.schema.requestUsage.selectedModelName,
                        modelNameExpr
                    )
                    .orderBy(desc(sql`AVG(${this.schema.requestUsage.tokensPerSec})`));

                logger.debug('Provider performance fallback query succeeded', {
                    providerFilter: provider ?? null,
                    modelFilter: model ?? null,
                    rowCount: rows.length,
                    source: 'request_usage'
                });

                return rows.map(row => ({
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
                    last_updated: row.lastUpdated ?? 0
                }));
            } catch (fallbackError) {
                logger.error('Failed fallback provider performance query from request_usage', {
                    providerFilter: provider ?? null,
                    modelFilter: model ?? null,
                    error: describeError(fallbackError)
                });
                return [];
            }
        };

        try {
            logger.debug('Running provider performance query', {
                providerFilter: provider ?? null,
                modelFilter: model ?? null,
                source: 'provider_performance+request_usage'
            });

            const conditions = [];
            const modelNameExpr = sql<string>`COALESCE(${this.schema.requestUsage.canonicalModelName}, ${this.schema.requestUsage.incomingModelAlias}, ${this.schema.providerPerformance.model})`;
            
            if (provider) {
                conditions.push(eq(this.schema.providerPerformance.provider, provider));
            }
            if (model) {
                conditions.push(sql`${modelNameExpr} = ${model}`);
            }

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

            const selection = {
                provider: this.schema.providerPerformance.provider,
                model: modelNameExpr,
                targetModel: this.schema.providerPerformance.model,
                avgTtftMs: sql<number>`AVG(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                minTtftMs: sql<number>`MIN(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                maxTtftMs: sql<number>`MAX(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                avgTokensPerSec: sql<number>`AVG(${this.schema.providerPerformance.tokensPerSec})`,
                minTokensPerSec: sql<number>`MIN(${this.schema.providerPerformance.tokensPerSec})`,
                maxTokensPerSec: sql<number>`MAX(${this.schema.providerPerformance.tokensPerSec})`,
                sampleCount: sql<number>`COUNT(*)`,
                lastUpdated: sql<number>`MAX(${this.schema.providerPerformance.createdAt})`
            };

            const baseQuery = this.ensureDb()
                .select(selection)
                .from(this.schema.providerPerformance)
                .leftJoin(
                    this.schema.requestUsage,
                    eq(this.schema.providerPerformance.requestId, this.schema.requestUsage.requestId)
                );

            const results = whereClause
                ? await baseQuery
                    .where(whereClause)
                    .groupBy(
                        this.schema.providerPerformance.provider,
                        this.schema.providerPerformance.model,
                        modelNameExpr
                    )
                    .orderBy(desc(sql`AVG(${this.schema.providerPerformance.tokensPerSec})`))
                : await baseQuery
                    .groupBy(
                        this.schema.providerPerformance.provider,
                        this.schema.providerPerformance.model,
                        modelNameExpr
                    )
                    .orderBy(desc(sql`AVG(${this.schema.providerPerformance.tokensPerSec})`));

            logger.debug('Provider performance primary query completed', {
                providerFilter: provider ?? null,
                modelFilter: model ?? null,
                rowCount: results.length,
                source: 'provider_performance'
            });

            const mappedPrimaryRows = results.map(row => ({
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
                last_updated: row.lastUpdated ?? 0
            }));

            if (!results || results.length === 0) {
                logger.warn('Provider performance primary query returned no rows, using fallback', {
                    providerFilter: provider ?? null,
                    modelFilter: model ?? null
                });
                return await getFallbackFromUsage();
            }

            if (!model) {
                return mappedPrimaryRows;
            }

            const fallbackRows = await getFallbackFromUsage();
            const mergedRows = new Map<string, any>();

            for (const row of mappedPrimaryRows) {
                mergedRows.set(`${row.provider}:${row.target_model}:${row.model}`, row);
            }

            for (const row of fallbackRows) {
                const key = `${row.provider}:${row.target_model}:${row.model}`;
                if (!mergedRows.has(key)) {
                    mergedRows.set(key, row);
                }
            }

            return Array.from(mergedRows.values()).sort((a, b) => b.avg_tokens_per_sec - a.avg_tokens_per_sec);
        } catch (error) {
            logger.error('Failed to get provider performance', {
                providerFilter: provider ?? null,
                modelFilter: model ?? null,
                error: describeError(error)
            });
            return await getFallbackFromUsage();
        }
    }
}
