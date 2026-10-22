import { describe, expect, test } from 'bun:test';

import { GeminiEmbeddingsTransformer } from '../embeddings/gemini';

describe('GeminiEmbeddingsTransformer', () => {
  const transformer = new GeminiEmbeddingsTransformer();

  describe('getEndpoint', () => {
    test('should return embedContent for single string input', () => {
      const request = { model: 'gemini-embedding-2', input: 'Hello' };
      expect(transformer.getEndpoint!(request as any)).toBe(
        '/v1beta/models/gemini-embedding-2:embedContent'
      );
    });

    test('should return batchEmbedContents for array input with >1 items', () => {
      const request = { model: 'gemini-embedding-2', input: ['A', 'B'] };
      expect(transformer.getEndpoint!(request as any)).toBe(
        '/v1beta/models/gemini-embedding-2:batchEmbedContents'
      );
    });

    test('should prepend models/ prefix if missing', () => {
      const request = { model: 'text-embedding-004', input: 'test' };
      expect(transformer.getEndpoint!(request as any)).toContain('models/text-embedding-004');
    });

    test('should not prepend models/ if already present', () => {
      const request = { model: 'models/gemini-embedding-2', input: 'test' };
      expect(transformer.getEndpoint!(request as any)).toContain('models/gemini-embedding-2');
    });

    test('should not prepend models/ for tunedModels/ prefix', () => {
      const request = { model: 'tunedModels/my-model', input: 'test' };
      expect(transformer.getEndpoint!(request as any)).toContain('tunedModels/my-model');
    });
  });

  describe('getAuthHeaders', () => {
    test('should set x-goog-api-key header', () => {
      const headers: Record<string, string> = {};
      transformer.getAuthHeaders!('my-key', headers);
      expect(headers['x-goog-api-key']).toBe('my-key');
    });
  });

  describe('transformRequest', () => {
    test('should convert single string input to Gemini format', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: 'Hello world',
        originalBody: {},
      };
      const result = await transformer.transformRequest(request as any);
      expect(result.model).toBe('models/gemini-embedding-2');
      expect(result.content.parts[0].text).toBe('Hello world');
    });

    test('should convert batch input to batchEmbedContents format', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: ['A', 'B', 'C'],
        originalBody: {},
      };
      const result = await transformer.transformRequest(request as any);
      expect(result.requests).toHaveLength(3);
      expect(result.requests[0].model).toBe('models/gemini-embedding-2');
      expect(result.requests[0].content.parts[0].text).toBe('A');
    });

    test('should pass through Gemini-specific options for every batch item', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: ['A', 'B'],
        originalBody: {
          taskType: 'RETRIEVAL_QUERY',
          title: 'Batch Title',
          outputDimensionality: 128,
        },
        dimensions: 256,
      };
      const result = await transformer.transformRequest(request as any);

      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]).toMatchObject({
        model: 'models/gemini-embedding-2',
        taskType: 'RETRIEVAL_QUERY',
        title: 'Batch Title',
        outputDimensionality: 128,
      });
      expect(result.requests[1]).toMatchObject({
        model: 'models/gemini-embedding-2',
        taskType: 'RETRIEVAL_QUERY',
        title: 'Batch Title',
        outputDimensionality: 128,
      });
    });

    test('should pass through taskType and title from originalBody', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: 'Hello',
        originalBody: { taskType: 'RETRIEVAL_QUERY', title: 'My Doc' },
        dimensions: undefined,
      };
      const result = await transformer.transformRequest(request as any);
      expect(result.taskType).toBe('RETRIEVAL_QUERY');
      expect(result.title).toBe('My Doc');
    });

    test('should pass through dimensions as outputDimensionality', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: 'Hello',
        originalBody: {},
        dimensions: 256,
      };
      const result = await transformer.transformRequest(request as any);
      expect(result.outputDimensionality).toBe(256);
    });

    test('should prefer native outputDimensionality from originalBody when present', async () => {
      const request = {
        model: 'gemini-embedding-2',
        input: 'Hello',
        originalBody: { outputDimensionality: 128 },
        dimensions: 256,
      };
      const result = await transformer.transformRequest(request as any);
      expect(result.outputDimensionality).toBe(128);
    });

    test('should reject empty input arrays', async () => {
      await expect(
        transformer.transformRequest({
          model: 'gemini-embedding-2',
          input: [],
          originalBody: {},
        } as any)
      ).rejects.toThrow('Gemini embeddings input array must contain at least one item');
    });
  });

  describe('transformResponse', () => {
    test('should transform single EmbedContentResponse', async () => {
      const response = {
        embedding: { values: [0.1, 0.2, 0.3] },
        usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 },
      };
      const result = await transformer.transformResponse(response);
      expect(result.object).toBe('list');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.usage!.prompt_tokens).toBe(5);
    });

    test('should transform BatchEmbedContentsResponse', async () => {
      const response = {
        embeddings: [{ values: [0.1] }, { values: [0.2] }],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      };
      const result = await transformer.transformResponse(response);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.embedding).toEqual([0.1]);
      expect(result.data[1]!.embedding).toEqual([0.2]);
      expect(result.usage!.prompt_tokens).toBe(10);
    });

    test('should handle missing usageMetadata gracefully', async () => {
      const response = {
        embedding: { values: [0.1] },
      };
      const result = await transformer.transformResponse(response);
      expect(result.usage).toBeUndefined();
    });
  });

  describe('properties', () => {
    test('should have correct name', () => {
      expect(transformer.name).toBe('gemini');
    });

    test('should have correct default endpoint', () => {
      expect(transformer.defaultEndpoint).toBe('/v1beta/models/:model:embedContent');
    });
  });
});
