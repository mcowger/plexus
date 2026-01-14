import type { UsageLogEntry, ErrorLogEntry } from "../types/usage";
import type { ApiType } from "./transformer-factory";
import { UsageStore } from "../storage/usage-store";
import { ErrorStore } from "../storage/error-store";
import { CostCalculator } from "./cost-calculator";
import { MetricsCollector } from "./metrics-collector";
import { logger } from "../utils/logger";
import type { RequestMetrics } from "../types/metrics";
import type { EventEmitter } from "./event-emitter";

/**
 * Context for tracking a request throughout its lifecycle
 */
export interface RequestContext {
  id: string;
  startTime: number; // Unix timestamp in ms
  clientIp: string;
  apiKeyName: string;
  clientApiType: ApiType;

  // Routing info (set after resolution)
  aliasUsed?: string;
  actualProvider?: string;
  actualModel?: string;
  targetApiType?: ApiType;
  passthrough?: boolean;

  // Streaming tracking
  streaming?: boolean;
  providerFirstTokenTime?: number; // Unix timestamp in ms - when first token received from provider
  clientFirstTokenTime?: number; // Unix timestamp in ms - when first token sent to client
}

/**
 * Response info extracted from provider response
 */
export interface ResponseInfo {
  success: boolean;
  streaming: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
  };
  errorType?: string;
  errorMessage?: string;
  httpStatus?: number;
}

/**
 * Service for logging usage and errors
 */
export class UsageLogger {
  private usageStore: UsageStore;
  private errorStore: ErrorStore;
  private costCalculator: CostCalculator;
  private metricsCollector: MetricsCollector;
  private eventEmitter?: EventEmitter;
  private enabled: boolean;
  private streamingContexts: Map<string, RequestContext> = new Map();

  constructor(
    usageStore: UsageStore,
    errorStore: ErrorStore,
    costCalculator: CostCalculator,
    metricsCollector: MetricsCollector,
    enabled: boolean = true,
    eventEmitter?: EventEmitter
  ) {
    this.usageStore = usageStore;
    this.errorStore = errorStore;
    this.costCalculator = costCalculator;
    this.metricsCollector = metricsCollector;
    this.enabled = enabled;
    this.eventEmitter = eventEmitter;

    logger.info("Usage logger initialized", { enabled });
  }

  /**
   * Log a completed request (success or failure)
   * @param context - Request context
   * @param responseInfo - Response information
   */
  async logRequest(context: RequestContext, responseInfo: ResponseInfo): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      if (responseInfo.success) {
        await this.logUsage(context, responseInfo);
      } else {
        await this.logError(context, responseInfo);
      }
    } catch (error) {
      logger.error("Failed to log request", {
        requestId: context.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - logging failures shouldn't break requests
    }
  }

  /**
   * Log successful request usage
   */
  private async logUsage(context: RequestContext, responseInfo: ResponseInfo): Promise<void> {
    const endTime = Date.now();
    const durationMs = endTime - context.startTime;

    // Calculate provider-level metrics (measures provider performance only)
    let providerTtftMs: number | null = null;
    let providerTokensPerSecond: number | null = null;
    
    if (context.streaming && context.providerFirstTokenTime) {
      providerTtftMs = context.providerFirstTokenTime - context.startTime;
      
      if (responseInfo.usage) {
        const outputTokens = responseInfo.usage.outputTokens;
        const streamDuration = (endTime - context.providerFirstTokenTime) / 1000;
        if (streamDuration > 0 && outputTokens > 0) {
          providerTokensPerSecond = outputTokens / streamDuration;
        }
      }
    }

    // Calculate client-level metrics (includes Plexus transformation overhead)
    let clientTtftMs: number | null = null;
    let clientTokensPerSecond: number | null = null;
    
    if (responseInfo.usage) {
      const outputTokens = responseInfo.usage.outputTokens;
      
      if (context.streaming && context.clientFirstTokenTime) {
        clientTtftMs = context.clientFirstTokenTime - context.startTime;
        const streamDuration = (endTime - context.clientFirstTokenTime) / 1000;
        if (streamDuration > 0 && outputTokens > 0) {
          clientTokensPerSecond = outputTokens / streamDuration;
        }
      } else if (!context.streaming) {
        // For non-streaming: (output tokens) / (total request duration)
        const requestDuration = durationMs / 1000;
        if (requestDuration > 0 && outputTokens > 0) {
          clientTokensPerSecond = outputTokens / requestDuration;
          providerTokensPerSecond = clientTokensPerSecond; // Same for non-streaming
        }
      }
    }

    // Calculate transformation overhead
    let transformationOverheadMs: number | null = null;
    if (clientTtftMs !== null && providerTtftMs !== null) {
      transformationOverheadMs = clientTtftMs - providerTtftMs;
    }

    // Normalize usage
    const usage = {
      inputTokens: responseInfo.usage?.inputTokens || 0,
      outputTokens: responseInfo.usage?.outputTokens || 0,
      cacheReadTokens: responseInfo.usage?.cacheReadTokens || 0,
      cacheCreationTokens: responseInfo.usage?.cacheCreationTokens || 0,
      reasoningTokens: responseInfo.usage?.reasoningTokens || 0,
      totalTokens: 0,
    };
    usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens + usage.reasoningTokens;

    // Calculate cost
    const costResult = await this.costCalculator.calculateCost({
      model: context.actualModel || "",
      provider: context.actualProvider || "",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cacheReadTokens,
      reasoningTokens: usage.reasoningTokens,
    });

    // Create usage log entry
    const entry: UsageLogEntry = {
      id: context.id,
      timestamp: new Date().toISOString(),
      clientIp: context.clientIp,
      apiKey: context.apiKeyName,
      apiType: context.clientApiType,
      aliasUsed: context.aliasUsed || "",
      actualProvider: context.actualProvider || "",
      actualModel: context.actualModel || "",
      targetApiType: context.targetApiType || context.clientApiType,
      passthrough: context.passthrough || false,
      usage,
      cost: {
        inputCost: costResult.inputCost,
        outputCost: costResult.outputCost,
        cachedCost: costResult.cachedCost,
        reasoningCost: costResult.reasoningCost,
        totalCost: costResult.totalCost,
        currency: "USD",
        source: costResult.source,
      },
      metrics: {
        durationMs,
        providerTtftMs,
        providerTokensPerSecond,
        clientTtftMs,
        clientTokensPerSecond,
        transformationOverheadMs,
      },
      success: true,
      streaming: responseInfo.streaming,
      pending: usage.totalTokens === 0, // Mark as pending if tokens are 0 (initial streaming log)
    };

    // Store usage log
    await this.usageStore.log(entry);

    // Store streaming context for later update
    if (context.streaming && usage.totalTokens === 0) {
      this.streamingContexts.set(context.id, context);
    } else {
      // Clean up streaming context if this is the final log
      this.streamingContexts.delete(context.id);
    }

    // Record metrics (use provider-level metrics for fair comparison)
    const requestMetrics: RequestMetrics = {
      provider: context.actualProvider || "",
      timestamp: context.startTime,
      success: true,
      latencyMs: durationMs,
      ttftMs: providerTtftMs,
      tokensPerSecond: providerTokensPerSecond,
      costPer1M: usage.totalTokens > 0 ? (costResult.totalCost / usage.totalTokens) * 1_000_000 : 0,
    };
    this.metricsCollector.recordRequest(requestMetrics);

    // Emit event
if (this.eventEmitter) {
        this.eventEmitter.emitEvent("usage", entry);
      }

    logger.debug("Usage logged", {
      requestId: context.id,
      provider: context.actualProvider,
      model: context.actualModel,
      totalTokens: usage.totalTokens,
      totalCost: costResult.totalCost,
      durationMs,
    });
  }

  /**
   * Log failed request
   */
  private async logError(context: RequestContext, responseInfo: ResponseInfo): Promise<void> {
    const errorEntry: ErrorLogEntry = {
      id: context.id,
      timestamp: new Date().toISOString(),
      clientIp: context.clientIp,
      apiKey: context.apiKeyName,
      apiType: context.clientApiType,
      requestedModel: context.aliasUsed || "",
      provider: context.actualProvider,
      model: context.actualModel,
      errorType: responseInfo.errorType || "unknown",
      errorMessage: responseInfo.errorMessage || "Unknown error",
      httpStatus: responseInfo.httpStatus,
    };

    // Store error log
    await this.errorStore.log(errorEntry);

    // Record metrics (as failed request)
    if (context.actualProvider) {
      const endTime = Date.now();
      const durationMs = endTime - context.startTime;

      const requestMetrics: RequestMetrics = {
        provider: context.actualProvider,
        timestamp: context.startTime,
        success: false,
        latencyMs: durationMs,
        ttftMs: null,
        tokensPerSecond: null,
        costPer1M: 0,
      };
      this.metricsCollector.recordRequest(requestMetrics);
    }

    logger.debug("Error logged", {
      requestId: context.id,
      provider: context.actualProvider,
      errorType: errorEntry.errorType,
      errorMessage: errorEntry.errorMessage,
    });
  }

  /**
   * Update request context with first token time (for streaming)
   * @param context - Request context
   * @param type - Whether this is provider or client first token
   */
  markFirstToken(context: RequestContext, type: "provider" | "client" = "provider"): void {
    const now = Date.now();
    if (type === "provider" && !context.providerFirstTokenTime) {
      context.providerFirstTokenTime = now;
    } else if (type === "client" && !context.clientFirstTokenTime) {
      context.clientFirstTokenTime = now;
    }
  }

  /**
   * Update usage information for a streaming request from reconstructed response
   * This is called by DebugLogger after it reconstructs the response from stream chunks
   * @param requestId - Request ID
   * @param unifiedUsage - Unified usage object from parseUsage()
   */
  async updateUsageFromReconstructed(requestId: string, unifiedUsage: any): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      // First, get the existing usage log entry
      const existingEntry = await this.usageStore.getById(requestId);
      
      if (!existingEntry) {
        logger.warn("Cannot update usage - entry not found", { requestId });
        return;
      }

      // Get the stored streaming context to access timing information
      const context = this.streamingContexts.get(requestId);
      if (!context) {
        logger.warn("Cannot update metrics - streaming context not found", { requestId });
        // Continue anyway to at least update usage and cost
      }

      // Build updated usage object
      const usage = {
        inputTokens: unifiedUsage.input_tokens || 0,
        outputTokens: unifiedUsage.output_tokens || 0,
        cacheReadTokens: unifiedUsage.cache_read_tokens || 0,
        cacheCreationTokens: unifiedUsage.cache_creation_tokens || 0,
        reasoningTokens: unifiedUsage.reasoning_tokens || 0,
        totalTokens: 0,
      };
      usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens + usage.reasoningTokens;

      // Recalculate cost with updated token counts
      const costResult = await this.costCalculator.calculateCost({
        model: existingEntry.actualModel,
        provider: existingEntry.actualProvider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cacheReadTokens,
        reasoningTokens: usage.reasoningTokens,
      });

      const cost = {
        inputCost: costResult.inputCost,
        outputCost: costResult.outputCost,
        cachedCost: costResult.cachedCost,
        reasoningCost: costResult.reasoningCost,
        totalCost: costResult.totalCost,
        currency: "USD" as const,
        source: costResult.source,
      };

      // Recalculate metrics with timing information from context
      let metrics = existingEntry.metrics; // Default to existing metrics
      
      if (context) {
        const endTime = Date.now();
        const durationMs = endTime - context.startTime;

        // Calculate provider-level metrics
        let providerTtftMs: number | null = null;
        let providerTokensPerSecond: number | null = null;
        
        if (context.providerFirstTokenTime) {
          providerTtftMs = context.providerFirstTokenTime - context.startTime;
          const streamDuration = (endTime - context.providerFirstTokenTime) / 1000;
          if (streamDuration > 0 && usage.outputTokens > 0) {
            providerTokensPerSecond = usage.outputTokens / streamDuration;
          }
        }

        // Calculate client-level metrics
        let clientTtftMs: number | null = null;
        let clientTokensPerSecond: number | null = null;
        
        if (context.clientFirstTokenTime) {
          clientTtftMs = context.clientFirstTokenTime - context.startTime;
          const streamDuration = (endTime - context.clientFirstTokenTime) / 1000;
          if (streamDuration > 0 && usage.outputTokens > 0) {
            clientTokensPerSecond = usage.outputTokens / streamDuration;
          }
        }

        // Calculate transformation overhead
        let transformationOverheadMs: number | null = null;
        if (clientTtftMs !== null && providerTtftMs !== null) {
          transformationOverheadMs = clientTtftMs - providerTtftMs;
        }

        metrics = {
          durationMs,
          providerTtftMs,
          providerTokensPerSecond,
          clientTtftMs,
          clientTokensPerSecond,
          transformationOverheadMs,
        };
      }

      // Update the usage store with usage, cost, AND metrics
      const updated = await this.usageStore.updateUsageWithMetrics(requestId, usage, cost, metrics);

      if (updated) {
        // Clean up streaming context
        this.streamingContexts.delete(requestId);
        
        logger.info("Updated usage log from reconstructed stream response", {
          requestId,
          totalTokens: usage.totalTokens,
          totalCost: cost.totalCost,
        });

        // Emit event for updated usage
        if (this.eventEmitter) {
          const updatedEntry = {
            ...existingEntry,
            usage,
            cost,
            pending: false, // Request is no longer pending
            updated: true // Flag to indicate this was an update
          };
          this.eventEmitter.emitEvent("usage", updatedEntry);
        }
      }
    } catch (error) {
      logger.error("Failed to update usage from reconstructed response", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - this shouldn't break the debug logging flow
    }
  }
}