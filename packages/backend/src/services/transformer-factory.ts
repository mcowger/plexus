import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';

export class TransformerFactory {
    static getTransformer(providerType: string): Transformer {
        switch (providerType.toLowerCase()) {
            case 'anthropic':
                return new AnthropicTransformer();
            case 'google': // because I can never remember the exact provider name :)
            case 'gemini':
                return new GeminiTransformer();
            case 'openai':
                return new OpenAITransformer();
            default:
                throw new Error(`Unsupported provider type: ${providerType}`);
        }
    }
}

