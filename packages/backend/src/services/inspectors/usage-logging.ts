import { BaseInspector } from "./base";
import { logger } from "../../utils/logger";
import { PassThrough } from "stream";
import { TransformerFactory } from "../transformer-factory";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";
import { calculateCosts } from "../../utils/calculate-costs";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { DebugManager } from "../debug-manager";
import { estimateTokensFromReconstructed, estimateInputTokens } from "../../utils/estimate-tokens";

export class UsageInspector extends BaseInspector {
    private usageStorage: UsageStorageService;
    private usageRecord: Partial<UsageRecord>;
    private pricing: any;
    private providerDiscount?: number;
    private startTime: number;
    private shouldEstimateTokens: boolean;
    private apiType: string;
    private originalRequest?: any;

    constructor(
        requestId: string,
        usageStorage: UsageStorageService,
        usageRecord: Partial<UsageRecord>,
        pricing: any,
        providerDiscount: number | undefined,
        startTime: number,
        shouldEstimateTokens: boolean = false,
        apiType: string = 'chat',
        originalRequest?: any
    ) {
        super(requestId);
        this.usageStorage = usageStorage;
        this.usageRecord = usageRecord;
        this.pricing = pricing;
        this.providerDiscount = providerDiscount;
        this.startTime = startTime;
        this.shouldEstimateTokens = shouldEstimateTokens;
        this.apiType = apiType;
        this.originalRequest = originalRequest;
    }

    createInspector(apiType: string): PassThrough {
        const inspector = new PassThrough();
        const transformer = TransformerFactory.getTransformer(apiType);
        
        // Track TTFT
        let firstChunk = true;
        
        // Usage accumulators
        const stats = {
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            foundUsage: false
        };

        const parser = createParser({
            onEvent: (event: EventSourceMessage) => {
                if (event.data === "[DONE]") return;

                // Optimization: Skip non-usage chunks for all providers
                if (!event.data.toLowerCase().includes("usage")) {
                    return;
                }

                try {
                    // Parse only to enable usage extraction
                    JSON.parse(event.data);
                } catch (e) {
                    return;
                }

                // Use the transformer to extract usage if present
                const usage = transformer.extractUsage(event.data);
                if (usage) {
                    stats.foundUsage = true;
                    
                    // Most providers report cumulative totals in usage events.
                    // Even Anthropic's message_start and message_delta usage fields are cumulative for those specific fields.
                    stats.inputTokens = Math.max(stats.inputTokens, usage.input_tokens || 0);
                    stats.outputTokens = Math.max(stats.outputTokens, usage.output_tokens || 0);
                    stats.cachedTokens = Math.max(stats.cachedTokens, usage.cached_tokens || 0);
                    stats.reasoningTokens = Math.max(stats.reasoningTokens, usage.reasoning_tokens || 0);
                }
            }
        });

        inspector.on('data', (chunk: Buffer) => {
            if (firstChunk) {
                const now = Date.now();
                this.usageRecord.ttftMs = now - this.startTime;
                firstChunk = false;
            }

            // Feed the parser with the chunk string
            parser.feed(chunk.toString());
        });

        inspector.on('end', () => {
            try {
                if (stats.foundUsage) {
                    this.usageRecord.tokensInput = stats.inputTokens;
                    this.usageRecord.tokensOutput = stats.outputTokens;
                    this.usageRecord.tokensCached = stats.cachedTokens;
                    this.usageRecord.tokensReasoning = stats.reasoningTokens;
                }

                // Estimate tokens if no usage data was found and estimation is enabled
                if (!stats.foundUsage && this.shouldEstimateTokens) {
                    logger.info(`[Inspector:Usage] No usage data found for ${this.requestId}, attempting estimation`);
                    
                    const debugManager = DebugManager.getInstance();
                    const reconstructed = debugManager.getReconstructedRawResponse(this.requestId);
                    
                    if (reconstructed) {
                        try {
                            const estimated = estimateTokensFromReconstructed(reconstructed, this.apiType);
                            
                            // Estimate input tokens from original request if available
                            if (this.originalRequest) {
                                const inputEstimate = estimateInputTokens(this.originalRequest, this.apiType);
                                stats.inputTokens = inputEstimate;
                            }
                            
                            stats.outputTokens = estimated.output;
                            stats.reasoningTokens = estimated.reasoning;
                            
                            // Update usage record with estimates
                            this.usageRecord.tokensInput = stats.inputTokens;
                            this.usageRecord.tokensOutput = stats.outputTokens;
                            this.usageRecord.tokensReasoning = stats.reasoningTokens;
                            
                            // Mark tokens as estimated (1 = estimated, 0 = actual)
                            this.usageRecord.tokensEstimated = 1;
                            
                            logger.info(
                                `[Inspector:Usage] Estimated tokens for ${this.requestId}: ` +
                                `input=${stats.inputTokens}, output=${stats.outputTokens}, reasoning=${stats.reasoningTokens}`
                            );
                        } catch (err) {
                            logger.error(`[Inspector:Usage] Token estimation failed for ${this.requestId}:`, err);
                        }
                    } else {
                        logger.warn(`[Inspector:Usage] No reconstructed response available for estimation on ${this.requestId}`);
                    }
                    
                    // Clean up ephemeral debug data
                    debugManager.discardEphemeral(this.requestId);
                }

                // Finalize stats
                this.usageRecord.durationMs = Date.now() - this.startTime;
                if (stats.outputTokens > 0 && this.usageRecord.durationMs && this.usageRecord.durationMs > 0) {
                    // Calculate TPS from first token to end
                    const timeToTokensMs = this.usageRecord.durationMs - (this.usageRecord.ttftMs || 0);
                    this.usageRecord.tokensPerSec = timeToTokensMs > 0 ? (stats.outputTokens / timeToTokensMs) * 1000 : 0;
                }
                
                calculateCosts(this.usageRecord, this.pricing, this.providerDiscount);
                this.usageStorage.saveRequest(this.usageRecord as UsageRecord);
                
                if (this.usageRecord.provider && this.usageRecord.selectedModelName) {
                    this.usageStorage.updatePerformanceMetrics(
                      this.usageRecord.provider,
                      this.usageRecord.selectedModelName,
                      this.usageRecord.ttftMs || null,
                      stats.outputTokens > 0 ? stats.outputTokens : null,
                      this.usageRecord.durationMs,
                      this.usageRecord.requestId!
                    );
                }

                logger.info(`[Inspector:Usage] Request ${this.requestId} usage analysis complete.`);
                DebugManager.getInstance().flush(this.requestId);

            } catch (err) {
                logger.error(`[Inspector:Usage] Error analyzing usage for ${this.requestId}:`, err);
            }
        });

        return inspector;
    }
}
