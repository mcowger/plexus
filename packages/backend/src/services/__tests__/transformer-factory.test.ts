import { TransformerFactory } from '../transformer-factory';
import { AnthropicTransformer, OpenAITransformer, GeminiTransformer } from '../../transformers';
import { describe, it, expect } from 'bun:test';

describe('TransformerFactory', () => {
    it('should return AnthropicTransformer for "messages"', () => {
        const transformer = TransformerFactory.getTransformer('messages');
        expect(transformer).toBeInstanceOf(AnthropicTransformer);
    });

    it('should return GeminiTransformer for "gemini"', () => {
        const transformer = TransformerFactory.getTransformer('gemini');
        expect(transformer).toBeInstanceOf(GeminiTransformer);
    });

    it('should return OpenAITransformer for "chat"', () => {
        const transformer = TransformerFactory.getTransformer('chat');
        expect(transformer).toBeInstanceOf(OpenAITransformer);
    });

    it('should be case insensitive', () => {
        expect(TransformerFactory.getTransformer('Messages')).toBeInstanceOf(AnthropicTransformer);
        expect(TransformerFactory.getTransformer('GEMINI')).toBeInstanceOf(GeminiTransformer);
        expect(TransformerFactory.getTransformer('Chat')).toBeInstanceOf(OpenAITransformer);
    });

    it('should throw error for unknown provider', () => {
        expect(() => {
            TransformerFactory.getTransformer('unknown-provider');
        }).toThrow('Unsupported provider type: unknown-provider');
    });
});