import { EmbeddingsTransformer } from '../../types/embeddings-transformer';
import { UnifiedEmbeddingsRequest, UnifiedEmbeddingsResponse } from '../../types/unified';

export class GeminiEmbeddingsTransformer implements EmbeddingsTransformer {
  readonly name = 'gemini';
  readonly defaultEndpoint = '/v1beta/models/:model:embedContent';

  getEndpoint(request: UnifiedEmbeddingsRequest): string {
    const model = GeminiEmbeddingsTransformer.prefixModel(request.model);
    const input = request.input;
    const isBatch = Array.isArray(input) && input.length > 1;
    const action = isBatch ? 'batchEmbedContents' : 'embedContent';
    return `/v1beta/${model}:${action}`;
  }

  getAuthHeaders(apiKey: string, headers: Record<string, string>): void {
    headers['x-goog-api-key'] = apiKey;
  }

  async transformRequest(request: UnifiedEmbeddingsRequest): Promise<any> {
    const model = GeminiEmbeddingsTransformer.prefixModel(request.model);
    const input = request.input;
    const isBatch = Array.isArray(input) && input.length > 1;

    if (isBatch) {
      return {
        requests: (input as string[]).map((text) =>
          GeminiEmbeddingsTransformer.buildRequestPayload(model, text, request)
        ),
      };
    }

    // Single input (string or single-element array)
    const text = Array.isArray(input) ? input[0] : input;
    if (text === undefined) {
      throw new Error('Gemini embeddings input array must contain at least one item');
    }
    return GeminiEmbeddingsTransformer.buildRequestPayload(model, text, request);
  }

  async transformResponse(
    response: any,
    request?: UnifiedEmbeddingsRequest
  ): Promise<UnifiedEmbeddingsResponse> {
    const modelName = request?.model ?? '';
    if (response.embeddings) {
      // BatchEmbedContentsResponse: { embeddings: [{ values, shape }] }
      return {
        object: 'list',
        data: response.embeddings.map((item: any, index: number) => ({
          object: 'embedding' as const,
          embedding: item.values,
          index,
        })),
        model: modelName,
        usage: response.usageMetadata
          ? {
              prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
              total_tokens: response.usageMetadata.totalTokenCount ?? 0,
            }
          : undefined,
      };
    }

    // EmbedContentResponse: { embedding: { values, shape } }
    return {
      object: 'list',
      data: [
        {
          object: 'embedding' as const,
          embedding: response.embedding?.values ?? [],
          index: 0,
        },
      ],
      model: modelName,
      usage: response.usageMetadata
        ? {
            prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
            total_tokens: response.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
    };
  }

  async formatResponse(response: UnifiedEmbeddingsResponse): Promise<any> {
    return {
      object: response.object,
      data: response.data,
      model: response.model,
      usage: response.usage,
    };
  }

  extractUsage(_eventData: string): undefined {
    return undefined;
  }

  private static prefixModel(model: string): string {
    if (!model.startsWith('models/') && !model.startsWith('tunedModels/')) {
      return `models/${model}`;
    }
    return model;
  }

  private static buildRequestPayload(
    model: string,
    text: string,
    request: UnifiedEmbeddingsRequest
  ): Record<string, any> {
    const payload: Record<string, any> = {
      model,
      content: { parts: [{ text }] },
    };

    if (request.originalBody?.taskType !== undefined) {
      payload.taskType = request.originalBody.taskType;
    }
    if (request.originalBody?.title !== undefined) {
      payload.title = request.originalBody.title;
    }

    const outputDimensionality = request.originalBody?.outputDimensionality ?? request.dimensions;
    if (outputDimensionality !== undefined) {
      payload.outputDimensionality = outputDimensionality;
    }

    return payload;
  }
}
