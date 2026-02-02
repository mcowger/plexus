import { UsageStorageService } from './usage-storage';
import { logger } from '../utils/logger';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';

export interface DebugLogRecord {
    requestId: string;
    rawRequest?: any;
    transformedRequest?: any;
    rawResponse?: any;
    transformedResponse?: any;
    rawResponseSnapshot?: any;
    transformedResponseSnapshot?: any;
    createdAt?: number;
}

export class DebugManager {
    private static instance: DebugManager;
    private storage: UsageStorageService | null = null;
    private enabled: boolean = false;
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

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        logger.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    startLog(requestId: string, rawRequest: any) {
        if (!this.enabled) return;
        this.pendingLogs.set(requestId, {
            requestId,
            rawRequest,
            createdAt: Date.now()
        });

        // Auto-cleanup after 5 minutes to prevent memory leaks if streams hang or fail to flush
        setTimeout(() => {
            if (this.pendingLogs.has(requestId)) {
                logger.debug(`Auto-flushing stale debug log for ${requestId}`);
                this.flush(requestId);
            }
        }, 5 * 60 * 1000);
    }

    addTransformedRequest(requestId: string, payload: any) {
        if (!this.enabled) return;
        let log = this.pendingLogs.get(requestId);
        if (!log) {
            // Create log entry if it doesn't exist (for ephemeral token estimation)
            log = {
                requestId,
                createdAt: Date.now()
            };
            this.pendingLogs.set(requestId, log);
        }
        log.transformedRequest = payload;
    }

    addRawResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        let log = this.pendingLogs.get(requestId);
        if (!log) {
            // Create log entry if it doesn't exist (for ephemeral token estimation)
            log = {
                requestId,
                createdAt: Date.now()
            };
            this.pendingLogs.set(requestId, log);
        }
        log.rawResponse = payload;
    }

    addReconstructedRawResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        let log = this.pendingLogs.get(requestId);
        if (!log) {
            // Create log entry if it doesn't exist (for ephemeral token estimation)
            log = {
                requestId,
                createdAt: Date.now()
            };
            this.pendingLogs.set(requestId, log);
        }
        log.rawResponseSnapshot = payload;
    }

    addTransformedResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        let log = this.pendingLogs.get(requestId);
        if (!log) {
            // Create log entry if it doesn't exist (for ephemeral token estimation)
            log = {
                requestId,
                createdAt: Date.now()
            };
            this.pendingLogs.set(requestId, log);
        }
        log.transformedResponse = payload;
    }

    addTransformedResponseSnapshot(requestId: string, payload: any) {
        if (!this.enabled) return;
        let log = this.pendingLogs.get(requestId);
        if (!log) {
            // Create log entry if it doesn't exist (for ephemeral token estimation)
            log = {
                requestId,
                createdAt: Date.now()
            };
            this.pendingLogs.set(requestId, log);
        }
        log.transformedResponseSnapshot = payload;
    }

    flush(requestId: string) {
        // Skip flushing ephemeral requests
        if (this.ephemeralRequests.has(requestId)) {
            logger.debug(`[DebugManager] Skipping flush for ephemeral request ${requestId}`);
            return;
        }

        if (!this.storage) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            logger.debug(`[DebugManager] Flushing debug log for ${requestId}`);
            this.storage.saveDebugLog(log);
            this.pendingLogs.delete(requestId);
        }
    }

    /**
     * Mark a request as ephemeral (debug data won't be persisted)
     */
    markEphemeral(requestId: string): void {
        this.ephemeralRequests.add(requestId);
        logger.debug(`[DebugManager] Marked ${requestId} as ephemeral`);
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
            logger.debug(`[DebugManager] Discarded ephemeral data for ${requestId}`);
        }
    }
}
