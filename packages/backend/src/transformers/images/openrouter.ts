import type { ImageGenerationTransformer } from '../../types/image-transformer';
import type {
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
} from '../../types/unified';
import { ImageRequestValidationError, normalizeImageUsage } from '../image';

export class OpenRouterImageTransformer implements ImageGenerationTransformer {
  readonly name = 'openrouter-images';
  readonly defaultEndpoint = '/images';

  getEndpoint(request: UnifiedImageGenerationRequest): string {
    if (request.stream) {
      throw new ImageRequestValidationError('Image streaming is not supported yet', 501);
    }
    return this.defaultEndpoint;
  }

  async transformGenerationRequest(request: UnifiedImageGenerationRequest): Promise<any> {
    if (request.response_format === 'url') {
      throw new ImageRequestValidationError(
        'OpenRouter image targets return base64 image data rather than URL responses'
      );
    }
    if (request.style !== undefined || request.user !== undefined) {
      throw new ImageRequestValidationError(
        'OpenRouter image targets do not support the legacy style or user fields'
      );
    }
    // OpenRouter's image API has no mask channel; dropping it would silently
    // repaint the whole image, so refuse instead.
    if (request.mask !== undefined) {
      throw new ImageRequestValidationError('OpenRouter image targets do not support mask images');
    }

    const payload: Record<string, any> = {
      model: request.model,
      prompt: request.prompt,
    };

    const fields = [
      'n',
      'resolution',
      'aspect_ratio',
      'size',
      'quality',
      'output_format',
      'background',
      'output_compression',
      'seed',
      'input_references',
    ] as const;
    for (const field of fields) {
      const value = request[field];
      if (value !== undefined) payload[field] = value;
    }

    return payload;
  }

  async transformGenerationResponse(
    response: any,
    _request?: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const data = Array.isArray(response.data)
      ? response.data.map((item: any) => ({
          ...(item.url !== undefined ? { url: item.url } : {}),
          ...(item.b64_json !== undefined ? { b64_json: item.b64_json } : {}),
          ...(item.media_type !== undefined ? { media_type: item.media_type } : {}),
          ...(item.revised_prompt !== undefined ? { revised_prompt: item.revised_prompt } : {}),
        }))
      : [];

    if (data.length === 0) {
      throw new ImageRequestValidationError(
        'OpenRouter image generation returned no image data',
        502
      );
    }

    return {
      created: response.created ?? Math.floor(Date.now() / 1000),
      data,
      usage: normalizeImageUsage(response.usage),
    };
  }
}
