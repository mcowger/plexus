import { logger } from '../utils/logger';
import { UsageRecord } from '../types/usage';
import { getDatabase, getSchema } from '../db/client';
import { NewRequestUsage } from '../db/types';
import { EventEmitter } from 'node:events';
import { eq, and, gte, lte, like, desc, sql } from 'drizzle-orm';
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

    async saveRequest(record: NewRequestUsage | UsageRecord) {
        try {
            const isStreamedValue = typeof record.isStreamed === 'boolean' ? (record.isStreamed ? 1 : 0) : record.isStreamed;
            const isPassthroughValue = typeof record.isPassthrough === 'boolean' ? (record.isPassthrough ? 1 : 0) : record.isPassthrough;

            await this.ensureDb().insert(this.schema.requestUsage).values({
                ...record,
                isStreamed: isStreamedValue,
                isPassthrough: isPassthroughValue,
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
        const conditions = [];

        if (filters.startDate) {
            conditions.push(gte(this.schema.requestUsage.date, filters.startDate));
        }
        if (filters.endDate) {
            conditions.push(lte(this.schema.requestUsage.date, filters.endDate));
        }
        if (filters.incomingApiType) {
            conditions.push(eq(this.schema.requestUsage.incomingApiType, filters.incomingApiType));
        }
        if (filters.provider) {
            conditions.push(like(this.schema.requestUsage.provider, `%${filters.provider}%`));
        }
        if (filters.incomingModelAlias) {
            conditions.push(like(this.schema.requestUsage.incomingModelAlias, `%${filters.incomingModelAlias}%`));
        }
        if (filters.selectedModelName) {
            conditions.push(like(this.schema.requestUsage.selectedModelName, `%${filters.selectedModelName}%`));
        }
        if (filters.outgoingApiType) {
            conditions.push(eq(this.schema.requestUsage.outgoingApiType, filters.outgoingApiType));
        }
        if (filters.minDurationMs !== undefined) {
            conditions.push(gte(this.schema.requestUsage.durationMs, filters.minDurationMs));
        }
        if (filters.maxDurationMs !== undefined) {
            conditions.push(lte(this.schema.requestUsage.durationMs, filters.maxDurationMs));
        }
        if (filters.responseStatus) {
            conditions.push(eq(this.schema.requestUsage.responseStatus, filters.responseStatus));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        try {
            const data = await this.ensureDb()
                .select({
                    requestId: this.schema.requestUsage.requestId,
                    date: this.schema.requestUsage.date,
                    sourceIp: this.schema.requestUsage.sourceIp,
                    apiKey: this.schema.requestUsage.apiKey,
                    attribution: this.schema.requestUsage.attribution,
                    incomingApiType: this.schema.requestUsage.incomingApiType,
                    provider: this.schema.requestUsage.provider,
                    incomingModelAlias: this.schema.requestUsage.incomingModelAlias,
                    canonicalModelName: this.schema.requestUsage.canonicalModelName,
                    selectedModelName: this.schema.requestUsage.selectedModelName,
                    outgoingApiType: this.schema.requestUsage.outgoingApiType,
                    tokensInput: this.schema.requestUsage.tokensInput,
                    tokensOutput: this.schema.requestUsage.tokensOutput,
                    tokensReasoning: this.schema.requestUsage.tokensReasoning,
                    tokensCached: this.schema.requestUsage.tokensCached,
                    tokensEstimated: this.schema.requestUsage.tokensEstimated,
                    costInput: this.schema.requestUsage.costInput,
                    costOutput: this.schema.requestUsage.costOutput,
                    costCached: this.schema.requestUsage.costCached,
                    costTotal: this.schema.requestUsage.costTotal,
                    costSource: this.schema.requestUsage.costSource,
                    costMetadata: this.schema.requestUsage.costMetadata,
                    startTime: this.schema.requestUsage.startTime,
                    durationMs: this.schema.requestUsage.durationMs,
                    ttftMs: this.schema.requestUsage.ttftMs,
                    tokensPerSec: this.schema.requestUsage.tokensPerSec,
                    isStreamed: this.schema.requestUsage.isStreamed,
                    isPassthrough: this.schema.requestUsage.isPassthrough,
                    responseStatus: this.schema.requestUsage.responseStatus,
                    toolsDefined: this.schema.requestUsage.toolsDefined,
                    messageCount: this.schema.requestUsage.messageCount,
                    parallelToolCallsEnabled: this.schema.requestUsage.parallelToolCallsEnabled,
                    toolCallsCount: this.schema.requestUsage.toolCallsCount,
                    finishReason: this.schema.requestUsage.finishReason,
                    hasDebug: sql<boolean>`EXISTS(SELECT 1 FROM ${this.schema.debugLogs} WHERE ${this.schema.debugLogs.requestId} = ${this.schema.requestUsage.requestId})`,
                    hasError: sql<boolean>`EXISTS(SELECT 1 FROM ${this.schema.inferenceErrors} WHERE ${this.schema.inferenceErrors.requestId} = ${this.schema.requestUsage.requestId})`,
                })
                .from(this.schema.requestUsage)
                .where(whereClause)
                .orderBy(desc(this.schema.requestUsage.date))
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

            const countResults = await this.ensureDb()
                .select({ count: sql<number>`count(*)` })
                .from(this.schema.requestUsage)
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
                .limit(10)
                .as('sub');

            await this.ensureDb()
                .delete(this.schema.providerPerformance)
                .where(sql`${this.schema.providerPerformance.id} NOT IN (SELECT id FROM ${subquery})`);

            logger.debug(`Performance metrics updated for ${provider}:${model}`);
        } catch (error) {
            logger.error(`Failed to update performance metrics for ${provider}:${model}`, error);
        }
    }

    async getProviderPerformance(provider?: string, model?: string): Promise<any[]> {
        try {
            const conditions = [];
            
            if (provider) {
                conditions.push(eq(this.schema.providerPerformance.provider, provider));
            }
            if (model) {
                conditions.push(eq(this.schema.providerPerformance.model, model));
            }

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

            const results = await this.ensureDb()
                .select({
                    provider: this.schema.providerPerformance.provider,
                    model: this.schema.providerPerformance.model,
                    avgTtftMs: sql<number>`AVG(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                    minTtftMs: sql<number>`MIN(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                    maxTtftMs: sql<number>`MAX(${this.schema.providerPerformance.timeToFirstTokenMs})`,
                    avgTokensPerSec: sql<number>`AVG(${this.schema.providerPerformance.tokensPerSec})`,
                    minTokensPerSec: sql<number>`MIN(${this.schema.providerPerformance.tokensPerSec})`,
                    maxTokensPerSec: sql<number>`MAX(${this.schema.providerPerformance.tokensPerSec})`,
                    sampleCount: sql<number>`COUNT(*)`,
                    lastUpdated: sql<number>`MAX(${this.schema.providerPerformance.createdAt})`
                })
                .from(this.schema.providerPerformance)
                .where(whereClause);
                
            const groupedResults = new Map<string, any>();
            for (const row of results) {
                const key = `${row.provider}:${row.model}`;
                if (!groupedResults.has(key)) {
                    groupedResults.set(key, {
                        provider: row.provider,
                        model: row.model,
                        avgTtftMs: 0,
                        minTtftMs: row.minTtftMs,
                        maxTtftMs: row.maxTtftMs,
                        avgTokensPerSec: 0,
                        minTokensPerSec: row.minTokensPerSec,
                        maxTokensPerSec: row.maxTokensPerSec,
                        sampleCount: 0,
                        lastUpdated: row.lastUpdated
                    });
                }
                const entry = groupedResults.get(key);
                if (entry && row.avgTtftMs !== null && row.avgTokensPerSec !== null) {
                    entry.avgTtftMs += row.avgTtftMs;
                    entry.avgTokensPerSec += row.avgTokensPerSec;
                    entry.sampleCount += (row.sampleCount ?? 0);
                    if (row.lastUpdated > entry.lastUpdated) {
                        entry.lastUpdated = row.lastUpdated;
                    }
                }
            }

            return Array.from(groupedResults.values()).map(row => ({
                provider: row.provider,
                model: row.model,
                avg_ttft_ms: row.sampleCount > 0 ? row.avgTtftMs / row.sampleCount : 0,
                min_ttft_ms: row.minTtftMs,
                max_ttft_ms: row.maxTtftMs,
                avg_tokens_per_sec: row.sampleCount > 0 ? row.avgTokensPerSec / row.sampleCount : 0,
                min_tokens_per_sec: row.minTokensPerSec,
                max_tokens_per_sec: row.maxTokensPerSec,
                sample_count: row.sampleCount,
                last_updated: row.lastUpdated
            }));
        } catch (error) {
            logger.error('Failed to get provider performance', error);
            return [];
        }
    }
}
