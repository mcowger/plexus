import type { ProviderMetrics, RequestMetrics } from "../types/metrics";
import { logger } from "../utils/logger";

/**
 * Service for collecting and aggregating performance metrics
 * Maintains a rolling time window of metrics per provider
 */
export class MetricsCollector {
  private windowMinutes: number;
  private metrics: Map<string, RequestMetrics[]>;

  constructor(windowMinutes: number = 5) {
    this.windowMinutes = windowMinutes;
    this.metrics = new Map();

    logger.info("Metrics collector initialized", { windowMinutes });
  }

  /**
   * Record metrics for a completed request
   * @param metrics - Request metrics to record
   */
  recordRequest(metrics: RequestMetrics): void {
    const providerMetrics = this.metrics.get(metrics.provider) || [];
    providerMetrics.push(metrics);
    this.metrics.set(metrics.provider, providerMetrics);

    // Clean up old metrics outside the window
    this.cleanupOldMetrics();

    logger.debug("Request metrics recorded", {
      provider: metrics.provider,
      latencyMs: metrics.latencyMs,
      success: metrics.success,
    });
  }

  /**
   * Get aggregated metrics for a provider
   * @param provider - Provider name
   * @returns Aggregated provider metrics or null if no data
   */
  getProviderMetrics(provider: string): ProviderMetrics | null {
    const providerMetrics = this.metrics.get(provider);
    if (!providerMetrics || providerMetrics.length === 0) {
      return null;
    }

    const now = Date.now();
    const windowStart = now - this.windowMinutes * 60 * 1000;

    // Filter to metrics within window
    const recentMetrics = providerMetrics.filter((m) => m.timestamp >= windowStart);

    if (recentMetrics.length === 0) {
      return null;
    }

    // Calculate aggregates
    const totalRequests = recentMetrics.length;
    const successfulRequests = recentMetrics.filter((m) => m.success).length;
    const successRate = successfulRequests / totalRequests;

    // Latency metrics
    const latencies = recentMetrics.map((m) => m.latencyMs);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const p50Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] ?? 0;
    const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] ?? 0;

    // TTFT metrics (only for streaming requests)
    const ttfts = recentMetrics.filter((m) => m.ttftMs !== null).map((m) => m.ttftMs!);
    const avgTtft = ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0;

    // Throughput metrics (only for streaming requests)
    const throughputs = recentMetrics
      .filter((m) => m.tokensPerSecond !== null)
      .map((m) => m.tokensPerSecond!);
    const avgThroughput =
      throughputs.length > 0 ? throughputs.reduce((a, b) => a + b, 0) / throughputs.length : 0;

    // Cost metrics
    const costs = recentMetrics.map((m) => m.costPer1M);
    const avgCostPer1M = costs.reduce((a, b) => a + b, 0) / costs.length;

    return {
      provider,
      period: {
        start: windowStart,
        end: now,
      },
      requests: totalRequests,
      successRate,
      avgLatency,
      p50Latency,
      p95Latency,
      avgTtft,
      avgThroughput,
      avgCostPer1M,
    };
  }

  /**
   * Get average latency for a provider
   * Used by latency-based selector
   * @param provider - Provider name
   * @returns Average latency in ms, or null if no data
   */
  getProviderLatency(provider: string): number | null {
    const metrics = this.getProviderMetrics(provider);
    return metrics?.avgLatency || null;
  }

  /**
   * Get average cost per 1M tokens for a provider
   * Used by cost-based selector
   * @param provider - Provider name
   * @returns Average cost per 1M tokens, or null if no data
   */
  getProviderCost(provider: string): number | null {
    const metrics = this.getProviderMetrics(provider);
    return metrics?.avgCostPer1M || null;
  }

  /**
   * Get composite performance score for a provider
   * Score = throughput / (latency * cost)
   * Higher is better
   * @param provider - Provider name
   * @returns Performance score, or null if no data
   */
  getProviderPerformance(provider: string): number | null {
    const metrics = this.getProviderMetrics(provider);
    if (!metrics) {
      return null;
    }

    // Avoid division by zero
    if (metrics.avgLatency === 0 || metrics.avgCostPer1M === 0) {
      return null;
    }

    // If no throughput data, use latency and cost only
    if (metrics.avgThroughput === 0) {
      // Lower latency and cost is better, so invert
      return 1000 / (metrics.avgLatency * metrics.avgCostPer1M);
    }

    // Full composite score: throughput / (latency * cost)
    return metrics.avgThroughput / (metrics.avgLatency * metrics.avgCostPer1M);
  }

  /**
   * Get all provider metrics
   * @returns Map of provider name to aggregated metrics
   */
  getAllMetrics(): Map<string, ProviderMetrics> {
    const result = new Map<string, ProviderMetrics>();

    for (const provider of this.metrics.keys()) {
      const metrics = this.getProviderMetrics(provider);
      if (metrics) {
        result.set(provider, metrics);
      }
    }

    return result;
  }

  /**
   * Clean up metrics outside the rolling window
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    const windowStart = now - this.windowMinutes * 60 * 1000;

    for (const [provider, providerMetrics] of this.metrics.entries()) {
      const recentMetrics = providerMetrics.filter((m) => m.timestamp >= windowStart);
      
      if (recentMetrics.length === 0) {
        // Remove provider if no recent metrics
        this.metrics.delete(provider);
      } else {
        this.metrics.set(provider, recentMetrics);
      }
    }
  }

  /**
   * Clear all metrics
   * Useful for testing
   */
  clear(): void {
    this.metrics.clear();
    logger.debug("Metrics cleared");
  }
}
