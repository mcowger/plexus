import { BaseInspector } from "./base";
import { logger } from "../../utils/logger";
import { PassThrough } from "stream";
import { TransformerFactory } from "../transformer-factory";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";
import { calculateCosts } from "../../utils/calculate-costs";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { DebugManager } from "../debug-manager";

export class UsageInspector extends BaseInspector {
    private usageStorage: UsageStorageService;
    private usageRecord: Partial<UsageRecord>;
    private pricing: any;
    private providerDiscount?: number;
    private startTime: number;

    constructor(
        requestId: string,
        usageStorage: UsageStorageService,
        usageRecord: Partial<UsageRecord>,
        pricing: any,
        providerDiscount: number | undefined,
        startTime: number
    ) {
        super(requestId);
        this.usageStorage = usageStorage;
        this.usageRecord = usageRecord;
        this.pricing = pricing;
        this.providerDiscount = providerDiscount;
        this.startTime = startTime;
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
