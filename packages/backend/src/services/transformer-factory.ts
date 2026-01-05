import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';

/**
 * TransformerFactory
 * 
 * Factory for retrieving the correct transformer based on the provider's API type.
 * Only 'messages' (Anthropic), 'gemini' (Google), and 'chat' (OpenAI) are supported.
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
            default:
                throw new Error(`Unsupported provider type: ${providerType}. Only 'messages', 'gemini', and 'chat' are allowed.`);
        }
    }
}