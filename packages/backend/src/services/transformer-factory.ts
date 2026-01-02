import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';

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
                throw new Error(`Unsupported provider type: ${providerType}`);
        }
    }
}

