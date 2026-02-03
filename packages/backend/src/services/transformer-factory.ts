import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';
import { ResponsesTransformer } from '../transformers/responses';

/**
 * TransformerFactory
 *
 * Factory for retrieving the correct transformer based on the provider's API type.
 * Supports 'messages' (Anthropic), 'gemini' (Google), 'chat' (OpenAI), and 'responses' (OpenAI Responses API).
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
            default:
                throw new Error(`Unsupported provider type: ${providerType}. Only 'messages', 'gemini', 'chat', and 'responses' are allowed.`);
        }
    }
}