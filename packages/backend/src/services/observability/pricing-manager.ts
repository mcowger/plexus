import {
  ModelMetadataManager,
  type NormalizedModelMetadata,
} from '../models/model-metadata-manager';

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

/**
 * Pricing-focused read facade over the shared model metadata catalog.
 *
 * Stateless: all reads delegate to ModelMetadataManager's OpenRouter map, which
 * is loaded at startup and refreshed on a schedule (plus manual refresh via
 * POST /v0/management/models/metadata/refresh). Pricing consumers therefore
 * see catalog updates without a restart.
 */
export class PricingManager {
  private static instance: PricingManager;

  private constructor() {}

  public static getInstance(): PricingManager {
    if (!PricingManager.instance) {
      PricingManager.instance = new PricingManager();
    }
    return PricingManager.instance;
  }

  private get metadataManager(): ModelMetadataManager {
    return ModelMetadataManager.getInstance();
  }

  public getPricing(slug: string): OpenRouterPricing | undefined {
    const pricing: NormalizedModelMetadata['pricing'] = this.metadataManager.getMetadata(
      'openrouter',
      slug
    )?.pricing;
    return pricing as OpenRouterPricing | undefined;
  }

  public isInitialized(): boolean {
    return this.metadataManager.isInitialized('openrouter');
  }

  public getAllModelSlugs(): string[] {
    return this.metadataManager.getAllIds('openrouter');
  }

  public searchModelSlugs(query: string): string[] {
    if (!query) {
      return this.getAllModelSlugs();
    }
    const lowerQuery = query.toLowerCase();
    return this.getAllModelSlugs()
      .filter((slug) => slug.toLowerCase().includes(lowerQuery))
      .sort((a, b) => {
        // Prioritize matches that start with the query
        const aStarts = a.toLowerCase().startsWith(lowerQuery);
        const bStarts = b.toLowerCase().startsWith(lowerQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });
  }
}
