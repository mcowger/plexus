import type { PricingConfig, PriceLookup, CostResult, SimplePricing, TieredPricing } from "../types/pricing";
import type { PricingConfigType } from "../types/config";
import { logger } from "../utils/logger";

/**
 * Service for calculating request costs based on pricing configuration
 */
export class CostCalculator {
  private config: PricingConfig | undefined;
  private openRouterCache: Map<string, { pricing: SimplePricing; timestamp: number }>;
  private cacheRefreshMs: number;
  private estimatedFallback: SimplePricing = {
    inputPer1M: 1.0,
    outputPer1M: 3.0,
    cachedPer1M: 0.5,
    reasoningPer1M: 2.0,
  };

  constructor(config?: PricingConfigType) {
    this.config = config as PricingConfig | undefined;
    this.openRouterCache = new Map();
    this.cacheRefreshMs = (config?.openrouter?.cacheRefreshMinutes || 60) * 60 * 1000;

    logger.info("Cost calculator initialized", {
      modelsConfigured: Object.keys(config?.models || {}).length,
      openRouterEnabled: config?.openrouter?.enabled || false,
    });
  }

  /**
   * Calculate cost for a request
   * @param lookup - Parameters for cost lookup
   * @returns Cost breakdown
   */
  async calculateCost(lookup: PriceLookup): Promise<CostResult> {
    const pricing = await this.getPricing(lookup.model, lookup.provider, lookup.inputTokens);

    if (!pricing) {
      // Use fallback estimation
      return this.calculateWithPricing(
        this.estimatedFallback,
        lookup,
        "estimated",
        1.0
      );
    }

    // Get discount factor
    const discount = this.getDiscountFactor(lookup.provider);

    return this.calculateWithPricing(
      pricing.pricing,
      lookup,
      pricing.source,
      discount
    );
  }

  /**
   * Get pricing for a model, with fallback chain:
   * 1. Model-specific config pricing
   * 2. Tiered pricing (based on input tokens)
   * 3. OpenRouter API (if enabled)
   * 4. null (will use estimation)
   */
  private async getPricing(
    model: string,
    provider: string,
    inputTokens: number
  ): Promise<{ pricing: SimplePricing; source: "config" | "openrouter" } | null> {
    // 1. Check model-specific config pricing
    if (this.config?.models?.[model]) {
      return {
        pricing: this.config.models[model],
        source: "config",
      };
    }

    // 2. Check tiered pricing
    if (this.config?.tiered?.[model]) {
      const tiers = this.config.tiered[model];
      const tier = this.getTierForTokens(tiers, inputTokens);
      if (tier) {
        return {
          pricing: {
            inputPer1M: tier.inputPer1M,
            outputPer1M: tier.outputPer1M,
            cachedPer1M: tier.cachedPer1M,
          },
          source: "config",
        };
      }
    }

    // 3. Query OpenRouter (if enabled)
    if (this.config?.openrouter?.enabled) {
      const openRouterPricing = await this.queryOpenRouter(model);
      if (openRouterPricing) {
        return {
          pricing: openRouterPricing,
          source: "openrouter",
        };
      }
    }

    // 4. Return null - caller will use estimation
    return null;
  }

  /**
   * Get the appropriate tier for given input tokens
   */
  private getTierForTokens(tiers: TieredPricing[], inputTokens: number): TieredPricing | null {
    // Tiers should be sorted by maxInputTokens ascending
    for (const tier of tiers) {
      if (inputTokens <= tier.maxInputTokens) {
        return tier;
      }
    }
    // If exceeded all tiers, use the last one
    return tiers[tiers.length - 1] || null;
  }

  /**
   * Query OpenRouter API for model pricing
   * Caches results based on cacheRefreshMinutes
   */
  private async queryOpenRouter(model: string): Promise<SimplePricing | null> {
    try {
      // Check cache first
      const cached = this.openRouterCache.get(model);
      if (cached && Date.now() - cached.timestamp < this.cacheRefreshMs) {
        logger.debug("Using cached OpenRouter pricing", { model });
        return cached.pricing;
      }

      logger.debug("Querying OpenRouter for pricing", { model });
      
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) {
        throw new Error(`OpenRouter API returned ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { data: any[] };
      const models = data.data;
      const modelInfo = models.find((m: any) => m.id === model);

      if (!modelInfo || !modelInfo.pricing) {
        return null;
      }

      // OpenRouter pricing is per token, we convert to per 1M tokens
      const pricing: SimplePricing = {
        inputPer1M: parseFloat(modelInfo.pricing.prompt) * 1_000_000,
        outputPer1M: parseFloat(modelInfo.pricing.completion) * 1_000_000,
        // OpenRouter doesn't strictly separate cached/reasoning in the same way everywhere,
        // but we can map if available or default to 0/undefined
      };

      // Cache the result
      this.openRouterCache.set(model, {
        pricing,
        timestamp: Date.now(),
      });

      return pricing;
    } catch (error) {
      logger.warn("Failed to query OpenRouter pricing", {
        model,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get discount factor for a provider
   * @param provider - Provider name
   * @returns Discount multiplier (1.0 = no discount, 0.85 = 15% discount)
   */
  private getDiscountFactor(provider: string): number {
    if (this.config?.discounts?.[provider]) {
      return this.config.discounts[provider];
    }
    return 1.0; // No discount
  }

  /**
   * Calculate cost using specific pricing
   */
  private calculateWithPricing(
    pricing: SimplePricing,
    lookup: PriceLookup,
    source: "config" | "openrouter" | "estimated",
    discount: number
  ): CostResult {
    // Calculate per-token-type costs
    const inputCost = (lookup.inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (lookup.outputTokens / 1_000_000) * pricing.outputPer1M;

    let cachedCost = 0;
    if (lookup.cachedTokens && pricing.cachedPer1M) {
      cachedCost = (lookup.cachedTokens / 1_000_000) * pricing.cachedPer1M;
    }

    let reasoningCost = 0;
    if (lookup.reasoningTokens && pricing.reasoningPer1M) {
      reasoningCost = (lookup.reasoningTokens / 1_000_000) * pricing.reasoningPer1M;
    }

    // Apply discount
    const totalCost = (inputCost + outputCost + cachedCost + reasoningCost) * discount;

    return {
      inputCost: inputCost * discount,
      outputCost: outputCost * discount,
      cachedCost: cachedCost * discount,
      reasoningCost: reasoningCost * discount,
      totalCost,
      source,
      discount,
    };
  }

  /**
   * Get estimated cost per 1M tokens for a provider/model
   * Used by cost-based selector
   */
  async getEstimatedCostPer1M(model: string, provider: string): Promise<number> {
    const pricing = await this.getPricing(model, provider, 0);

    if (!pricing) {
      // Return estimated average
      return (this.estimatedFallback.inputPer1M + this.estimatedFallback.outputPer1M) / 2;
    }

    // Return average of input and output costs
    const discount = this.getDiscountFactor(provider);
    return ((pricing.pricing.inputPer1M + pricing.pricing.outputPer1M) / 2) * discount;
  }

  /**
   * Update pricing configuration
   */
  updateConfig(config?: PricingConfigType): void {
    this.config = config as PricingConfig | undefined;
    this.cacheRefreshMs = (config?.openrouter?.cacheRefreshMinutes || 60) * 60 * 1000;

    logger.info("Cost calculator config updated", {
      modelsConfigured: Object.keys(config?.models || {}).length,
      openRouterEnabled: config?.openrouter?.enabled || false,
    });
  }
}
