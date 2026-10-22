import { describe, expect, test } from 'vitest';

import { EmbeddingsTransformerFactory } from '../dispatch/embeddings-transformer-factory';

describe('EmbeddingsTransformerFactory', () => {
  test('should return GeminiEmbeddingsTransformer for gemini type', () => {
    const t = EmbeddingsTransformerFactory.getTransformer('gemini');
    expect(t.name).toBe('gemini');
  });

  test('should return OpenAIEmbeddingsTransformer for openai type', () => {
    const t = EmbeddingsTransformerFactory.getTransformer('openai');
    expect(t.name).toBe('openai');
  });

  test('should return OpenAIEmbeddingsTransformer for chat type', () => {
    const t = EmbeddingsTransformerFactory.getTransformer('chat');
    expect(t.name).toBe('openai');
  });

  test('should default to OpenAI for unknown type', () => {
    const t = EmbeddingsTransformerFactory.getTransformer('unknown');
    expect(t.name).toBe('openai');
  });
});

describe('resolveTransformer', () => {
  test('should resolve Gemini transformer when gemini is in provider types', () => {
    const t = EmbeddingsTransformerFactory.resolveTransformer(['chat', 'gemini']);
    expect(t.name).toBe('gemini');
  });

  test('should fall back to OpenAI when no dedicated type matches', () => {
    const t = EmbeddingsTransformerFactory.resolveTransformer(['chat', 'openai']);
    expect(t.name).toBe('openai');
  });

  test('should fall back to OpenAI for unknown provider types', () => {
    const t = EmbeddingsTransformerFactory.resolveTransformer(['anthropic']);
    expect(t.name).toBe('openai');
  });

  test('should fall back to OpenAI for empty provider types', () => {
    const t = EmbeddingsTransformerFactory.resolveTransformer([]);
    expect(t.name).toBe('openai');
  });

  test('should resolve Gemini when gemini appears alongside other types', () => {
    const t = EmbeddingsTransformerFactory.resolveTransformer(['ollama', 'gemini', 'chat']);
    expect(t.name).toBe('gemini');
  });
});
