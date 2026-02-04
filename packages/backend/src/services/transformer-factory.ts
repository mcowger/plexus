import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer, OAuthTransformer } from '../transformers';
import { ResponsesTransformer } from '../transformers/responses';

/**
 * TransformerFactory
 *
 * Factory for retrieving the correct transformer based on the provider's API type.
 * Supports 'messages' (Anthropic), 'gemini' (Google), 'chat' (OpenAI), 'responses' (OpenAI Responses API), and 'oauth'.
 */
export class TransformerFactory {
    static getTransformer(providerType: string): Transformer {
        switch (providerType.toLowerCase()) {
            case 'messages':
                return new AnthropicTransformer();
            case 'gemini':
                return new GeminiTransformer();
            case 'chat':
                return new OpenAITransformer();
            case 'responses':
                return new ResponsesTransformer();
            case 'oauth':
                return new OAuthTransformer();
            default:
                throw new Error(`Unsupported provider type: ${providerType}. Only 'messages', 'gemini', 'chat', 'responses', and 'oauth' are allowed.`);
        }
    }
}
