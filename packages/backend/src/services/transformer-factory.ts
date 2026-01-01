import { Transformer } from '../types/transformer';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../transformers';

export class TransformerFactory {
    static getTransformer(providerType: string): Transformer {
        switch (providerType.toLowerCase()) {
            case 'anthropic':
                return new AnthropicTransformer();
            case 'google':
            case 'gemini':
                return new GeminiTransformer();
            case 'openai':
            case 'openrouter':
            case 'deepseek':
            case 'groq':
                return new OpenAITransformer();
            default:
                // Default to OpenAI compatible
                return new OpenAITransformer();
        }
    }
}

