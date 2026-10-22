import { EmbeddingsTransformer } from '../../types/embeddings-transformer';
import { UnifiedEmbeddingsRequest, UnifiedEmbeddingsResponse } from '../../types/unified';

export class OpenAIEmbeddingsTransformer implements EmbeddingsTransformer {
  readonly name = 'openai';
  readonly defaultEndpoint = '/embeddings';

  async transformRequest(request: UnifiedEmbeddingsRequest): Promise<any> {
    return {
      ...request.originalBody,
      model: request.model,
    };
  }

  async transformResponse(response: any): Promise<UnifiedEmbeddingsResponse> {
    return {
      ...response,
      object: 'list',
      data: response.data,
      model: response.model,
      usage: response.usage,
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
}
