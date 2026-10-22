import type { ImageGenerationTransformer } from '../../types/image-transformer';
import type {
  ImageResolution,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
} from '../../types/unified';
import { ImageRequestValidationError, resolveImageReference } from '../image';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function prefixModel(model: string): string {
  if (model.startsWith('models/') || model.startsWith('tunedModels/')) return model;
  return `models/${model}`;
}

function resolutionFromSize(size: string): ImageResolution | undefined {
  if (size === '512' || size === '1K' || size === '2K' || size === '4K') return size;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return undefined;

  const longestSide = Math.max(Number(match[1]), Number(match[2]));
  if (longestSide <= 512) return '512';
  if (longestSide <= 1024) return '1K';
  if (longestSide <= 2048) return '2K';
  return '4K';
}

async function imagePartFromReference(
  reference: NonNullable<UnifiedImageGenerationRequest['input_references']>[number],
  signal?: AbortSignal
): Promise<any> {
  const resolved = await resolveImageReference(reference, signal);

  return {
    inlineData: {
      mimeType: resolved.mimeType,
      data: resolved.data.toString('base64'),
    },
  };
}

function unsupportedOptions(request: UnifiedImageGenerationRequest): void {
  if (request.output_format && request.output_format !== 'png') {
    throw new ImageRequestValidationError(
      `Native Gemini image generation does not support output_format '${request.output_format}'`
    );
  }
  if (request.background && request.background !== 'auto') {
    throw new ImageRequestValidationError(
      `Native Gemini image generation does not support background '${request.background}'`
    );
  }
  if (request.output_compression !== undefined) {
    throw new ImageRequestValidationError(
      'Native Gemini image generation does not support output_compression'
    );
  }
  if (request.style !== undefined) {
    throw new ImageRequestValidationError('Native Gemini image generation does not support style');
  }
  // Gemini has no inpainting-mask channel. Dropping the mask would silently
  // repaint the whole image, so refuse instead.
  if (request.mask !== undefined) {
    throw new ImageRequestValidationError(
      'Native Gemini image generation does not support mask images'
    );
  }
}

export class GeminiImageTransformer implements ImageGenerationTransformer {
  readonly name = 'gemini';
  readonly defaultEndpoint = '/v1beta/models/:model:generateContent';

  getEndpoint(request: UnifiedImageGenerationRequest): string {
    if (request.stream) {
      throw new ImageRequestValidationError('Image streaming is not supported yet', 501);
    }
    return `/v1beta/${prefixModel(request.model)}:generateContent`;
  }

  getAuthHeaders(apiKey: string, headers: Record<string, string>): void {
    headers['x-goog-api-key'] = apiKey;
  }

  async transformGenerationRequest(
    request: UnifiedImageGenerationRequest,
    signal?: AbortSignal
  ): Promise<any> {
    unsupportedOptions(request);

    const parts: any[] = [{ text: request.prompt }];
    for (const reference of request.input_references ?? []) {
      parts.push(await imagePartFromReference(reference, signal));
    }

    const resolution =
      request.resolution ?? (request.size ? resolutionFromSize(request.size) : undefined);
    const imageConfig: Record<string, string> = {};
    if (request.aspect_ratio && request.aspect_ratio !== 'auto') {
      imageConfig.aspectRatio = request.aspect_ratio;
    }
    if (resolution) imageConfig.imageSize = resolution;

    const generationConfig: Record<string, any> = {
      responseModalities: ['IMAGE'],
    };
    if (request.n !== undefined) generationConfig.candidateCount = request.n;
    if (request.seed !== undefined) generationConfig.seed = request.seed;
    if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;

    return {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };
  }

  async transformGenerationResponse(
    response: any,
    _request?: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const data: UnifiedImageGenerationResponse['data'] = [];
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate?.content?.parts ?? []) {
        const inlineData = part.inlineData ?? part.inline_data;
        if (!inlineData?.data) continue;
        data.push({
          b64_json: inlineData.data,
          media_type: inlineData.mimeType ?? inlineData.mime_type ?? MIME_TYPES.png,
        });
      }
    }

    if (data.length === 0) {
      throw new ImageRequestValidationError('Gemini image generation returned no image data', 502);
    }

    const usageMetadata = response.usageMetadata;
    const usage = usageMetadata
      ? {
          input_tokens: usageMetadata.promptTokenCount,
          output_tokens: usageMetadata.candidatesTokenCount,
          total_tokens: usageMetadata.totalTokenCount,
        }
      : undefined;

    return {
      created: response.created ?? Math.floor(Date.now() / 1000),
      data,
      usage,
    };
  }
}
