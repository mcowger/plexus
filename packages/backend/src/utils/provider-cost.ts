import { logger } from './logger';
import { UsageRecord } from '../types/usage';

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
