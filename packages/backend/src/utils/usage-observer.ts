import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { calculateCosts } from './calculate-costs';
import { logger } from './logger';
import { Transformer } from '../types/transformer';
import { parse as parseSSE } from 'event-stream-parser';

/**
 * Creates a StreamObserver specifically for LLM usage tracking.
 * Extracts TTFT and usage objects from stream chunks using the transformer's extractUsage method.
 * 
 * @param usageRecord - Partial usage record to populate with metrics
 * @param startTime - Request start timestamp for TTFT calculation
 * @param usageStorage - Storage service for saving usage records
 * @param pricing - Pricing configuration for cost calculation
 * @param transformer - Transformer instance with extractUsage method
 * @param providerDiscount - Optional provider discount
 * @returns Configured StreamObserver instance with cleanup callback
 */
export function createUsageObserver(
    usageRecord: Partial<UsageRecord>,
    startTime: number,
    usageStorage: UsageStorageService,
    pricing: any,
    transformer: Transformer,
    providerDiscount?: number
): { observeAndProcess: (stream: ReadableStream) => Promise<void> } {
    let firstEventReceived = false;
    let eventsProcessed = 0;    
    // Function that handles the entire observation pipeline
    const observeAndProcess = async (rawStream: ReadableStream) => {
        try {
            // Parse SSE stream into complete events (handles fragmentation)
            const eventStream = await parseSSE(rawStream as ReadableStream<Uint8Array>);
            const reader = eventStream.getReader();
            
            try {
                while (true) {
                    const { done, value: event } = await reader.read();
                    if (done) break;
                    
                    eventsProcessed++;
                    
                    // Capture TTFT on first event
                    if (!firstEventReceived) {
                        usageRecord.ttftMs = Date.now() - startTime;
                        firstEventReceived = true;
                        logger.debug(`[UsageObserver] ${usageRecord.requestId} - TTFT captured: ${usageRecord.ttftMs}ms`);
                    }

                    // Extract usage from complete event data
                    if (transformer.extractUsage) {
                        const usage = transformer.extractUsage(event.data);
                        if (usage) {
                            usageRecord.tokensInput = (usageRecord.tokensInput || 0) + (usage.input_tokens || 0);
                            usageRecord.tokensOutput = (usageRecord.tokensOutput || 0) + (usage.output_tokens || 0);
                            usageRecord.tokensCached = (usageRecord.tokensCached || 0) + (usage.cached_tokens || 0);
                            usageRecord.tokensReasoning = (usageRecord.tokensReasoning || 0) + (usage.reasoning_tokens || 0);
                            
                            logger.debug(`[UsageObserver] ${usageRecord.requestId} - Event ${eventsProcessed} usage: +${usage.input_tokens}i +${usage.output_tokens}o (totals: ${usageRecord.tokensInput}i/${usageRecord.tokensOutput}o)`);
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (e: any) {
            logger.error(`[UsageObserver] ${usageRecord.requestId} - Observation error: ${e.message}`);
        } finally {
            // Finalize and save
            usageRecord.durationMs = Date.now() - startTime;
            if (usageRecord.tokensOutput && usageRecord.durationMs) {
                usageRecord.tokensPerSec = (usageRecord.tokensOutput / usageRecord.durationMs) * 1000;
            }

            calculateCosts(usageRecord, pricing, providerDiscount);

            try {
                usageStorage.saveRequest(usageRecord as UsageRecord);
                logger.debug(`[UsageObserver] ${usageRecord.requestId} - Usage saved: ${usageRecord.tokensInput}i/${usageRecord.tokensOutput}o`);
            } catch (e: any) {
                logger.error(`[UsageObserver] ${usageRecord.requestId} - Save failed: ${e.message}`);
            }

            if (usageRecord.provider && usageRecord.selectedModelName) {
                usageStorage.updatePerformanceMetrics(
                    usageRecord.provider,
                    usageRecord.selectedModelName,
                    usageRecord.ttftMs || null,
                    usageRecord.tokensOutput || null,
                    usageRecord.durationMs,
                    usageRecord.requestId!
                );
            }
        }
    };

    return { observeAndProcess };
}
