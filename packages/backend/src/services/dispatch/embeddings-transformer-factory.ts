import { GeminiEmbeddingsTransformer } from '../../transformers/embeddings/gemini';
import { OpenAIEmbeddingsTransformer } from '../../transformers/embeddings/openai';
import { EmbeddingsTransformer } from '../../types/embeddings-transformer';
import { logger } from '../../utils/logger';

/**
 * EmbeddingsTransformerFactory
 *
 * Factory for retrieving the correct embeddings transformer based on the provider's API type.
 * Supports 'gemini' (Google) and 'openai'/'chat' (OpenAI-compatible). Unknown types default to OpenAI format.
 */
export class EmbeddingsTransformerFactory {
  /**
   * Provider types with dedicated (non-OpenAI) embeddings transformers,
   * in priority order. Used by resolveTransformer to pick the best match.
   */
  static readonly DEDICATED_TYPES = ['gemini'] as const;

  /**
   * Resolve the best embeddings transformer for a provider based on its type list.
   * Checks dedicated types first (in priority order), then falls back to OpenAI format.
   */
  static resolveTransformer(providerTypes: string[]): EmbeddingsTransformer {
    const dedicated = providerTypes.find((t) =>
      (this.DEDICATED_TYPES as readonly string[]).includes(t.toLowerCase())
    );
    return this.getTransformer(dedicated ?? 'openai');
  }

  static getTransformer(providerType: string): EmbeddingsTransformer {
    switch (providerType.toLowerCase()) {
      case 'gemini':
        return new GeminiEmbeddingsTransformer();
      case 'openai':
      case 'chat':
      default:
        if (!['openai', 'chat'].includes(providerType.toLowerCase())) {
          logger.warn(
            `Unknown embeddings provider type '${providerType}', defaulting to OpenAI format`
          );
        }
        return new OpenAIEmbeddingsTransformer();
    }
  }
}
