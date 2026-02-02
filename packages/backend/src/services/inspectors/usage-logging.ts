import { logger } from "../../utils/logger";
import { PassThrough } from "stream";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";
import { calculateCosts } from "../../utils/calculate-costs";
import { DebugManager } from "../debug-manager";
import { estimateTokensFromReconstructed, estimateInputTokens } from "../../utils/estimate-tokens";

export class UsageInspector extends PassThrough {
    private usageStorage: UsageStorageService;
    private usageRecord: Partial<UsageRecord>;
    private pricing: any;
    private providerDiscount?: number;
    private startTime: number;
    private shouldEstimateTokens: boolean;
    private apiType: string;
    private originalRequest?: any;
    private firstChunk = true;

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
        super();
        this.usageStorage = usageStorage;
        this.usageRecord = usageRecord;
        this.pricing = pricing;
        this.providerDiscount = providerDiscount;
        this.startTime = startTime;
        this.shouldEstimateTokens = shouldEstimateTokens;
        this.apiType = apiType;
        this.originalRequest = originalRequest;
    }

    override _transform(chunk: any, encoding: BufferEncoding, callback: Function) {
        if (this.firstChunk) {
            const now = Date.now();
            this.usageRecord.ttftMs = now - this.startTime;
            this.firstChunk = false;
        }
        callback(null, chunk);
    }

    override _flush(callback: Function) {
        const stats = {
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0
        };

        try {
            const debugManager = DebugManager.getInstance();
            const reconstructed = debugManager.getReconstructedRawResponse(this.usageRecord.requestId!);

            if (reconstructed) {
                const usage = this.extractUsageFromReconstructed(reconstructed, this.apiType);
                if (usage) {
                    stats.inputTokens = usage.inputTokens || 0;
                    stats.outputTokens = usage.outputTokens || 0;
                    stats.cachedTokens = usage.cachedTokens || 0;
                    stats.reasoningTokens = usage.reasoningTokens || 0;
                } else if (this.shouldEstimateTokens) {
                    logger.info(`[Inspector:Usage] No usage data found for ${this.usageRecord.requestId}, attempting estimation`);
                    const estimated = estimateTokensFromReconstructed(reconstructed, this.apiType);
                    stats.outputTokens = estimated.output;
                    stats.reasoningTokens = estimated.reasoning;
                    this.usageRecord.tokensEstimated = 1;
                    logger.info(
                        `[Inspector:Usage] Estimated tokens for ${this.usageRecord.requestId}: ` +
                        `output=${stats.outputTokens}, reasoning=${stats.reasoningTokens}`
                    );
                    debugManager.discardEphemeral(this.usageRecord.requestId!);
                }

                if (this.originalRequest && stats.inputTokens === 0) {
                    stats.inputTokens = estimateInputTokens(this.originalRequest, this.apiType);
                }

                this.usageRecord.tokensInput = stats.inputTokens;
                this.usageRecord.tokensOutput = stats.outputTokens;
                this.usageRecord.tokensCached = stats.cachedTokens;
                this.usageRecord.tokensReasoning = stats.reasoningTokens;
            }

            this.usageRecord.durationMs = Date.now() - this.startTime;
            if (stats.outputTokens > 0 && this.usageRecord.durationMs && this.usageRecord.durationMs > 0) {
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

            logger.info(`[Inspector:Usage] Request ${this.usageRecord.requestId} usage analysis complete.`);
            DebugManager.getInstance().flush(this.usageRecord.requestId!);
            callback();
        } catch (err) {
            logger.error(`[Inspector:Usage] Error analyzing usage for ${this.usageRecord.requestId}:`, err);
            callback();
        }
    }

    private extractUsageFromReconstructed(reconstructed: any, apiType: string): any {
        if (!reconstructed) return null;

        switch (apiType) {
            case "chat":
                return reconstructed.usage ? {
                    inputTokens: reconstructed.usage.prompt_tokens || 0,
                    outputTokens: reconstructed.usage.completion_tokens || 0,
                    cachedTokens: reconstructed.usage.prompt_tokens_details?.cached_tokens || 0,
                    reasoningTokens: reconstructed.usage.completion_tokens_details?.reasoning_tokens || 0
                } : null;
            case "messages":
                return reconstructed.usage ? {
                    inputTokens: reconstructed.usage.input_tokens || 0,
                    outputTokens: reconstructed.usage.output_tokens || 0,
                    cachedTokens: reconstructed.usage.cache_read_input_tokens || reconstructed.usage.cache_creation_input_tokens || 0,
                    reasoningTokens: 0
                } : null;
            case "gemini":
                return reconstructed.usageMetadata ? {
                    inputTokens: reconstructed.usageMetadata.promptTokenCount || 0,
                    outputTokens: reconstructed.usageMetadata.candidatesTokenCount || 0,
                    cachedTokens: reconstructed.usageMetadata.cachedContentTokenCount || 0,
                    reasoningTokens: 0
                } : null;
            default:
                return null;
        }
    }
}
