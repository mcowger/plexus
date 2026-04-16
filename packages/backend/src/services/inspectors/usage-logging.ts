import type { ModelParams, GpuParams } from '@plexus/shared';
import { logger } from '../../utils/logger';
import { PassThrough } from 'stream';
import { UsageStorageService } from '../usage-storage';
import { UsageRecord } from '../../types/usage';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../debug-manager';
import { estimateTokensFromReconstructed, estimateInputTokens } from '../../utils/estimate-tokens';
import {
  normalizeGeminiUsage,
  normalizeOpenAIChatUsage,
  normalizeOpenAIResponsesUsage,
} from '../../utils/usage-normalizer';
import { estimateKwhUsed } from '../inference-energy';
import { applyProviderReportedCost } from '../../utils/provider-cost';
import { DEFAULT_MODEL, DEFAULT_GPU_PARAMS } from '@plexus/shared';

export class UsageInspector extends PassThrough {
  private usageStorage: UsageStorageService;
  private usageRecord: Partial<UsageRecord>;
  private pricing: any;
  private providerDiscount?: number;
  private startTime: number;
  private shouldEstimateTokens: boolean;
  private apiType: string;
  private incomingApiType: string;
  private originalRequest?: any;
  private firstChunk = true;

  private modelParams: ModelParams;
  private gpuParams: GpuParams;

  constructor(
    requestId: string,
    usageStorage: UsageStorageService,
    usageRecord: Partial<UsageRecord>,
    pricing: any,
    providerDiscount: number | undefined,
    startTime: number,
    shouldEstimateTokens: boolean = false,
    apiType: string = 'chat',
    incomingApiType?: string,
    originalRequest?: any,
    gpuParams: GpuParams = DEFAULT_GPU_PARAMS,
    modelParams: ModelParams = DEFAULT_MODEL
  ) {
    super();
    this.usageStorage = usageStorage;
    this.usageRecord = usageRecord;
    this.pricing = pricing;
    this.providerDiscount = providerDiscount;
    this.startTime = startTime;
    this.shouldEstimateTokens = shouldEstimateTokens;
    this.apiType = apiType;
    this.incomingApiType = incomingApiType || apiType;
    this.originalRequest = originalRequest;
    this.gpuParams = gpuParams;
    this.modelParams = modelParams;
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
      cacheWriteTokens: 0,
      reasoningTokens: 0,
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
          stats.cacheWriteTokens = usage.cacheWriteTokens || 0;
          stats.reasoningTokens = usage.reasoningTokens || 0;
        }

        // Extract response metadata (tool calls count and finish reason)
        const responseMetadata = this.extractResponseMetadataFromReconstructed(
          reconstructed,
          this.apiType
        );
        this.usageRecord.toolCallsCount = responseMetadata.toolCallsCount;
        this.usageRecord.finishReason = responseMetadata.finishReason;

        if (this.shouldEstimateTokens) {
          logger.info(
            `[Inspector:Usage] No usage data found for ${this.usageRecord.requestId}, attempting estimation`
          );
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
          stats.inputTokens = estimateInputTokens(this.originalRequest, this.incomingApiType);
        }

        this.usageRecord.tokensInput = stats.inputTokens;
        this.usageRecord.tokensOutput = stats.outputTokens;
        this.usageRecord.tokensCached = stats.cachedTokens;
        this.usageRecord.tokensCacheWrite = stats.cacheWriteTokens;
        this.usageRecord.tokensReasoning = stats.reasoningTokens;
      }

      this.usageRecord.durationMs = Date.now() - this.startTime;
      if (
        stats.outputTokens > 0 &&
        this.usageRecord.durationMs &&
        this.usageRecord.durationMs > 0
      ) {
        const timeToTokensMs = this.usageRecord.durationMs - (this.usageRecord.ttftMs || 0);
        this.usageRecord.tokensPerSec =
          timeToTokensMs > 0 ? (stats.outputTokens / timeToTokensMs) * 1000 : 0;
      }

      calculateCosts(this.usageRecord, this.pricing, this.providerDiscount);

      // Override with provider-reported cost if available
      // Some providers emit `: cost {"request_cost_usd": ...}` as SSE comments
      if (reconstructed?.providerReportedCost) {
        applyProviderReportedCost(this.usageRecord, reconstructed.providerReportedCost);
      }

      // Estimate energy consumption using resolved GPU and model params
      this.usageRecord.kwhUsed = estimateKwhUsed(
        stats.inputTokens,
        stats.outputTokens,
        this.modelParams,
        this.gpuParams
      );

      // Fire-and-forget: saveRequest is async but _flush is synchronous
      // Attach error handler to prevent unhandled promise rejections
      this.usageStorage.saveRequest(this.usageRecord as UsageRecord).catch((err) => {
        logger.error(
          `[Inspector:Usage] Failed to save usage record for ${this.usageRecord.requestId}:`,
          err
        );
      });

      if (this.usageRecord.provider && this.usageRecord.selectedModelName) {
        // Fire-and-forget: updatePerformanceMetrics is async but _flush is synchronous
        // Attach error handler to prevent unhandled promise rejections
        this.usageStorage
          .updatePerformanceMetrics(
            this.usageRecord.provider,
            this.usageRecord.selectedModelName,
            this.usageRecord.canonicalModelName ?? null,
            this.usageRecord.ttftMs || null,
            stats.outputTokens > 0 ? stats.outputTokens : null,
            this.usageRecord.durationMs,
            this.usageRecord.requestId!
          )
          .catch((err) => {
            logger.error(
              `[Inspector:Usage] Failed to update performance metrics for ${this.usageRecord.requestId}:`,
              err
            );
          });
      }

      logger.debug(
        `[Inspector:Usage] Request ${this.usageRecord.requestId} usage analysis complete.`
      );
      DebugManager.getInstance().flush(this.usageRecord.requestId!);
      callback();
    } catch (err) {
      logger.error(
        `[Inspector:Usage] Error analyzing usage for ${this.usageRecord.requestId}:`,
        err
      );
      callback();
    }
  }

  private extractUsageFromReconstructed(reconstructed: any, apiType: string): any {
    if (!reconstructed) return null;

    switch (apiType) {
      case 'chat':
        if (!reconstructed.usage) return null;
        {
          const usage = normalizeOpenAIChatUsage(reconstructed.usage);
          return {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cachedTokens: usage.cached_tokens,
            cacheWriteTokens: usage.cache_creation_tokens,
            reasoningTokens: usage.reasoning_tokens,
          };
        }
      case 'responses':
        if (!reconstructed.usage) return null;
        {
          const usage = normalizeOpenAIResponsesUsage(reconstructed.usage);
          return {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cachedTokens: usage.cached_tokens,
            cacheWriteTokens: usage.cache_creation_tokens,
            reasoningTokens: usage.reasoning_tokens,
          };
        }
      case 'messages':
        return reconstructed.usage
          ? {
              inputTokens: reconstructed.usage.input_tokens || 0,
              outputTokens: reconstructed.usage.output_tokens || 0,
              cachedTokens: reconstructed.usage.cache_read_input_tokens || 0,
              cacheWriteTokens: reconstructed.usage.cache_creation_input_tokens || 0,
              reasoningTokens: 0,
            }
          : null;
      case 'gemini':
        if (!reconstructed.usageMetadata) return null;
        {
          const usage = normalizeGeminiUsage(reconstructed.usageMetadata);
          return {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cachedTokens: usage.cached_tokens,
            cacheWriteTokens: usage.cache_creation_tokens,
            reasoningTokens: usage.reasoning_tokens,
          };
        }
      case 'oauth':
        return reconstructed.usage
          ? {
              inputTokens: reconstructed.usage.input_tokens || 0,
              outputTokens: reconstructed.usage.output_tokens || 0,
              cachedTokens: reconstructed.usage.cached_tokens || 0,
              cacheWriteTokens: reconstructed.usage.cache_creation_tokens || 0,
              reasoningTokens: reconstructed.usage.reasoning_tokens || 0,
            }
          : null;
      default:
        return null;
    }
  }

  private extractResponseMetadataFromReconstructed(
    reconstructed: any,
    apiType: string
  ): { toolCallsCount: number | null; finishReason: string | null } {
    if (!reconstructed) {
      return { toolCallsCount: null, finishReason: null };
    }

    switch (apiType) {
      case 'chat': {
        // OpenAI format: tool_calls are in choices[0].delta.tool_calls in the reconstructed snapshot
        // or choices[0].message.tool_calls in a full non-streaming response.
        const choice = reconstructed.choices?.[0];
        const toolCalls =
          choice?.delta?.tool_calls ||
          choice?.message?.tool_calls ||
          choice?.tool_calls ||
          reconstructed.tool_calls ||
          choice?.message?.function_call ||
          reconstructed.function_call;
        let finishReason = choice?.finish_reason || choice?.finishReason || null;

        // Fallback for Gemini-style content in OpenAI-compatible response (some providers do this)
        let toolCallsCount = Array.isArray(toolCalls) ? toolCalls.filter(Boolean).length : 0;
        if (
          toolCallsCount === 0 &&
          (choice?.message?.function_call || reconstructed.function_call)
        ) {
          toolCallsCount = 1;
        }

        // Deep search fallback for any field named 'tool_calls' or 'functionCall'
        if (toolCallsCount === 0) {
          toolCallsCount = this.deepSearchToolCalls(reconstructed);
        }

        if (toolCallsCount === 0 && reconstructed.candidates?.[0]) {
          const candidate = reconstructed.candidates[0];
          if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
            toolCallsCount = candidate.content.parts.filter(
              (part: any) => part.functionCall
            ).length;
          }
          if (!finishReason) {
            finishReason = candidate.finishReason || null;
          }
        }

        // Normalize finish reason
        if (finishReason) {
          finishReason = finishReason.toLowerCase();
          if ((finishReason === 'stop' || finishReason === 'end_turn') && toolCallsCount > 0) {
            finishReason = this.incomingApiType === 'messages' ? 'tool_use' : 'tool_calls';
          }
        } else if (toolCallsCount > 0) {
          finishReason = this.incomingApiType === 'messages' ? 'tool_use' : 'tool_calls';
        }

        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
      case 'responses': {
        // Responses API format: function_call items in output array
        let toolCallsCount = 0;
        if (reconstructed.output && Array.isArray(reconstructed.output)) {
          toolCallsCount = reconstructed.output.filter(
            (item: any) => item.type === 'function_call'
          ).length;
        }
        // Responses API doesn't have a direct finish_reason, use status instead
        const finishReason = reconstructed.status === 'completed' ? 'stop' : reconstructed.status;
        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
      case 'messages': {
        // Anthropic format: tool_use blocks in content array
        let toolCallsCount = 0;
        if (reconstructed.content && Array.isArray(reconstructed.content)) {
          toolCallsCount = reconstructed.content.filter(
            (block: any) => block.type === 'tool_use'
          ).length;
        }
        const finishReason = reconstructed.stop_reason || reconstructed.finish_reason || null;
        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
      case 'gemini': {
        // Gemini format: functionCall parts in candidates[0].content.parts
        let toolCallsCount = 0;
        const candidate = reconstructed.candidates?.[0];
        if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
          toolCallsCount = candidate.content.parts.filter((part: any) => part.functionCall).length;
        }

        // Fallback for OpenAI-style tool_calls or deep search if direct part check fails
        if (toolCallsCount === 0) {
          toolCallsCount = this.deepSearchToolCalls(reconstructed);
        }

        let finishReason = candidate?.finishReason || null;

        // Fallback for OpenAI-style tool_calls in a Gemini-identified response
        if (toolCallsCount === 0 && reconstructed.choices?.[0]) {
          const choice = reconstructed.choices[0];
          const toolCalls = choice.delta?.tool_calls || choice.message?.tool_calls;
          if (Array.isArray(toolCalls)) {
            toolCallsCount = toolCalls.filter(Boolean).length;
          }
          if (!finishReason) {
            finishReason = choice.finish_reason || null;
          }
        }

        // Normalize finish reason
        if (finishReason) {
          finishReason = finishReason.toLowerCase();
          if (finishReason === 'stop' && toolCallsCount > 0) {
            finishReason = this.incomingApiType === 'messages' ? 'tool_use' : 'tool_calls';
          }
        } else if (toolCallsCount > 0) {
          finishReason = this.incomingApiType === 'messages' ? 'tool_use' : 'tool_calls';
        }

        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
      case 'oauth': {
        const toolCallsCount = reconstructed.tool_calls?.length ?? 0;
        const finishReason = reconstructed.finishReason ?? null;
        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
      default: {
        // Generic fallback
        const toolCalls = reconstructed.tool_calls || reconstructed.choices?.[0]?.tool_calls;
        const toolCallsCount = Array.isArray(toolCalls) ? toolCalls.length : 0;
        const finishReason =
          reconstructed.finish_reason || reconstructed.choices?.[0]?.finish_reason || null;
        return { toolCallsCount: toolCallsCount > 0 ? toolCallsCount : null, finishReason };
      }
    }
  }

  private deepSearchToolCalls(obj: any): number {
    if (!obj || typeof obj !== 'object') return 0;

    let count = 0;

    // Check common field names
    if (Array.isArray(obj.tool_calls)) {
      count = Math.max(count, obj.tool_calls.filter(Boolean).length);
    }
    if (obj.functionCall) {
      count = Math.max(count, 1);
    }
    if (Array.isArray(obj.parts)) {
      const functionCalls = obj.parts.filter((p: any) => p.functionCall).length;
      count = Math.max(count, functionCalls);
    }

    // Recurse into common containers
    if (Array.isArray(obj.choices)) {
      for (const choice of obj.choices) {
        count = Math.max(count, this.deepSearchToolCalls(choice.message || choice.delta || choice));
      }
    }
    if (Array.isArray(obj.candidates)) {
      for (const candidate of obj.candidates) {
        count = Math.max(count, this.deepSearchToolCalls(candidate.content || candidate));
      }
    }

    return count;
  }
}
