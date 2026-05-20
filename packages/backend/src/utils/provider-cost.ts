import { logger } from './logger';
import { UsageRecord } from '../types/usage';
import type { ProviderCostDetails } from './usage-normalizer';

/**
 * Apply provider-reported cost data, overriding calculated costs.
 *
 * Some providers emit actual cost information in SSE comment lines like:
 *   `: cost {"request_cost_usd": 0.000721, "cache_savings_usd": 0.0, ...}`
 *
 * When present, we trust the provider's actual cost over our calculations.
 */
export function applyProviderReportedCost(usageRecord: Partial<UsageRecord>, costData: any): void {
  const requestCostUsd = costData.request_cost_usd;
  if (typeof requestCostUsd !== 'number' || requestCostUsd < 0) return;

  const previousCostSource = usageRecord.costSource;
  const previousCostTotal = usageRecord.costTotal;

  usageRecord.costTotal = Number(requestCostUsd.toFixed(8));
  usageRecord.costSource = 'provider_reported';
  usageRecord.providerReportedCost = requestCostUsd;

  // Distribute the total cost proportionally to input/output/cached buckets
  // based on the previously calculated costs, or attribute entirely to input
  const inputCost = usageRecord.costInput || 0;
  const outputCost = usageRecord.costOutput || 0;
  const cachedCost = usageRecord.costCached || 0;
  const cacheWriteCost = usageRecord.costCacheWrite || 0;
  const totalCalc = inputCost + outputCost + cachedCost + cacheWriteCost;

  if (totalCalc > 0) {
    // Proportional distribution based on calculated cost ratios
    usageRecord.costInput = Number(((inputCost / totalCalc) * requestCostUsd).toFixed(8));
    usageRecord.costOutput = Number(((outputCost / totalCalc) * requestCostUsd).toFixed(8));
    usageRecord.costCached = Number(((cachedCost / totalCalc) * requestCostUsd).toFixed(8));
    usageRecord.costCacheWrite = Number(((cacheWriteCost / totalCalc) * requestCostUsd).toFixed(8));
  } else {
    // No breakdown available, attribute full cost to input
    usageRecord.costInput = Number(requestCostUsd.toFixed(8));
    usageRecord.costOutput = 0;
    usageRecord.costCached = 0;
    usageRecord.costCacheWrite = 0;
  }

  // Store the full provider cost payload in costMetadata for audit
  usageRecord.costMetadata = JSON.stringify({
    source: 'provider_reported',
    request_cost_usd: requestCostUsd,
    cache_savings_usd: costData.cache_savings_usd,
    allowance_remaining_usd: costData.allowance_remaining_usd,
    budget_remaining_usd: costData.budget_remaining_usd,
    previous_cost_source: previousCostSource,
    previous_cost_total: previousCostTotal,
  });

  logger.debug(
    `[ProviderCost] Provider-reported cost for ${usageRecord.requestId}: ` +
      `$${requestCostUsd} (overridden from calculated $${previousCostTotal})`
  );
}

/**
 * Apply provider-reported cost data from the usage.cost_details block.
 *
 * Some providers include detailed cost breakdowns directly in the response
 * usage object with fields like:
 *   - usage.cost / usage.estimated_cost — total cost
 *   - usage.cost_details.input_cost — prompt token cost
 *   - usage.cost_details.output_cost — completion token cost
 *   - usage.cost_details.cached_input_cost — cached token cost
 *   - usage.cost_details.cache_write_input_cost — cache write token cost
 *
 * When present, we trust the provider's actual cost over our calculations.
 * This is more accurate than the SSE `: cost` comment format because it
 * provides a per-bucket breakdown rather than just a total.
 */
export function applyUsageCostDetails(
  usageRecord: Partial<UsageRecord>,
  costDetails: ProviderCostDetails
): void {
  if (!costDetails || costDetails.total_cost === null) return;

  const previousCostSource = usageRecord.costSource;
  const previousCostTotal = usageRecord.costTotal;

  const totalCost = costDetails.total_cost;

  usageRecord.costTotal = Number(totalCost.toFixed(8));
  usageRecord.costSource = 'provider_reported';
  usageRecord.providerReportedCost = totalCost;

  // Three tiers of provider cost reporting:
  // 1. Superset: explicit per-bucket breakdown (input_cost, output_cost, cached_input_cost, cache_write_input_cost)
  // 2. Normal: upstream_inference_prompt_cost/completions_cost split, but no cache granularity
  // 3. Minimal: no breakdown at all — distribute proportionally from previously calculated costs

  const inputCost = costDetails.input_cost;
  const outputCost = costDetails.output_cost;
  const cachedCost = costDetails.cached_input_cost;
  const cacheWriteCost = costDetails.cache_write_input_cost;

  if (inputCost !== null || cachedCost !== null || cacheWriteCost !== null) {
    // Superset: provider gave us an explicit per-bucket breakdown — use it directly
    // Note: output_cost alone being non-null is not enough to identify superset;
    // it's also reported by normal-tier as upstream_inference_completions_cost.
    // Check the input-side fields (which normal-tier does not report separately).
    usageRecord.costInput = Number((inputCost ?? 0).toFixed(8));
    usageRecord.costOutput = Number((outputCost ?? 0).toFixed(8));
    usageRecord.costCached = Number((cachedCost ?? 0).toFixed(8));
    usageRecord.costCacheWrite = Number((cacheWriteCost ?? 0).toFixed(8));
  } else if (
    (costDetails.upstream_inference_prompt_cost != null &&
      costDetails.upstream_inference_prompt_cost > 0) ||
    (costDetails.upstream_inference_completions_cost != null &&
      costDetails.upstream_inference_completions_cost > 0)
  ) {
    // Normal: upstream gave us prompt vs completions split, but no cache granularity.
    // Use the upstream split for the input vs output totals, then preserve Plexus's
    // own calculated ratio within the prompt portion for cache/non-cache distribution.
    const promptTotal = costDetails.upstream_inference_prompt_cost ?? 0;
    const completionsTotal = costDetails.upstream_inference_completions_cost ?? 0;

    usageRecord.costOutput = Number((completionsTotal ?? 0).toFixed(8));

    // Split the prompt portion by Plexus's own input/cached/cacheWrite ratio
    const prevInput = usageRecord.costInput || 0;
    const prevCached = usageRecord.costCached || 0;
    const prevCacheWrite = usageRecord.costCacheWrite || 0;
    const prevPromptTotal = prevInput + prevCached + prevCacheWrite;

    if (prevPromptTotal > 0) {
      usageRecord.costInput = Number(((prevInput / prevPromptTotal) * promptTotal).toFixed(8));
      usageRecord.costCached = Number(((prevCached / prevPromptTotal) * promptTotal).toFixed(8));
      usageRecord.costCacheWrite = Number(((prevCacheWrite / prevPromptTotal) * promptTotal).toFixed(8));
    } else {
      // No prior breakdown — attribute full prompt cost to input
      usageRecord.costInput = Number(promptTotal.toFixed(8));
      usageRecord.costCached = 0;
      usageRecord.costCacheWrite = 0;
    }
  } else {
    // Minimal: no breakdown — distribute proportionally from previously calculated costs
    const prevInputCost = usageRecord.costInput || 0;
    const prevOutputCost = usageRecord.costOutput || 0;
    const prevCachedCost = usageRecord.costCached || 0;
    const prevCacheWriteCost = usageRecord.costCacheWrite || 0;
    const totalCalc = prevInputCost + prevOutputCost + prevCachedCost + prevCacheWriteCost;

    if (totalCalc > 0) {
      usageRecord.costInput = Number(((prevInputCost / totalCalc) * totalCost).toFixed(8));
      usageRecord.costOutput = Number(((prevOutputCost / totalCalc) * totalCost).toFixed(8));
      usageRecord.costCached = Number(((prevCachedCost / totalCalc) * totalCost).toFixed(8));
      usageRecord.costCacheWrite = Number(
        ((prevCacheWriteCost / totalCalc) * totalCost).toFixed(8)
      );
    } else {
      usageRecord.costInput = Number(totalCost.toFixed(8));
      usageRecord.costOutput = 0;
      usageRecord.costCached = 0;
      usageRecord.costCacheWrite = 0;
    }
  }

  // Store the full provider cost payload in costMetadata for audit
  usageRecord.costMetadata = JSON.stringify({
    source: 'provider_reported',
    cost_details: costDetails,
    previous_cost_source: previousCostSource,
    previous_cost_total: previousCostTotal,
  });

  logger.debug(
    `[ProviderCost] Provider-reported cost (usage.cost_details) for ${usageRecord.requestId}: ` +
      `$${totalCost} (overridden from ${previousCostSource} $${previousCostTotal})`
  );
}
