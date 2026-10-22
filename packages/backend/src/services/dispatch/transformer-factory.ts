import { ImageBridgeTransformer } from '../../transformers/image-bridge';
import {
  AnthropicTransformer,
  GeminiTransformer,
  OpenAICompletionTransformer,
  OpenAITransformer,
} from '../../transformers/index';
import { OllamaTransformer } from '../../transformers/ollama';
import { ResponsesTransformer } from '../../transformers/responses';
import { Transformer } from '../../types/transformer';
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
      case 'completions':
        return new OpenAICompletionTransformer();
      case 'responses':
        return new ResponsesTransformer();
      case 'ollama':
        return new OllamaTransformer();
      // Not a wire protocol: the auto-bridge (image-model-bridge.ts) tags its
      // already-unified output `apiType: 'images'`, and the response handler
      // resolves a provider transformer from that tag. The no-op transformer
      // defines no transformStream, which is what lets the bridged unified
      // chunk stream reach the client formatter untouched.
      case 'images':
        return new ImageBridgeTransformer();
      default:
        throw new Error(
          `Unsupported provider type: ${providerType}. Only 'messages', 'gemini', 'chat', 'completions', 'responses', 'ollama', and 'images' are allowed.`
        );
    }
  }
}
