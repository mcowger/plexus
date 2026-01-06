import { BaseInspector } from "./base";
import { logger } from "../../utils/logger";
import { PassThrough } from "stream";
import { TransformerFactory } from "../transformer-factory";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";
import { calculateCosts } from "../../utils/calculate-costs";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { DebugManager } from "../debug-manager";
import { countTokens } from "../../transformers/utils";

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

        // Content accumulators for Anthropic token imputation
        let accumulatedText = "";
        let seenThinking = false;

        const parser = createParser({
            onEvent: (event: EventSourceMessage) => {
                if (event.data === "[DONE]") return;

                const isAnthropic = transformer.name === "messages";
                let jsonParsed: any = null;

                // Optimization: Skip non-usage chunks unless we need them for content tracking (Anthropic)
                if (!isAnthropic && !event.data.toLowerCase().includes("usage")) {
                    return;
                }

                try {
                    // We might need the full JSON for content extraction
                    // Or we just rely on extractUsage.
                    // But for content extraction, we need parsing.
                    if (isAnthropic || event.data.toLowerCase().includes("usage")) {
                         jsonParsed = JSON.parse(event.data);
                    }
                } catch (e) {
                    return;
                }

                // --- Content Tracking for Anthropic Imputation ---
                if (isAnthropic && jsonParsed) {
                     // 1. Check for thinking content
                     if (jsonParsed.type === 'content_block_start') {
                         if (jsonParsed.content_block?.type === 'thinking') {
                             seenThinking = true;
                         }
                     }
                     if (jsonParsed.type === 'content_block_delta') {
                         if (jsonParsed.delta?.type === 'thinking_delta') {
                             seenThinking = true;
                         }
                         if (jsonParsed.delta?.type === 'text_delta') {
                             accumulatedText += (jsonParsed.delta.text || "");
                         }
                     }
                }
                // -------------------------------------------------

                // Use the transformer to extract usage if present
                const usage = transformer.extractUsage(event.data);
                if (usage) {
                    stats.foundUsage = true;
                    
                    // "chat" (OpenAI) and "gemini" typically report cumulative totals in each event (or final event)
                    if (transformer.name === 'gemini' || transformer.name === 'chat') {
                        stats.inputTokens = Math.max(stats.inputTokens, usage.input_tokens || 0);
                        stats.outputTokens = Math.max(stats.outputTokens, usage.output_tokens || 0);
                        stats.cachedTokens = Math.max(stats.cachedTokens, usage.cached_tokens || 0);
                        stats.reasoningTokens = Math.max(stats.reasoningTokens, usage.reasoning_tokens || 0);
                    } else {
                        // "messages" (Anthropic) reports distinct parts (deltas) in different events
                        stats.inputTokens += usage.input_tokens || 0;
                        stats.outputTokens += usage.output_tokens || 0;
                        stats.cachedTokens += usage.cached_tokens || 0;
                        stats.reasoningTokens += usage.reasoning_tokens || 0;
                    }
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
                // Apply Anthropic Imputation Logic if needed
                if (transformer.name === "messages" && seenThinking) {
                    const realOutputTokens = countTokens(accumulatedText);
                    const totalOutputTokens = stats.outputTokens;
                    
                    // If the reported total is significantly larger than the text count,
                    // we assume the difference is reasoning.
                    // If they are equal (because already imputed), this results in 0, which is safe.
                    const imputedThinkingTokens = Math.max(0, totalOutputTokens - realOutputTokens);
                    
                    if (imputedThinkingTokens > 0) {
                        stats.outputTokens = realOutputTokens;
                        stats.reasoningTokens = imputedThinkingTokens;
                    }
                }

                if (stats.foundUsage) {
                    this.usageRecord.tokensInput = stats.inputTokens;
                    this.usageRecord.tokensOutput = stats.outputTokens;
                    this.usageRecord.tokensCached = stats.cachedTokens;
                    this.usageRecord.tokensReasoning = stats.reasoningTokens;
                }

                // Finalize stats
                this.usageRecord.durationMs = Date.now() - this.startTime;
                if (stats.outputTokens > 0 && this.usageRecord.durationMs && this.usageRecord.durationMs > 0) {
                     this.usageRecord.tokensPerSec = (stats.outputTokens / this.usageRecord.durationMs) * 1000;
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
