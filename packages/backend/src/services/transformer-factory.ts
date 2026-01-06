import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';
import { AntigravityTransformer } from '../transformers/antigravity';

/**
 * TransformerFactory
 *
 * Factory for retrieving the correct transformer based on the provider's API type.
 * Supports 'messages' (Anthropic), 'gemini' (Google), 'antigravity' (Google Antigravity), and 'chat' (OpenAI).
 */
export class TransformerFactory {
    static getTransformer(providerType: string): Transformer {
        switch (providerType.toLowerCase()) {
            case 'messages':
                return new AnthropicTransformer();
            case 'gemini':
                return new GeminiTransformer();
            case 'antigravity':
                return new AntigravityTransformer();
            case 'chat':
                return new OpenAITransformer();
            default:
                throw new Error(`Unsupported provider type: ${providerType}. Only 'messages', 'gemini', 'antigravity', and 'chat' are allowed.`);
        }
    }
}