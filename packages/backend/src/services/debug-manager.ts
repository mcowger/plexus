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

    addTransformedResponse(requestId: string, payload: any) {
        if (!this.enabled) return;
        const log = this.pendingLogs.get(requestId);
        if (log) {
            log.transformedResponse = payload;
            this.flush(requestId); // For non-streaming responses
        }
    }
    
    /**
     * Observe and capture a stream for debug logging.
     * Returns a function that consumes the stream in the background.
     * 
     * @param stream - The stream to observe
     * @param requestId - Request ID for logging
     * @param type - Type of stream (rawResponse or transformedResponse)
     * @returns Function that processes the stream in background
     */
    observeAndCapture(
        stream: ReadableStream,
        requestId: string,
        type: 'rawResponse' | 'transformedResponse'
    ): () => Promise<void> {
        return async () => {
            if (!this.enabled) return;
            
            let sseText = '';
            const events: any[] = [];
            const decoder = new TextDecoder();
            
            try {
                // Parse SSE events properly (handles fragmentation)
                const parser = createParser({
                    onEvent: (event: EventSourceMessage) => {
                        // Reconstruct original SSE format for raw display
                        sseText += encode(event);
                        
                        // Parse and collect event data for snapshot
                        if (event.data && event.data !== '[DONE]') {
                            try {
                                const eventData = JSON.parse(event.data);
                                events.push(eventData);
                            } catch (e) {
                                // Ignore parse errors
                            }
                        }
                    }
                });

                const reader = stream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        parser.feed(decoder.decode(value, { stream: true }));
                    }
                } finally {
                    reader.releaseLock();
                }
                
                // Store accumulated data and snapshot
                const log = this.pendingLogs.get(requestId);
                if (log) {
                    log[type] = sseText;
                    
                    // Create snapshot by merging all events
                    if (events.length > 0) {
                        const snapshotKey = type === 'rawResponse' 
                            ? 'rawResponseSnapshot' 
                            : 'transformedResponseSnapshot';
                        log[snapshotKey] = this.mergeEvents(events);
                    }
                    
                    // Flush if this is the final capture
                    if (type === 'transformedResponse') {
                        this.flush(requestId);
                    }
                }
            } catch (e: any) {
                logger.error(`Debug capture error for ${requestId} (${type}): ${e.message}`);
                // Store whatever we captured
                const log = this.pendingLogs.get(requestId);
                if (log && sseText) {
                    log[type] = sseText;
                }
            }
        };
    }

    /**
     * Merge multiple SSE events into a single reconstructed object.
     * Similar to StreamReconstructor but works on already-parsed events.
     */
    private mergeEvents(events: any[]): any {
        if (events.length === 0) return null;
        if (events.length === 1) return events[0];
        
        // Deep merge all events
        return events.reduce((acc, event) => this.deepMerge(acc, event), {});
    }

    private deepMerge(target: any, source: any): any {
        if (target === null || target === undefined) return source;
        if (source === null || source === undefined) return target;

        const targetType = typeof target;
        const sourceType = typeof source;

        if (targetType !== sourceType) return source;

        // Handle Array
        if (Array.isArray(target) && Array.isArray(source)) {
            const result = [...target];
            source.forEach((item, index) => {
                if (index < result.length) {
                    result[index] = this.deepMerge(result[index], item);
                } else {
                    result.push(item);
                }
            });
            return result;
        }

        // Handle Object
        if (targetType === 'object' && !Array.isArray(target)) {
            const result = { ...target };
            for (const key in source) {
                if (key in result) {
                    result[key] = this.deepMerge(result[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        }

        // Handle String (Concatenate)
        if (targetType === 'string') {
            if (target !== source) {
                return target + source;
            }
            return target;
        }

        // Default: Source overwrites
        return source;
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
