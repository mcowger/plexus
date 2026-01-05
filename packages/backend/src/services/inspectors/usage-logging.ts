import { BaseInspector } from "./base";
import { logger } from "../../utils/logger";
import { PassThrough } from "stream";
import { TransformerFactory } from "../transformer-factory";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";
import { calculateCosts } from "../../utils/calculate-costs";

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
        
        // Stream buffering
        let partialLine = "";

        // Usage accumulators
        const stats = {
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            foundUsage: false
        };

        const processLine = (line: string) => {
            // Heuristic optimization:
            // Only parse lines that contain "usage" (case-insensitive).
            // This avoids JSON parsing for the vast majority of content chunks.
            if (!line.toLowerCase().includes("usage")) {
                return;
            }

            let jsonStr = line;
            if (line.startsWith("data:")) {
                jsonStr = line.replace(/^data:\s*/, "").trim();
            }

            if (!jsonStr || jsonStr === "[DONE]") return;

            const usage = transformer.extractUsage(jsonStr);
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
        };

        inspector.on('data', (chunk: Buffer) => {
            if (firstChunk) {
                const now = Date.now();
                this.usageRecord.ttftMs = now - this.startTime;
                firstChunk = false;
            }

            // Append chunk to buffer
            partialLine += chunk.toString();

            // Process complete lines
            if (partialLine.includes('\n')) {
                const lines = partialLine.split(/\r?\n/);
                // The last element is the potentially incomplete line
                partialLine = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim()) {
                        processLine(line);
                    }
                }
            }
        });

        inspector.on('end', () => {
            try {
                // Process any remaining buffer (rare, but good for correctness)
                if (partialLine.trim()) {
                    processLine(partialLine);
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

            } catch (err) {
                logger.error(`[Inspector:Usage] Error analyzing usage for ${this.requestId}:`, err);
            }
        });

        return inspector;
    }
}
