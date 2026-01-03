import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { StreamObserver } from './observer-sidecar';
import { calculateCosts } from './calculate-costs';
import { logger } from './logger';
import { Transformer } from '../types/transformer';

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
): { observer: StreamObserver<any>; onComplete: () => void } {
    let firstChunkReceived = false;
    
    const observer = new StreamObserver<any>(async (chunk) => {
        // 1. Capture TTFT on first chunk
        if (!firstChunkReceived) {
            usageRecord.ttftMs = Date.now() - startTime;
            firstChunkReceived = true;
        }

        // 2. Extract usage info from raw chunk using transformer
        if (transformer.extractUsage) {
            const usage = transformer.extractUsage(chunk);
            if (usage) {
                // Accumulate tokens (some providers send incremental updates)
                usageRecord.tokensInput = (usageRecord.tokensInput || 0) + (usage.input_tokens || 0);
                usageRecord.tokensOutput = (usageRecord.tokensOutput || 0) + (usage.output_tokens || 0);
                usageRecord.tokensCached = (usageRecord.tokensCached || 0) + (usage.cached_tokens || 0);
                usageRecord.tokensReasoning = (usageRecord.tokensReasoning || 0) + (usage.reasoning_tokens || 0);
            }
        }
    });

    // Cleanup function to be called when stream completes
    const onComplete = () => {
        // Finalize metrics
        usageRecord.durationMs = Date.now() - startTime;
        if (usageRecord.tokensOutput && usageRecord.durationMs) {
            usageRecord.tokensPerSec = (usageRecord.tokensOutput / usageRecord.durationMs) * 1000;
        }

        // Calculate costs
        calculateCosts(usageRecord, pricing, providerDiscount);

        // Save usage record (non-blocking)
        try {
            usageStorage.saveRequest(usageRecord as UsageRecord);
            logger.debug(`Usage record saved for ${usageRecord.requestId}: ${JSON.stringify(usageRecord)}`);
        } catch (e: any) {
            logger.error(`Failed to save usage record: ${e.message}`);
        }

        // Update performance metrics (non-blocking)
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
    };

    return { observer, onComplete };
}
