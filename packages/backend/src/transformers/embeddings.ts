import { UnifiedEmbeddingsRequest, UnifiedEmbeddingsResponse } from "../types/unified";

/**
 * EmbeddingsTransformer
 * 
 * Simple pass-through transformer for embeddings since the API format
 * is standardized across all providers (OpenAI, Voyage, Cohere, Google, etc.)
 */
export class EmbeddingsTransformer {
  name = "embeddings";
  defaultEndpoint = "/embeddings";

  async parseRequest(input: any): Promise<UnifiedEmbeddingsRequest> {
    return {
      model: input.model,
      input: input.input,
      encoding_format: input.encoding_format,
      dimensions: input.dimensions,
      user: input.user,
    };
  }

  async transformRequest(request: UnifiedEmbeddingsRequest): Promise<any> {
    // Pass-through - embeddings API is standardized across providers
    return {
      model: request.model,
      input: request.input,
      encoding_format: request.encoding_format,
      dimensions: request.dimensions,
      user: request.user,
    };
  }

  async transformResponse(response: any): Promise<UnifiedEmbeddingsResponse> {
    return {
      object: "list",
      data: response.data,
      model: response.model,
      usage: response.usage,
    };
  }

  async formatResponse(response: UnifiedEmbeddingsResponse): Promise<any> {
    // Pass through - already in correct format
    return {
      object: response.object,
      data: response.data,
      model: response.model,
      usage: response.usage,
    };
  }

  /**
   * Embeddings don't support streaming, so this returns undefined
   */
  extractUsage(eventData: string) {
    return undefined;
  }
}
