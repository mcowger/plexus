import { UsageRecord } from '../types/usage';
import { PricingManager } from '../services/pricing-manager';

export function calculateCosts(usageRecord: Partial<UsageRecord>, pricing: any, providerDiscount?: number) {
    const inputTokens = usageRecord.tokensInput || 0;
    const outputTokens = usageRecord.tokensOutput || 0;
    const cachedTokens = usageRecord.tokensCached || 0;

    let inputCost = 0;
    let outputCost = 0;
    let cachedCost = 0;
    let calculated = false;

    // Default to 'default' source with 0-cost metadata
    usageRecord.costSource = 'default';
    usageRecord.costMetadata = JSON.stringify({ input: 0, output: 0, cached: 0 });

    if (!pricing) return;

    if (pricing.source === 'simple') {
        inputCost = (inputTokens / 1_000_000) * pricing.input;
        outputCost = (outputTokens / 1_000_000) * pricing.output;
        cachedCost = (cachedTokens / 1_000_000) * (pricing.cached || 0);
        calculated = true;
        
        usageRecord.costSource = 'simple';
        usageRecord.costMetadata = JSON.stringify(pricing);
    } else if (pricing.source === 'defined' && Array.isArray(pricing.range)) {
        const match = pricing.range.find((r: any) => {
            const lower = r.lower_bound ?? 0;
            const upper = r.upper_bound ?? Infinity;
            return inputTokens >= lower && inputTokens <= upper;
        });

        if (match) {
            inputCost = (inputTokens / 1_000_000) * match.input_per_m;
            outputCost = (outputTokens / 1_000_000) * match.output_per_m;
            calculated = true;
            
            usageRecord.costSource = 'defined';
            usageRecord.costMetadata = JSON.stringify({
                source: 'defined',
                input: match.input_per_m,
                output: match.output_per_m,
                range: match
            });
        }
    } else if (pricing.source === 'openrouter' && pricing.slug) {
        const openRouterPricing = PricingManager.getInstance().getPricing(pricing.slug);
        if (openRouterPricing) {
            // OpenRouter pricing is per token (strings)
            const promptRate = parseFloat(openRouterPricing.prompt) || 0;
            const completionRate = parseFloat(openRouterPricing.completion) || 0;
            const cacheReadRate = parseFloat(openRouterPricing.input_cache_read || '0') || 0;

            inputCost = inputTokens * promptRate;
            outputCost = outputTokens * completionRate;
            cachedCost = cachedTokens * cacheReadRate;

            const effectiveDiscount = pricing.discount ?? providerDiscount;

            if (effectiveDiscount) {
                const multiplier = 1 - effectiveDiscount;
                inputCost *= multiplier;
                outputCost *= multiplier;
                cachedCost *= multiplier;
            }

            calculated = true;
            
            usageRecord.costSource = 'openrouter';
            usageRecord.costMetadata = JSON.stringify({
                slug: pricing.slug,
                prompt: promptRate,
                completion: completionRate,
                input_cache_read: cacheReadRate,
                discount: effectiveDiscount
            });
        }
    }

    if (calculated) {
        usageRecord.costInput = Number(inputCost.toFixed(8));
        usageRecord.costOutput = Number(outputCost.toFixed(8));
        usageRecord.costCached = Number(cachedCost.toFixed(8));
        usageRecord.costTotal = Number((inputCost + outputCost + cachedCost).toFixed(8));
    }
}