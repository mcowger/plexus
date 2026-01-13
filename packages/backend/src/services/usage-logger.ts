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
  firstTokenTime?: number; // Unix timestamp in ms
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

    // Calculate TTFT if streaming
    let ttftMs: number | null = null;
    if (context.streaming && context.firstTokenTime) {
      ttftMs = context.firstTokenTime - context.startTime;
    }

    // Calculate tokens per second if streaming
    let tokensPerSecond: number | null = null;
    if (context.streaming && responseInfo.usage) {
      const outputTokens = responseInfo.usage.outputTokens;
      const streamDuration = (endTime - (context.firstTokenTime || context.startTime)) / 1000;
      if (streamDuration > 0) {
        tokensPerSecond = outputTokens / streamDuration;
      }
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
        ttftMs,
        tokensPerSecond,
      },
      success: true,
      streaming: responseInfo.streaming,
    };

    // Store usage log
    await this.usageStore.log(entry);

    // Record metrics
    const requestMetrics: RequestMetrics = {
      provider: context.actualProvider || "",
      timestamp: context.startTime,
      success: true,
      latencyMs: durationMs,
      ttftMs,
      tokensPerSecond,
      costPer1M: usage.totalTokens > 0 ? (costResult.totalCost / usage.totalTokens) * 1_000_000 : 0,
    };
    this.metricsCollector.recordRequest(requestMetrics);

    // Emit event
    if (this.eventEmitter) {
      this.eventEmitter.emitEvent("usage", {
        requestId: entry.id,
        alias: entry.aliasUsed,
        provider: entry.actualProvider,
        model: entry.actualModel,
        success: true,
        tokens: entry.usage.totalTokens,
        cost: entry.cost.totalCost,
        duration: entry.metrics.durationMs
      });
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
   */
  markFirstToken(context: RequestContext): void {
    if (!context.firstTokenTime) {
      context.firstTokenTime = Date.now();
    }
  }
}