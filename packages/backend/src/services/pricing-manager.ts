import { logger } from '../utils/logger';

interface OpenRouterPricing {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
    web_search?: string;
    internal_reasoning?: string;
    input_cache_read?: string;
    input_cache_write?: string;
}

interface OpenRouterModel {
    id: string;
    pricing: OpenRouterPricing;
}

interface OpenRouterResponse {
    data: OpenRouterModel[];
}

export class PricingManager {
    private static instance: PricingManager;
    private pricingMap: Map<string, OpenRouterPricing> = new Map();
    private initialized = false;

    private constructor() {}

    public static getInstance(): PricingManager {
        if (!PricingManager.instance) {
            PricingManager.instance = new PricingManager();
        }
        return PricingManager.instance;
    }

    public async loadPricing(source: string = 'https://openrouter.ai/api/v1/models'): Promise<void> {
        try {
            logger.info(`Loading pricing data from ${source}`);
            let data: OpenRouterResponse;

            if (source.startsWith('http')) {
                const response = await fetch(source);
                if (!response.ok) {
                    throw new Error(`Failed to fetch pricing data: ${response.statusText}`);
                }
                data = await response.json() as OpenRouterResponse;
            } else {
                // Assume file path for testing
                const file = Bun.file(source);
                if (!(await file.exists())) {
                    throw new Error(`Pricing file not found at ${source}`);
                }
                data = await file.json() as OpenRouterResponse;
            }

            this.pricingMap.clear();
            if (data && Array.isArray(data.data)) {
                for (const model of data.data) {
                    this.pricingMap.set(model.id, model.pricing);
                }
                logger.info(`Loaded pricing for ${this.pricingMap.size} models`);
                this.initialized = true;
            } else {
                logger.warn('Invalid pricing data format');
            }
        } catch (error) {
            logger.error('Error loading pricing data', error);
            // Don't throw, just log error so app can continue without openrouter pricing
        }
    }

    public getPricing(slug: string): OpenRouterPricing | undefined {
        return this.pricingMap.get(slug);
    }

    public isInitialized(): boolean {
        return this.initialized;
    }
}
