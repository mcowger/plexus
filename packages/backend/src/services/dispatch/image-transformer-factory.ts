import { ImageTransformer } from '../../transformers/image';
import { CodexImageTransformer } from '../../transformers/images/codex';
import { GeminiImageTransformer } from '../../transformers/images/gemini';
import { OpenRouterImageTransformer } from '../../transformers/images/openrouter';
import type { ImageGenerationTransformer } from '../../types/image-transformer';
import { getApiBaseType } from '../../utils/api-format';

/**
 * Resolves the target-protocol image transformer independently of the
 * OpenRouter-shaped ingress API.
 */
export class ImageGenerationTransformerFactory {
  static getTransformer(providerType: string): ImageGenerationTransformer {
    switch (getApiBaseType(providerType)) {
      case 'gemini':
        return new GeminiImageTransformer();
      case 'openrouter-images':
        return new OpenRouterImageTransformer();
      case 'codex-images':
        return new CodexImageTransformer();
      case 'chat':
      case 'completions':
      case 'openai-images':
      case 'openai':
        return new ImageTransformer();
      default:
        throw new Error(
          `Unsupported image provider type: ${providerType}. Supported image targets are OpenAI-compatible, OpenRouter, Codex, and Gemini.`
        );
    }
  }

  static resolveTransformer(providerType?: string): ImageGenerationTransformer {
    return this.getTransformer(providerType || 'chat');
  }
}
