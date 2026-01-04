import { Selector, EnrichedModelTarget } from './base';
import { ModelTarget } from '../../config';

function calculatePriceForTarget(pricing: any, inputTokens: number, outputTokens: number, cachedTokens: number = 0): number {
    if (!pricing) return 0;

    if (pricing.source === 'simple') {
        const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
        const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
        const cachedCost = pricing.cached ? (cachedTokens / 1_000_000) * pricing.cached : 0;
        return inputCost + outputCost + cachedCost;
    } else if (pricing.source === 'defined' && Array.isArray(pricing.range)) {
        const match = pricing.range.find((r: any) => {
            const lower = r.lower_bound ?? 0;
            const upper = r.upper_bound ?? Infinity;
            return inputTokens >= lower && inputTokens <= upper;
        });

        if (match) {
            const inputCost = (inputTokens / 1_000_000) * (match.input_per_m || 0);
            const outputCost = (outputTokens / 1_000_000) * (match.output_per_m || 0);
            return inputCost + outputCost;
        }
        return 0;
    } else if (pricing.source === 'openrouter' && pricing.slug) {
        const { PricingManager } = require('../../services/pricing-manager');
        const openRouterPricing = PricingManager.getInstance().getPricing(pricing.slug);
        if (openRouterPricing) {
            const promptRate = parseFloat(openRouterPricing.prompt) || 0;
            const completionRate = parseFloat(openRouterPricing.completion) || 0;
            return (inputTokens * promptRate) + (outputTokens * completionRate);
        }
        return 0;
    } else if (pricing.source === 'default') {
        const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
        const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
        return inputCost + outputCost;
    }

    return 0;
}

export class CostSelector extends Selector {
    select(targets: ModelTarget[]): ModelTarget | null {
        if (!targets || targets.length === 0) {
            return null;
        }

        // Use simulated token values for comparison
        const simulatedInputTokens = 1000;
        const simulatedOutputTokens = 500;

        let lowestCost = Infinity;
        let cheapestTarget: ModelTarget | null = null;

        for (const target of targets) {
            const enrichedTarget = target as EnrichedModelTarget; // Targets are enriched with route by Router
            const pricing = enrichedTarget.route?.modelConfig?.pricing;
            const cost = calculatePriceForTarget(pricing, simulatedInputTokens, simulatedOutputTokens);

            if (cost < lowestCost) {
                lowestCost = cost;
                cheapestTarget = target;
            }
        }

        return cheapestTarget;
    }
}
