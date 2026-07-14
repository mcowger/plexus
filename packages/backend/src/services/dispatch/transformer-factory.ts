import { Transformer } from '../../types/transformer';
import {
  AnthropicTransformer,
  OpenAITransformer,
  GeminiTransformer,
} from '../../transformers/index';
import { ResponsesTransformer } from '../../transformers/responses';
import { OllamaTransformer } from '../../transformers/ollama';
import { getApiBaseType } from '../../utils/api-format';

/**
 * TransformerFactory
 *
 * Factory for retrieving the correct transformer based on the provider's API type.
 * Supports 'messages' (Anthropic), 'gemini' (Google), 'chat' (OpenAI), 'responses' (OpenAI Responses API), and 'ollama' (Native Ollama).
 *
 * The synthetic 'oauth' type is gone: all OAuth providers now resolve to their
 * real wire API type (messages/responses/chat) via nativeOAuthApiType and run
 * through the standard path (pi-ai OAuth executor removed).
 */
export class TransformerFactory {
  static getTransformer(providerType: string): Transformer {
    switch (getApiBaseType(providerType)) {
      case 'messages':
        return new AnthropicTransformer();
      case 'gemini':
        return new GeminiTransformer();
      case 'chat':
        return new OpenAITransformer();
      case 'responses':
        return new ResponsesTransformer();
      case 'ollama':
        return new OllamaTransformer();
      default:
        throw new Error(
          `Unsupported provider type: ${providerType}. Only 'messages', 'gemini', 'chat', 'responses', and 'ollama' are allowed.`
        );
    }
  }
}
