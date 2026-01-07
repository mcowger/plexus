import { Database } from "bun:sqlite";
import { logger } from "../utils/logger";
import { UsageRecord } from "../types/usage";
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DebugLogRecord } from './debug-manager';

export interface OAuthCredential {
    id: number;
    provider: string;
    user_identifier: string;
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_at: number;
    scope?: string;
    project_id?: string;
    metadata?: string;
    created_at: number;
    updated_at: number;
    last_refreshed_at?: number;
}

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
    private db: Database;

    constructor(connectionString?: string) {
        super();
        const effectiveConnectionString = connectionString || process.env.PLEXUS_DB_URL;
        
        if (effectiveConnectionString) {
            this.db = new Database(effectiveConnectionString);
            this.init();
            return;
        }

        // Determine location
        let dbDir = process.env.DATA_DIR;

        if (!dbDir) {
             // Fallback to config directory logic
             // Check if we are in packages/backend (project root is ../../)
             const possibleRoot = path.resolve(process.cwd(), '../../');
             const localConfig = path.resolve(process.cwd(), 'config');
             
             if (fs.existsSync(path.join(possibleRoot, 'config', 'plexus.yaml'))) {
                 dbDir = path.join(possibleRoot, 'config');
             } else if (fs.existsSync(path.join(localConfig, 'plexus.yaml'))) {
                 dbDir = localConfig;
             } else {
                 // Fallback to local data dir if all else fails
                 dbDir = path.resolve(process.cwd(), 'data');
             }
        }
        
        // Ensure directory exists
        if (!fs.existsSync(dbDir)) {
            try {
                fs.mkdirSync(dbDir, { recursive: true });
            } catch (e) {
                 logger.error(`Failed to create data directory at ${dbDir}, falling back to local data/`, e);
                 dbDir = path.resolve(process.cwd(), 'data');
                 fs.mkdirSync(dbDir, { recursive: true });
            }
        }

        const dbPath = path.join(dbDir, "usage.sqlite");
        logger.info(`Initializing database at ${dbPath}`);
        
        this.db = new Database(dbPath);
        this.init();
    }

    getDb(): Database {
        return this.db;
    }

    private init() {
        try {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS request_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    source_ip TEXT,
                    api_key TEXT,
                    incoming_api_type TEXT,
                    provider TEXT,
                    incoming_model_alias TEXT,
                    canonical_model_name TEXT,
                    selected_model_name TEXT,
                    outgoing_api_type TEXT,
                    tokens_input INTEGER,
                    tokens_output INTEGER,
                    tokens_reasoning INTEGER,
                    tokens_cached INTEGER,
                    cost_input REAL,
                    cost_output REAL,
                    cost_cached REAL,
                    cost_total REAL,
                    cost_source TEXT,
                    cost_metadata TEXT,
                    start_time INTEGER,
                    duration_ms INTEGER,
                    is_streamed INTEGER,
                    response_status TEXT
                );
            `);
            
            // Migration: Recreate provider_cooldowns table with account_id support
            // Check if old schema exists and migrate
            try {
                const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_cooldowns'").all();
                if (tables.length > 0) {
                    // Check if it has the old schema (no account_id)
                    const columns = this.db.prepare("PRAGMA table_info(provider_cooldowns)").all() as { name: string }[];
                    const hasAccountId = columns.some(col => col.name === 'account_id');

                    if (!hasAccountId) {
                        logger.info("Migrating provider_cooldowns table to support per-account cooldowns");

                        // Rename old table
                        this.db.run("ALTER TABLE provider_cooldowns RENAME TO provider_cooldowns_old");

                        // Create new table with updated schema
                        this.db.run(`
                            CREATE TABLE provider_cooldowns (
                                provider TEXT NOT NULL,
                                account_id TEXT,
                                expiry INTEGER,
                                created_at INTEGER,
                                PRIMARY KEY (provider, account_id)
                            )
                        `);

                        // Migrate existing data (set account_id to NULL for existing cooldowns)
                        this.db.run(`
                            INSERT INTO provider_cooldowns (provider, account_id, expiry, created_at)
                            SELECT provider, NULL, expiry, created_at FROM provider_cooldowns_old
                        `);

                        // Drop old table
                        this.db.run("DROP TABLE provider_cooldowns_old");

                        logger.info("provider_cooldowns migration completed");
                    }
                } else {
                    // Create table with new schema
                    this.db.run(`
                        CREATE TABLE provider_cooldowns (
                            provider TEXT NOT NULL,
                            account_id TEXT,
                            expiry INTEGER,
                            created_at INTEGER,
                            PRIMARY KEY (provider, account_id)
                        )
                    `);
                }
            } catch (error) {
                logger.error("Failed to migrate provider_cooldowns table", error);
                // Fall back to creating new table if migration fails
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS provider_cooldowns (
                        provider TEXT NOT NULL,
                        account_id TEXT,
                        expiry INTEGER,
                        created_at INTEGER,
                        PRIMARY KEY (provider, account_id)
                    )
                `);
            }

            this.db.run(`
                CREATE TABLE IF NOT EXISTS debug_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL,
                    raw_request TEXT,
                    transformed_request TEXT,
                    raw_response TEXT,
                    transformed_response TEXT,
                    raw_response_snapshot TEXT,
                    transformed_response_snapshot TEXT,
                    created_at INTEGER
                );
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS inference_errors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    error_message TEXT,
                    error_stack TEXT,
                    details TEXT,
                    created_at INTEGER
                );
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS oauth_credentials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT NOT NULL,
                    user_identifier TEXT NOT NULL,
                    access_token TEXT NOT NULL,
                    refresh_token TEXT NOT NULL,
                    token_type TEXT DEFAULT 'Bearer',
                    expires_at INTEGER NOT NULL,
                    scope TEXT,
                    project_id TEXT,
                    metadata TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_refreshed_at INTEGER,
                    UNIQUE(provider, user_identifier)
                );
            `);

            this.db.run(`
                CREATE INDEX IF NOT EXISTS idx_oauth_provider
                ON oauth_credentials(provider);
            `);
            
            // Migration: Add columns if they don't exist (primitive check)
            try {
                this.db.run("ALTER TABLE debug_logs ADD COLUMN raw_response_snapshot TEXT;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE debug_logs ADD COLUMN transformed_response_snapshot TEXT;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_input REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_output REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_cached REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_total REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN is_passthrough INTEGER;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_source TEXT;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN cost_metadata TEXT;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN ttft_ms REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN tokens_per_sec REAL;");
            } catch (e) { /* ignore if exists */ }
            try {
                this.db.run("ALTER TABLE request_usage ADD COLUMN canonical_model_name TEXT;");
            } catch (e) { /* ignore if exists */ }

            // Provider Performance Table - stores last 10 request latencies and throughput
            this.db.run(`
                CREATE TABLE IF NOT EXISTS provider_performance (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    time_to_first_token_ms REAL,
                    total_tokens INTEGER,
                    duration_ms REAL,
                    tokens_per_sec REAL,
                    request_id TEXT
                );
            `);

            // Create indexes for efficient querying
            this.db.run(`
                CREATE INDEX IF NOT EXISTS idx_provider_performance_lookup
                ON provider_performance(provider, model, created_at DESC);
            `);

            logger.info("Storage initialized");
        } catch (error) {
            logger.error("Failed to initialize storage", error);
        }
    }

    saveRequest(record: UsageRecord) {
        try {
            const query = this.db.prepare(`
                INSERT INTO request_usage (
                    request_id, date, source_ip, api_key, incoming_api_type,
                    provider, incoming_model_alias, canonical_model_name, selected_model_name, outgoing_api_type,
                    tokens_input, tokens_output, tokens_reasoning, tokens_cached,
                    cost_input, cost_output, cost_cached, cost_total, cost_source, cost_metadata,
                    start_time, duration_ms, is_streamed, response_status, is_passthrough,
                    ttft_ms, tokens_per_sec
                ) VALUES (
                    $requestId, $date, $sourceIp, $apiKey, $incomingApiType,
                    $provider, $incomingModelAlias, $canonicalModelName, $selectedModelName, $outgoingApiType,
                    $tokensInput, $tokensOutput, $tokensReasoning, $tokensCached,
                    $costInput, $costOutput, $costCached, $costTotal, $costSource, $costMetadata,
                    $startTime, $durationMs, $isStreamed, $responseStatus, $isPassthrough,
                    $ttftMs, $tokensPerSec
                )
            `);

            query.run({
                $requestId: record.requestId,
                $date: record.date,
                $sourceIp: record.sourceIp,
                $apiKey: record.apiKey,
                $incomingApiType: record.incomingApiType,
                $provider: record.provider,
                $incomingModelAlias: record.incomingModelAlias,
                $canonicalModelName: record.canonicalModelName,
                $selectedModelName: record.selectedModelName,
                $outgoingApiType: record.outgoingApiType,
                $tokensInput: record.tokensInput,
                $tokensOutput: record.tokensOutput,
                $tokensReasoning: record.tokensReasoning,
                $tokensCached: record.tokensCached,
                $costInput: record.costInput,
                $costOutput: record.costOutput,
                $costCached: record.costCached,
                $costTotal: record.costTotal,
                $costSource: record.costSource,
                $costMetadata: record.costMetadata,
                $startTime: record.startTime,
                $durationMs: record.durationMs,
                $isStreamed: record.isStreamed ? 1 : 0,
                $responseStatus: record.responseStatus,
                $isPassthrough: record.isPassthrough ? 1 : 0,
                $ttftMs: record.ttftMs,
                $tokensPerSec: record.tokensPerSec
            } as any);
            
            logger.debug(`Usage record saved for request ${record.requestId}`);
            this.emit('created', record);
        } catch (error) {
            logger.error("Failed to save usage record", error);
        }
    }

    saveDebugLog(record: DebugLogRecord) {
        try {
            const query = this.db.prepare(`
                INSERT INTO debug_logs (
                    request_id, raw_request, transformed_request, 
                    raw_response, transformed_response, 
                    raw_response_snapshot, transformed_response_snapshot,
                    created_at
                ) VALUES (
                    $requestId, $rawRequest, $transformedRequest, 
                    $rawResponse, $transformedResponse, 
                    $rawResponseSnapshot, $transformedResponseSnapshot,
                    $createdAt
                )
            `);

            query.run({
                $requestId: record.requestId,
                $rawRequest: record.rawRequest ? (typeof record.rawRequest === 'string' ? record.rawRequest : JSON.stringify(record.rawRequest)) : null,
                $transformedRequest: record.transformedRequest ? (typeof record.transformedRequest === 'string' ? record.transformedRequest : JSON.stringify(record.transformedRequest)) : null,
                $rawResponse: record.rawResponse ? (typeof record.rawResponse === 'string' ? record.rawResponse : JSON.stringify(record.rawResponse)) : null,
                $transformedResponse: record.transformedResponse ? (typeof record.transformedResponse === 'string' ? record.transformedResponse : JSON.stringify(record.transformedResponse)) : null,
                $rawResponseSnapshot: record.rawResponseSnapshot ? JSON.stringify(record.rawResponseSnapshot) : null,
                $transformedResponseSnapshot: record.transformedResponseSnapshot ? JSON.stringify(record.transformedResponseSnapshot) : null,
                $createdAt: record.createdAt || Date.now()
            });
            
            logger.debug(`Debug log saved for request ${record.requestId}`);
        } catch (error) {
            logger.error("Failed to save debug log", error);
        }
    }

    saveError(requestId: string, error: any, details?: any) {
        try {
            const query = this.db.prepare(`
                INSERT INTO inference_errors (
                    request_id, date, error_message, error_stack, details, created_at
                ) VALUES (
                    $requestId, $date, $errorMessage, $errorStack, $details, $createdAt
                )
            `);

            query.run({
                $requestId: requestId,
                $date: new Date().toISOString(),
                $errorMessage: error.message || String(error),
                $errorStack: error.stack || null,
                $details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
                $createdAt: Date.now()
            });
            
            logger.debug(`Inference error saved for request ${requestId}`);
        } catch (e) {
            logger.error("Failed to save inference error", e);
        }
    }

    getErrors(limit: number = 50, offset: number = 0): any[] {
        try {
            const query = this.db.prepare(`
                SELECT * FROM inference_errors 
                ORDER BY created_at DESC 
                LIMIT $limit OFFSET $offset
            `);
            return query.all({ $limit: limit, $offset: offset });
        } catch (error) {
            logger.error("Failed to get inference errors", error);
            return [];
        }
    }

    deleteError(requestId: string): boolean {
        try {
            const query = this.db.prepare(`
                DELETE FROM inference_errors WHERE request_id = $requestId
            `);
            const result = query.run({ $requestId: requestId });
            return result.changes > 0;
        } catch (error) {
            logger.error(`Failed to delete error log for ${requestId}`, error);
            return false;
        }
    }

    deleteAllErrors(): boolean {
        try {
            this.db.run("DELETE FROM inference_errors");
            logger.info("Deleted all error logs");
            return true;
        } catch (error) {
            logger.error("Failed to delete all error logs", error);
            return false;
        }
    }

    getDebugLogs(limit: number = 50, offset: number = 0): { requestId: string, createdAt: number }[] {
        try {
            const query = this.db.prepare(`
                SELECT request_id, created_at 
                FROM debug_logs 
                ORDER BY created_at DESC 
                LIMIT $limit OFFSET $offset
            `);
            const results = query.all({ $limit: limit, $offset: offset }) as any[];
            return results.map(row => ({
                requestId: row.request_id,
                createdAt: row.created_at
            }));
        } catch (error) {
            logger.error("Failed to get debug logs", error);
            return [];
        }
    }

    getDebugLog(requestId: string): DebugLogRecord | null {
        try {
            const query = this.db.prepare(`
                SELECT * FROM debug_logs WHERE request_id = $requestId
            `);
            const row = query.get({ $requestId: requestId }) as any;
            if (!row) return null;

            return {
                requestId: row.request_id,
                createdAt: row.created_at,
                rawRequest: row.raw_request,
                transformedRequest: row.transformed_request,
                rawResponse: row.raw_response,
                transformedResponse: row.transformed_response,
                rawResponseSnapshot: row.raw_response_snapshot,
                transformedResponseSnapshot: row.transformed_response_snapshot
            };
        } catch (error) {
            logger.error(`Failed to get debug log for ${requestId}`, error);
            return null;
        }
    }

    deleteDebugLog(requestId: string): boolean {
        try {
            const query = this.db.prepare(`
                DELETE FROM debug_logs WHERE request_id = $requestId
            `);
            const result = query.run({ $requestId: requestId });
            return result.changes > 0;
        } catch (error) {
            logger.error(`Failed to delete debug log for ${requestId}`, error);
            return false;
        }
    }

    deleteAllDebugLogs(): boolean {
        try {
            this.db.run("DELETE FROM debug_logs");
            logger.info("Deleted all debug logs");
            return true;
        } catch (error) {
            logger.error("Failed to delete all debug logs", error);
            return false;
        }
    }

    getUsage(filters: UsageFilters, pagination: PaginationOptions): { data: UsageRecord[], total: number } {
        let queryStr = `
            SELECT request_usage.*, 
            EXISTS(SELECT 1 FROM debug_logs WHERE debug_logs.request_id = request_usage.request_id) as has_debug,
            EXISTS(SELECT 1 FROM inference_errors WHERE inference_errors.request_id = request_usage.request_id) as has_error
            FROM request_usage 
            WHERE 1=1
        `;
        let countQueryStr = "SELECT COUNT(*) as count FROM request_usage WHERE 1=1";
        const params: any = {};

        if (filters.startDate) {
            queryStr += " AND date >= $startDate";
            countQueryStr += " AND date >= $startDate";
            params.$startDate = filters.startDate;
        }
        if (filters.endDate) {
            queryStr += " AND date <= $endDate";
            countQueryStr += " AND date <= $endDate";
            params.$endDate = filters.endDate;
        }
        if (filters.incomingApiType) {
            queryStr += " AND incoming_api_type = $incomingApiType";
            countQueryStr += " AND incoming_api_type = $incomingApiType";
            params.$incomingApiType = filters.incomingApiType;
        }
        if (filters.provider) {
            queryStr += " AND provider LIKE $provider";
            countQueryStr += " AND provider LIKE $provider";
            params.$provider = `%${filters.provider}%`;
        }
        if (filters.incomingModelAlias) {
            queryStr += " AND incoming_model_alias LIKE $incomingModelAlias";
            countQueryStr += " AND incoming_model_alias LIKE $incomingModelAlias";
            params.$incomingModelAlias = `%${filters.incomingModelAlias}%`;
        }
        if (filters.selectedModelName) {
            queryStr += " AND selected_model_name LIKE $selectedModelName";
            countQueryStr += " AND selected_model_name LIKE $selectedModelName";
            params.$selectedModelName = `%${filters.selectedModelName}%`;
        }
        if (filters.outgoingApiType) {
            queryStr += " AND outgoing_api_type = $outgoingApiType";
            countQueryStr += " AND outgoing_api_type = $outgoingApiType";
            params.$outgoingApiType = filters.outgoingApiType;
        }
        if (filters.minDurationMs !== undefined) {
            queryStr += " AND duration_ms >= $minDurationMs";
            countQueryStr += " AND duration_ms >= $minDurationMs";
            params.$minDurationMs = filters.minDurationMs;
        }
        if (filters.maxDurationMs !== undefined) {
            queryStr += " AND duration_ms <= $maxDurationMs";
            countQueryStr += " AND duration_ms <= $maxDurationMs";
            params.$maxDurationMs = filters.maxDurationMs;
        }
        if (filters.responseStatus) {
            queryStr += " AND response_status = $responseStatus";
            countQueryStr += " AND response_status = $responseStatus";
            params.$responseStatus = filters.responseStatus;
        }

        queryStr += " ORDER BY date DESC LIMIT $limit OFFSET $offset";
        
        const dataParams = { ...params, $limit: pagination.limit, $offset: pagination.offset };

        try {
            const countResult = this.db.query(countQueryStr).get(params) as { count: number };
            const dataResult = this.db.query(queryStr).all(dataParams) as any[];

            // Map snake_case to camelCase for UsageRecord
            const mappedData: UsageRecord[] = dataResult.map(row => ({
                requestId: row.request_id,
                date: row.date,
                sourceIp: row.source_ip,
                apiKey: row.api_key,
                incomingApiType: row.incoming_api_type,
                provider: row.provider,
                incomingModelAlias: row.incoming_model_alias,
                canonicalModelName: row.canonical_model_name,
                selectedModelName: row.selected_model_name,
                outgoingApiType: row.outgoing_api_type,
                tokensInput: row.tokens_input,
                tokensOutput: row.tokens_output,
                tokensReasoning: row.tokens_reasoning,
                tokensCached: row.tokens_cached,
                costInput: row.cost_input,
                costOutput: row.cost_output,
                costCached: row.cost_cached,
                costTotal: row.cost_total,
                costSource: row.cost_source,
                costMetadata: row.cost_metadata,
                startTime: row.start_time,
                durationMs: row.duration_ms,
                isStreamed: !!row.is_streamed,
                responseStatus: row.response_status,
                ttftMs: row.ttft_ms,
                tokensPerSec: row.tokens_per_sec,
                hasDebug: !!row.has_debug,
                hasError: !!row.has_error,
                isPassthrough: !!row.is_passthrough
            }));

            return {
                data: mappedData,
                total: countResult.count
            };
        } catch (error) {
            logger.error("Failed to query usage", error);
            throw error;
        }
    }

    deleteUsageLog(requestId: string): boolean {
        try {
            const query = this.db.prepare(`
                DELETE FROM request_usage WHERE request_id = $requestId
            `);
            const result = query.run({ $requestId: requestId });
            return result.changes > 0;
        } catch (error) {
            logger.error(`Failed to delete usage log for ${requestId}`, error);
            return false;
        }
    }

    deleteAllUsageLogs(beforeDate?: Date): boolean {
        try {
            if (beforeDate) {
                const query = this.db.prepare("DELETE FROM request_usage WHERE date < $beforeDate");
                query.run({ $beforeDate: beforeDate.toISOString() });
                logger.info(`Deleted usage logs older than ${beforeDate.toISOString()}`);
            } else {
                this.db.run("DELETE FROM request_usage");
                logger.info("Deleted all usage logs");
            }
            return true;
        } catch (error) {
            logger.error("Failed to delete usage logs", error);
            return false;
        }
    }

    updatePerformanceMetrics(
        provider: string,
        model: string,
        timeToFirstTokenMs: number | null,
        outputTokens: number | null,
        durationMs: number,
        requestId: string
    ) {
        try {
            // Calculate tokens per second if we have both values
            let tokensPerSec: number | null = null;
            if (outputTokens && durationMs > 0) {
                tokensPerSec = (outputTokens / durationMs) * 1000;
            }

            // Insert new performance record
            const insertQuery = this.db.prepare(`
                INSERT INTO provider_performance (
                    provider, model, created_at, time_to_first_token_ms, 
                    total_tokens, duration_ms, tokens_per_sec, request_id
                ) VALUES (
                    $provider, $model, $createdAt, $ttft, 
                    $totalTokens, $durationMs, $tokensPerSec, $requestId
                )
            `);

            insertQuery.run({
                $provider: provider,
                $model: model,
                $createdAt: Date.now(),
                $ttft: timeToFirstTokenMs,
                $totalTokens: outputTokens,
                $durationMs: durationMs,
                $tokensPerSec: tokensPerSec,
                $requestId: requestId
            });

            // Keep only the last 10 records per provider+model combination
            // Delete older records beyond the 10th
            const deleteQuery = this.db.prepare(`
                DELETE FROM provider_performance
                WHERE provider = $provider AND model = $model
                AND id NOT IN (
                    SELECT id FROM provider_performance
                    WHERE provider = $provider AND model = $model
                    ORDER BY created_at DESC
                    LIMIT 10
                )
            `);

            deleteQuery.run({
                $provider: provider,
                $model: model
            });

            logger.debug(`Performance metrics updated for ${provider}:${model}`);
        } catch (error) {
            logger.error(`Failed to update performance metrics for ${provider}:${model}`, error);
        }
    }

    getProviderPerformance(provider?: string, model?: string): any[] {
        try {
            let queryStr = `
                SELECT 
                    provider,
                    model,
                    AVG(time_to_first_token_ms) as avg_ttft_ms,
                    MIN(time_to_first_token_ms) as min_ttft_ms,
                    MAX(time_to_first_token_ms) as max_ttft_ms,
                    AVG(tokens_per_sec) as avg_tokens_per_sec,
                    MIN(tokens_per_sec) as min_tokens_per_sec,
                    MAX(tokens_per_sec) as max_tokens_per_sec,
                    COUNT(*) as sample_count,
                    MAX(created_at) as last_updated
                FROM provider_performance
                WHERE 1=1
            `;

            const params: any = {};

            if (provider) {
                queryStr += " AND provider = $provider";
                params.$provider = provider;
            }

            if (model) {
                queryStr += " AND model = $model";
                params.$model = model;
            }

            queryStr += " GROUP BY provider, model ORDER BY provider, model";

            const query = this.db.prepare(queryStr);
            return query.all(params) as any[];
        } catch (error) {
            logger.error("Failed to get provider performance", error);
            return [];
        }
    }

    saveOAuthCredential(credential: Omit<OAuthCredential, 'id'>): void {
        try {
            const query = this.db.prepare(`
                INSERT INTO oauth_credentials (
                    provider, user_identifier, access_token, refresh_token,
                    token_type, expires_at, scope, project_id, metadata,
                    created_at, updated_at, last_refreshed_at
                ) VALUES (
                    $provider, $userIdentifier, $accessToken, $refreshToken,
                    $tokenType, $expiresAt, $scope, $projectId, $metadata,
                    $createdAt, $updatedAt, $lastRefreshedAt
                )
                ON CONFLICT(provider, user_identifier) DO UPDATE SET
                    access_token = $accessToken,
                    refresh_token = $refreshToken,
                    token_type = $tokenType,
                    expires_at = $expiresAt,
                    scope = $scope,
                    project_id = $projectId,
                    metadata = $metadata,
                    updated_at = $updatedAt,
                    last_refreshed_at = $lastRefreshedAt
            `);

            query.run({
                $provider: credential.provider,
                $userIdentifier: credential.user_identifier,
                $accessToken: credential.access_token,
                $refreshToken: credential.refresh_token,
                $tokenType: credential.token_type,
                $expiresAt: credential.expires_at,
                $scope: credential.scope || null,
                $projectId: credential.project_id || null,
                $metadata: credential.metadata || null,
                $createdAt: credential.created_at,
                $updatedAt: credential.updated_at,
                $lastRefreshedAt: credential.last_refreshed_at || null
            });

            logger.debug(`OAuth credential saved for ${credential.provider}:${credential.user_identifier}`);
        } catch (error) {
            logger.error("Failed to save OAuth credential", error);
            throw error;
        }
    }

    getOAuthCredential(provider: string, userIdentifier?: string): OAuthCredential | null {
        try {
            let query;
            let params: any;

            if (userIdentifier) {
                query = this.db.prepare(`
                    SELECT * FROM oauth_credentials
                    WHERE provider = $provider AND user_identifier = $userIdentifier
                `);
                params = { $provider: provider, $userIdentifier: userIdentifier };
            } else {
                query = this.db.prepare(`
                    SELECT * FROM oauth_credentials
                    WHERE provider = $provider
                    ORDER BY updated_at DESC
                    LIMIT 1
                `);
                params = { $provider: provider };
            }

            const row = query.get(params) as any;
            if (!row) return null;

            return {
                id: row.id,
                provider: row.provider,
                user_identifier: row.user_identifier,
                access_token: row.access_token,
                refresh_token: row.refresh_token,
                token_type: row.token_type,
                expires_at: row.expires_at,
                scope: row.scope,
                project_id: row.project_id,
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_refreshed_at: row.last_refreshed_at
            };
        } catch (error) {
            logger.error(`Failed to get OAuth credential for ${provider}`, error);
            return null;
        }
    }

    updateOAuthToken(provider: string, userIdentifier: string, accessToken: string, expiresAt: number): void {
        try {
            const query = this.db.prepare(`
                UPDATE oauth_credentials
                SET access_token = $accessToken,
                    expires_at = $expiresAt,
                    updated_at = $updatedAt,
                    last_refreshed_at = $lastRefreshedAt
                WHERE provider = $provider AND user_identifier = $userIdentifier
            `);

            const now = Date.now();
            query.run({
                $accessToken: accessToken,
                $expiresAt: expiresAt,
                $updatedAt: now,
                $lastRefreshedAt: now,
                $provider: provider,
                $userIdentifier: userIdentifier
            });

            logger.debug(`OAuth token updated for ${provider}:${userIdentifier}`);
        } catch (error) {
            logger.error(`Failed to update OAuth token for ${provider}:${userIdentifier}`, error);
            throw error;
        }
    }

    getAllOAuthCredentials(provider: string): OAuthCredential[] {
        try {
            const query = this.db.prepare(`
                SELECT * FROM oauth_credentials
                WHERE provider = $provider
                ORDER BY updated_at DESC
            `);

            const rows = query.all({ $provider: provider }) as any[];
            return rows.map(row => ({
                id: row.id,
                provider: row.provider,
                user_identifier: row.user_identifier,
                access_token: row.access_token,
                refresh_token: row.refresh_token,
                token_type: row.token_type,
                expires_at: row.expires_at,
                scope: row.scope,
                project_id: row.project_id,
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_refreshed_at: row.last_refreshed_at
            }));
        } catch (error) {
            logger.error(`Failed to get all OAuth credentials for ${provider}`, error);
            return [];
        }
    }

    deleteOAuthCredential(provider: string, userIdentifier: string): boolean {
        try {
            const query = this.db.prepare(`
                DELETE FROM oauth_credentials
                WHERE provider = $provider AND user_identifier = $userIdentifier
            `);
            const result = query.run({ $provider: provider, $userIdentifier: userIdentifier });
            return result.changes > 0;
        } catch (error) {
            logger.error(`Failed to delete OAuth credential for ${provider}:${userIdentifier}`, error);
            return false;
        }
    }

    listExpiringSoonCredentials(thresholdMinutes: number): OAuthCredential[] {
        try {
            const thresholdMs = Date.now() + (thresholdMinutes * 60 * 1000);
            const query = this.db.prepare(`
                SELECT * FROM oauth_credentials
                WHERE expires_at <= $threshold
                ORDER BY expires_at ASC
            `);

            const rows = query.all({ $threshold: thresholdMs }) as any[];
            return rows.map(row => ({
                id: row.id,
                provider: row.provider,
                user_identifier: row.user_identifier,
                access_token: row.access_token,
                refresh_token: row.refresh_token,
                token_type: row.token_type,
                expires_at: row.expires_at,
                scope: row.scope,
                project_id: row.project_id,
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_refreshed_at: row.last_refreshed_at
            }));
        } catch (error) {
            logger.error("Failed to list expiring credentials", error);
            return [];
        }
    }
}
