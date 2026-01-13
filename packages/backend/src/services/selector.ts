import type {
  TargetWithProvider,
  SelectionContext,
  SelectorStrategy,
} from "../types/routing";
import { logger } from "../utils/logger";
import type { CostCalculator } from "./cost-calculator";
import type { MetricsCollector } from "./metrics-collector";

/**
 * Selects a target from a list of available targets based on strategy
 */
export class TargetSelector {
  private costCalculator?: CostCalculator;
  private metricsCollector?: MetricsCollector;

  /**
   * Initialize selector with optional dependencies for advanced strategies
   * @param costCalculator - Cost calculator for cost-based selection
   * @param metricsCollector - Metrics collector for latency/performance selection
   */
  constructor(
    costCalculator?: CostCalculator,
    metricsCollector?: MetricsCollector
  ) {
    this.costCalculator = costCalculator;
    this.metricsCollector = metricsCollector;
  }

  /**
   * Selects a target using the specified strategy
   * @param targets - Available targets to choose from
   * @param strategy - Selection strategy to use
   * @param context - Additional context for selection
   * @returns Selected target or null if no target available
   */
  select(
    targets: TargetWithProvider[],
    strategy: SelectorStrategy,
    context: SelectionContext = {}
  ): TargetWithProvider | null {
    if (targets.length === 0) {
      logger.debug("Selector called with no targets");
      return null;
    }

    logger.debug(`Selecting target`, {
      strategy,
      targetsCount: targets.length,
      context,
    });

    switch (strategy) {
      case "random":
        return this.selectRandom(targets);
      case "in_order":
        return this.selectInOrder(targets, context);
      case "cost":
        return this.selectByCost(targets);
      case "latency":
        return this.selectByLatency(targets);
      case "performance":
        return this.selectByPerformance(targets);
      default:
        // Fallback to random
        logger.warn(`Unknown strategy '${strategy}', falling back to random`);
        return this.selectRandom(targets);
    }
  }

  /**
   * Random selection with optional weighting
   * If no weights specified, uses uniform distribution
   * If weights specified, uses weighted random selection
   */
  private selectRandom(targets: TargetWithProvider[]): TargetWithProvider {
    // Check if any targets have weights
    const hasWeights = targets.some((t) => t.weight !== undefined);

    if (!hasWeights) {
      // Uniform random selection
      const randomIndex = Math.floor(Math.random() * targets.length);
      const selected = targets[randomIndex]!;
      logger.debug("Selected random target (uniform)", {
        provider: selected.provider,
        model: selected.model,
      });
      return selected;
    }

    // Weighted random selection
    // Normalize weights (default to 1 if not specified)
    const weights = targets.map((t) => t.weight ?? 1);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    // Generate random number between 0 and totalWeight
    const random = Math.random() * totalWeight;

    // Find the target corresponding to this random value
    let cumulativeWeight = 0;
    for (let i = 0; i < targets.length; i++) {
      cumulativeWeight += weights[i]!;
      if (random < cumulativeWeight) {
        const selected = targets[i]!;
        logger.debug("Selected random target (weighted)", {
          provider: selected.provider,
          model: selected.model,
          weight: weights[i],
          totalWeight,
        });
        return selected;
      }
    }

    // Fallback (should never reach here, but needed for type safety)
    const fallback = targets[targets.length - 1]!;
    logger.debug("Selected random target (fallback)", {
      provider: fallback.provider,
      model: fallback.model,
    });
    return fallback;
  }

  /**
   * In-order selection (tries targets sequentially)
   * Used for fallback/failover patterns
   * Respects previousAttempts in context to skip already-tried targets
   */
  private selectInOrder(
    targets: TargetWithProvider[],
    context: SelectionContext
  ): TargetWithProvider {
    const previousAttempts = context.previousAttempts || [];

    // Find first target not yet attempted
    for (let i = 0; i < targets.length; i++) {
      if (!previousAttempts.includes(i)) {
        const selected = targets[i]!;
        logger.debug("Selected in-order target", {
          provider: selected.provider,
          model: selected.model,
          index: i,
          previousAttempts,
        });
        return selected;
      }
    }

    // All targets attempted, return first one
    const fallback = targets[0]!;
    logger.debug("All targets attempted, returning first one (in-order)", {
      provider: fallback.provider,
      model: fallback.model,
    });
    return fallback;
  }

  /**
   * Cost-based selection (selects cheapest provider)
   * Falls back to random if no cost data available
   */
  private selectByCost(targets: TargetWithProvider[]): TargetWithProvider {
    // We currently rely on metricsCollector for synchronous cost data
    if (!this.metricsCollector) {
      logger.debug(
        "No metrics collector available for cost data, falling back to random"
      );
      return this.selectRandom(targets);
    }

    // Since we can't use async in select, we need to handle this synchronously
    // For now, use metrics collector's cached cost data if available
    const targetCosts = targets.map((target) => {
      const cost = this.metricsCollector?.getProviderCost(
        target.providerConfig.name
      );
      return { target, cost };
    });

    // Filter out targets without cost data
    const targetsWithCosts = targetCosts.filter((tc) => tc.cost !== null);

    if (targetsWithCosts.length === 0) {
      // No cost data available, fall back to random
      logger.debug("No cost data available for targets, falling back to random");
      return this.selectRandom(targets);
    }

    // Select target with lowest cost
    const cheapest = targetsWithCosts.reduce((min, current) =>
      current.cost! < min.cost! ? current : min
    );

    logger.debug("Selected cheapest target", {
      provider: cheapest.target.provider,
      model: cheapest.target.model,
      cost: cheapest.cost,
      candidatesCount: targetsWithCosts.length,
    });

    return cheapest.target;
  }

  /**
   * Latency-based selection (selects fastest provider)
   * Falls back to random if no latency data available
   */
  private selectByLatency(targets: TargetWithProvider[]): TargetWithProvider {
    if (!this.metricsCollector) {
      // No metrics collector available, fall back to random
      logger.debug("No metrics collector available, falling back to random");
      return this.selectRandom(targets);
    }

    // Get latency data for each target
    const targetLatencies = targets.map((target) => {
      const latency = this.metricsCollector!.getProviderLatency(
        target.providerConfig.name
      );
      return { target, latency };
    });

    // Filter out targets without latency data
    const targetsWithLatencies = targetLatencies.filter(
      (tl) => tl.latency !== null
    );

    if (targetsWithLatencies.length === 0) {
      // No latency data available, fall back to random
      logger.debug(
        "No latency data available for targets, falling back to random"
      );
      return this.selectRandom(targets);
    }

    // Select target with lowest latency
    const fastest = targetsWithLatencies.reduce((min, current) =>
      current.latency! < min.latency! ? current : min
    );

    logger.debug("Selected fastest target", {
      provider: fastest.target.provider,
      model: fastest.target.model,
      latency: fastest.latency,
      candidatesCount: targetsWithLatencies.length,
    });

    return fastest.target;
  }

  /**
   * Performance-based selection (composite score)
   * Score = throughput / (latency * cost)
   * Falls back to random if no performance data available
   */
  private selectByPerformance(
    targets: TargetWithProvider[]
  ): TargetWithProvider {
    if (!this.metricsCollector) {
      // No metrics collector available, fall back to random
      logger.debug("No metrics collector available, falling back to random");
      return this.selectRandom(targets);
    }

    // Get performance scores for each target
    const targetScores = targets.map((target) => {
      const score = this.metricsCollector!.getProviderPerformance(
        target.providerConfig.name
      );
      return { target, score };
    });

    // Filter out targets without performance data
    const targetsWithScores = targetScores.filter((ts) => ts.score !== null);

    if (targetsWithScores.length === 0) {
      // No performance data available, fall back to random
      logger.debug(
        "No performance data available for targets, falling back to random"
      );
      return this.selectRandom(targets);
    }

    // Select target with highest performance score
    const best = targetsWithScores.reduce((max, current) =>
      current.score! > max.score! ? current : max
    );

    logger.debug("Selected best performing target", {
      provider: best.target.provider,
      model: best.target.model,
      score: best.score,
      candidatesCount: targetsWithScores.length,
    });

    return best.target;
  }
}