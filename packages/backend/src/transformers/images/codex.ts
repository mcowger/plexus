import type { ImageGenerationTransformer } from '../../types/image-transformer';
import type {
  ImageResolution,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedImageReference,
} from '../../types/unified';
import {
  ImageRequestValidationError,
  normalizeImageUsage,
  OPENAI_TIER_SIZES,
  resolveImageReference,
  TIER_SIZE_PATTERN,
} from '../image';

/** Codex `/images/edits` accepts at most five reference images per request. */
const MAX_CODEX_IMAGE_REFERENCES = 5;

/**
 * Codex renders square, landscape, and portrait frames only. The OpenAI table's
 * `1792x…` sizes are not Codex sizes, so aspect ratios map by orientation here
 * instead of through `resolveOpenAISize`.
 */
const CODEX_ASPECT_RATIO_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '4:3': '1536x1024',
  '5:4': '1536x1024',
  '16:9': '1536x1024',
  '21:9': '1536x1024',
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
};

/** Media types Codex reports through the top-level `output_format` field. */
const CODEX_OUTPUT_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function resolveCodexSize(request: UnifiedImageGenerationRequest): string | undefined {
  if (request.size) {
    if (TIER_SIZE_PATTERN.test(request.size)) {
      return OPENAI_TIER_SIZES[request.size as ImageResolution];
    }
    // Pixel dimensions and the literal `auto` pass through untouched.
    return request.size;
  }
  if (request.aspect_ratio && request.aspect_ratio !== 'auto') {
    const size = CODEX_ASPECT_RATIO_SIZES[request.aspect_ratio];
    if (!size) {
      throw new ImageRequestValidationError(
        `Codex image targets cannot map aspect_ratio '${request.aspect_ratio}'`
      );
    }
    return size;
  }
  if (request.resolution) return OPENAI_TIER_SIZES[request.resolution];
  return undefined;
}

/**
 * Codex Images speaks a narrow subset of the image IR. Anything it cannot
 * express is rejected explicitly rather than dropped from the payload.
 */
function rejectUnsupportedOptions(request: UnifiedImageGenerationRequest): void {
  if (request.response_format === 'url') {
    throw new ImageRequestValidationError(
      'Codex image targets return base64 image data rather than URL responses'
    );
  }
  if (request.output_format !== undefined) {
    throw new ImageRequestValidationError(
      'Codex image targets choose their own output_format and cannot honor a requested one'
    );
  }
  if (request.output_compression !== undefined) {
    throw new ImageRequestValidationError('Codex image targets do not support output_compression');
  }
  if (request.seed !== undefined) {
    throw new ImageRequestValidationError('Codex image targets do not support seed');
  }
  if (request.style !== undefined) {
    throw new ImageRequestValidationError('Codex image targets do not support style');
  }
  if (request.user !== undefined) {
    throw new ImageRequestValidationError('Codex image targets do not support user');
  }
  if (request.mask !== undefined) {
    throw new ImageRequestValidationError('Codex image targets do not support mask images');
  }
}

async function referenceToDataUrl(
  reference: UnifiedImageReference,
  signal?: AbortSignal
): Promise<string> {
  const resolved = await resolveImageReference(reference, signal);
  return `data:${resolved.mimeType};base64,${resolved.data.toString('base64')}`;
}

function buildCodexGenerationRequest(
  request: UnifiedImageGenerationRequest
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: request.prompt,
    model: request.model,
  };

  const size = resolveCodexSize(request);
  if (size !== undefined) payload.size = size;
  if (request.n !== undefined) payload.n = request.n;
  if (request.quality !== undefined) payload.quality = request.quality;
  if (request.background !== undefined) payload.background = request.background;

  return payload;
}

async function buildCodexEditRequest(
  request: UnifiedImageGenerationRequest,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const references = request.input_references ?? [];
  if (references.length > MAX_CODEX_IMAGE_REFERENCES) {
    throw new ImageRequestValidationError(
      `Codex image editing targets support at most ${MAX_CODEX_IMAGE_REFERENCES} input references`
    );
  }

  const size = resolveCodexSize(request);
  const images: Array<{ image_url: string }> = [];
  for (const reference of references) {
    images.push({ image_url: await referenceToDataUrl(reference, signal) });
  }

  const payload: Record<string, unknown> = {
    images,
    prompt: request.prompt,
    model: request.model,
    background: request.background ?? 'auto',
    quality: request.quality ?? 'auto',
    size: size ?? 'auto',
  };
  if (request.n !== undefined) payload.n = request.n;

  return payload;
}

/**
 * Target transformer for the ChatGPT-subscription Codex Images backend
 * (`/images/generations` and `/images/edits` under `/backend-api/codex`).
 */
export class CodexImageTransformer implements ImageGenerationTransformer {
  readonly name = 'codex-images';
  readonly defaultEndpoint = '/images/generations';

  getEndpoint(request: UnifiedImageGenerationRequest): string {
    if (request.stream) {
      throw new ImageRequestValidationError('Image streaming is not supported yet', 501);
    }
    return request.input_references && request.input_references.length > 0
      ? '/images/edits'
      : this.defaultEndpoint;
  }

  async transformGenerationRequest(
    request: UnifiedImageGenerationRequest,
    signal?: AbortSignal
  ): Promise<any> {
    rejectUnsupportedOptions(request);

    if (request.input_references && request.input_references.length > 0) {
      return buildCodexEditRequest(request, signal);
    }
    return buildCodexGenerationRequest(request);
  }

  async transformGenerationResponse(
    response: any,
    _request?: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const mediaType =
      typeof response.output_format === 'string'
        ? CODEX_OUTPUT_MEDIA_TYPES[response.output_format.toLowerCase()]
        : undefined;

    const data: UnifiedImageGenerationResponse['data'] = [];
    for (const item of Array.isArray(response.data) ? response.data : []) {
      if (typeof item?.b64_json !== 'string' || item.b64_json.length === 0) continue;
      data.push({
        b64_json: item.b64_json,
        ...(mediaType !== undefined ? { media_type: mediaType } : {}),
      });
    }

    if (data.length === 0) {
      throw new ImageRequestValidationError('Codex image generation returned no image data', 502);
    }

    return {
      created: response.created ?? Math.floor(Date.now() / 1000),
      data,
      usage: normalizeImageUsage(response.usage),
    };
  }
}
