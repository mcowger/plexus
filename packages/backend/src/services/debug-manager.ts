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
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.transformedRequest = payload;
        }
    }

    addRawResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.rawResponse = payload;
        }
    }

    addReconstructedRawResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.rawResponseSnapshot = payload;
        }
    }

    addTransformedResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.transformedResponse = payload;
            this.flush(requestId); // For non-streaming responses
        }
    }

    addTransformedResponseSnapshot(requestId: string, payload: any) {
        if (!this.enabled) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.transformedResponseSnapshot = payload;
        }
    }
    

    flush(requestId: string) {
        if (!this.storage) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            logger.debug(`[DebugManager] Flushing debug log for ${requestId}`);
            this.storage.saveDebugLog(log);
            this.pendingLogs.delete(requestId);
        }
    }
}
