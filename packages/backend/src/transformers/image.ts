import {
  ImageResolution,
  UnifiedImageEditRequest,
  UnifiedImageEditResponse,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedImageReference,
} from '../types/unified';

const IMAGE_RESOLUTIONS = new Set<ImageResolution>(['512', '1K', '2K', '4K']);
const IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '1:2',
  '1:4',
  '1:8',
  '2:1',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '9:21',
  '21:9',
  'auto',
]);
const IMAGE_QUALITIES = new Set(['auto', 'low', 'medium', 'high']);
const IMAGE_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'svg']);
const IMAGE_BACKGROUNDS = new Set(['auto', 'transparent', 'opaque']);
const MAX_IMAGE_REFERENCES = 16;
export { MAX_IMAGE_REFERENCES };
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 15_000;
const PIXEL_SIZE_PATTERN = /^\d+x\d+$/;
export const TIER_SIZE_PATTERN = /^(?:512|1K|2K|4K)$/;

export const OPENAI_TIER_SIZES: Record<ImageResolution, string> = {
  '512': '512x512',
  '1K': '1024x1024',
  '2K': '2048x2048',
  '4K': '4096x4096',
};

const OPENAI_ASPECT_RATIO_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '1024x1792',
  '3:2': '1792x1024',
  '3:4': '1024x1792',
  '4:3': '1792x1024',
  '4:5': '1024x1792',
  '5:4': '1792x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '21:9': '1792x1024',
};

export class ImageRequestValidationError extends Error {
  routingContext: { statusCode: number; code: string };

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImageRequestValidationError';
    this.routingContext = {
      statusCode,
      code:
        statusCode === 400
          ? 'invalid_request_error'
          : statusCode === 501
            ? 'unsupported_image_feature'
            : 'upstream_invalid_response',
    };
  }
}

export function parseImageDataUrl(url: string): { mimeType: string; data: Buffer } | undefined {
  const match = /^data:([^;,]+)(?:;[^;,]+)*;base64,(.*)$/s.exec(url);
  if (!match || !match[1]!.startsWith('image/')) return undefined;

  const data = Buffer.from(match[2]!, 'base64');
  if (data.length === 0) {
    throw new ImageRequestValidationError('Image data URL contains no image bytes');
  }

  return { mimeType: match[1]!, data };
}

function isUnsafeRemoteImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') return true;
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.')) return true;
  if (host.startsWith('169.254.')) return true;

  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!ipv4) return false;
  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);
  return first === 0 || (first === 172 && second >= 16 && second <= 31);
}

export async function resolveImageReference(
  reference: UnifiedImageReference,
  signal?: AbortSignal
): Promise<{ mimeType: string; data: Buffer }> {
  signal?.throwIfAborted();
  const inline = parseImageDataUrl(reference.image_url.url);
  if (inline) return inline;

  let url: URL;
  try {
    url = new URL(reference.image_url.url);
  } catch {
    throw new ImageRequestValidationError('Image reference URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageRequestValidationError('Image reference URL must use http or https');
  }
  if (url.username || url.password || isUnsafeRemoteImageHost(url.hostname)) {
    throw new ImageRequestValidationError('Image reference URL is not allowed');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      headers: { Accept: 'image/*' },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    if (!response.ok) {
      throw new ImageRequestValidationError(`Image reference URL returned HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new ImageRequestValidationError('Image reference exceeds the maximum allowed size');
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new ImageRequestValidationError('Image reference contains no usable image bytes');
    }

    const headerMimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    const mimeType = reference.media_type || headerMimeType;
    if (!mimeType?.startsWith('image/')) {
      throw new ImageRequestValidationError('Image reference response is not an image');
    }
    return { mimeType, data };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageRequestValidationError) throw error;
    if ((error as any)?.name === 'AbortError') {
      throw new ImageRequestValidationError('Image reference download timed out');
    }
    throw new ImageRequestValidationError('Image reference could not be downloaded');
  } finally {
    clearTimeout(timeout);
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ImageRequestValidationError(`${field} must be a non-empty string`);
  }
  return value;
}

function validateReference(reference: unknown, index: number): void {
  if (!reference || typeof reference !== 'object') {
    throw new ImageRequestValidationError(`input_references[${index}] must be an image reference`);
  }

  const candidate = reference as any;
  if (candidate.type !== 'image_url' || !candidate.image_url) {
    throw new ImageRequestValidationError(`input_references[${index}] must use type 'image_url'`);
  }

  const url = requireNonEmptyString(
    candidate.image_url.url,
    `input_references[${index}].image_url.url`
  );
  if (url.startsWith('data:')) {
    if (!parseImageDataUrl(url)) {
      throw new ImageRequestValidationError(
        `input_references[${index}] must contain an image data URL`
      );
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageRequestValidationError(`input_references[${index}] must contain a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ImageRequestValidationError(
      `input_references[${index}] URL must use http, https, or a data URL`
    );
  }
}

function validateProviderPreferences(provider: unknown): void {
  if (provider === undefined) return;
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new ImageRequestValidationError('provider must be an object');
  }

  const value = provider as any;
  for (const field of ['only', 'ignore', 'order'] as const) {
    if (value[field] === undefined) continue;
    if (
      !Array.isArray(value[field]) ||
      value[field].some((entry: unknown) => typeof entry !== 'string' || entry.length === 0)
    ) {
      throw new ImageRequestValidationError(`provider.${field} must be an array of strings`);
    }
  }

  if (value.allow_fallbacks !== undefined && typeof value.allow_fallbacks !== 'boolean') {
    throw new ImageRequestValidationError('provider.allow_fallbacks must be a boolean');
  }

  if (
    value.sort !== undefined &&
    typeof value.sort !== 'string' &&
    (!value.sort || typeof value.sort !== 'object' || Array.isArray(value.sort))
  ) {
    throw new ImageRequestValidationError('provider.sort must be a string or object');
  }

  if (
    value.options !== undefined &&
    (!value.options || typeof value.options !== 'object' || Array.isArray(value.options))
  ) {
    throw new ImageRequestValidationError('provider.options must be an object');
  }
}

function resolutionTierForSize(size: string): ImageResolution | undefined {
  if (TIER_SIZE_PATTERN.test(size)) return size as ImageResolution;
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) return undefined;
  const longestSide = Math.max(width, height);
  if (longestSide <= 512) return '512';
  if (longestSide <= 1024) return '1K';
  if (longestSide <= 2048) return '2K';
  return '4K';
}

function validateSizeAndAspectRatio(
  size: string | undefined,
  resolution: ImageResolution | undefined,
  aspectRatio: string | undefined
): void {
  if (size && resolution && resolutionTierForSize(size) !== resolution) {
    throw new ImageRequestValidationError(
      `size '${size}' conflicts with resolution '${resolution}'`
    );
  }
  if (!size || !aspectRatio || aspectRatio === 'auto' || TIER_SIZE_PATTERN.test(size)) return;

  const [width, height] = size.split('x').map(Number);
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
  if (!width || !height || !ratioWidth || !ratioHeight) return;

  const requestedRatio = width / height;
  const expectedRatio = ratioWidth / ratioHeight;
  if (Math.abs(requestedRatio - expectedRatio) > 0.01) {
    throw new ImageRequestValidationError(
      `size '${size}' conflicts with aspect_ratio '${aspectRatio}'`
    );
  }
}

function validateOpenRouterRequest(input: any): void {
  requireNonEmptyString(input.model, 'model');
  requireNonEmptyString(input.prompt, 'prompt');

  if (input.n !== undefined && (!Number.isInteger(input.n) || input.n < 1 || input.n > 10)) {
    throw new ImageRequestValidationError('n must be an integer between 1 and 10');
  }
  if (input.resolution !== undefined && !IMAGE_RESOLUTIONS.has(input.resolution)) {
    throw new ImageRequestValidationError('resolution must be one of 512, 1K, 2K, or 4K');
  }
  if (input.aspect_ratio !== undefined && !IMAGE_ASPECT_RATIOS.has(input.aspect_ratio)) {
    throw new ImageRequestValidationError('aspect_ratio is not supported');
  }
  if (
    input.size !== undefined &&
    (typeof input.size !== 'string' ||
      (!PIXEL_SIZE_PATTERN.test(input.size) && !TIER_SIZE_PATTERN.test(input.size)))
  ) {
    throw new ImageRequestValidationError(
      'size must be a resolution tier or pixel dimensions such as 1024x1024'
    );
  }
  if (
    input.quality !== undefined &&
    (typeof input.quality !== 'string' || !IMAGE_QUALITIES.has(input.quality))
  ) {
    throw new ImageRequestValidationError('quality must be one of auto, low, medium, or high');
  }
  if (
    input.output_format !== undefined &&
    (typeof input.output_format !== 'string' || !IMAGE_OUTPUT_FORMATS.has(input.output_format))
  ) {
    throw new ImageRequestValidationError('output_format must be png, jpeg, webp, or svg');
  }
  if (
    input.background !== undefined &&
    (typeof input.background !== 'string' || !IMAGE_BACKGROUNDS.has(input.background))
  ) {
    throw new ImageRequestValidationError('background must be auto, transparent, or opaque');
  }
  if (
    input.output_compression !== undefined &&
    (!Number.isInteger(input.output_compression) ||
      input.output_compression < 0 ||
      input.output_compression > 100)
  ) {
    throw new ImageRequestValidationError(
      'output_compression must be an integer between 0 and 100'
    );
  }
  if (input.seed !== undefined && !Number.isInteger(input.seed)) {
    throw new ImageRequestValidationError('seed must be an integer');
  }
  if (input.response_format !== undefined && !['url', 'b64_json'].includes(input.response_format)) {
    throw new ImageRequestValidationError('response_format must be url or b64_json');
  }
  if (input.input_references !== undefined) {
    if (
      !Array.isArray(input.input_references) ||
      input.input_references.length > MAX_IMAGE_REFERENCES
    ) {
      throw new ImageRequestValidationError(
        `input_references must contain at most ${MAX_IMAGE_REFERENCES} images`
      );
    }
    input.input_references.forEach(validateReference);
  }

  validateSizeAndAspectRatio(input.size, input.resolution, input.aspect_ratio);
  validateProviderPreferences(input.provider);

  if (input.stream === true) {
    throw new ImageRequestValidationError('Image streaming is not supported yet', 501);
  }
}

export function normalizeImageUsage(usage: any): UnifiedImageGenerationResponse['usage'] {
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = usage.input_tokens ?? usage.prompt_tokens;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens;
  const normalized: NonNullable<UnifiedImageGenerationResponse['usage']> = {
    ...usage,
  };

  if (inputTokens !== undefined) {
    normalized.input_tokens = inputTokens;
    normalized.prompt_tokens = usage.prompt_tokens ?? inputTokens;
  }
  if (outputTokens !== undefined) {
    normalized.output_tokens = outputTokens;
    normalized.completion_tokens = usage.completion_tokens ?? outputTokens;
  }
  if (usage.total_tokens !== undefined) normalized.total_tokens = usage.total_tokens;
  if (usage.cost !== undefined) normalized.cost = usage.cost;

  return normalized;
}

export async function formatOpenRouterImageResponse(
  response: UnifiedImageGenerationResponse,
  signal?: AbortSignal
): Promise<any> {
  signal?.throwIfAborted();
  const data = await Promise.all(
    response.data.map(async (item) => {
      if (item.b64_json !== undefined || item.url === undefined) return item;
      const resolved = await resolveImageReference(
        {
          type: 'image_url',
          image_url: { url: item.url },
          media_type: item.media_type,
        },
        signal
      );
      return {
        b64_json: resolved.data.toString('base64'),
        media_type: resolved.mimeType,
        ...(item.revised_prompt !== undefined ? { revised_prompt: item.revised_prompt } : {}),
      };
    })
  );

  const usage = response.usage;
  const formattedUsage = usage
    ? {
        ...(usage.prompt_tokens !== undefined
          ? { prompt_tokens: usage.prompt_tokens }
          : usage.input_tokens !== undefined
            ? { prompt_tokens: usage.input_tokens }
            : {}),
        ...(usage.completion_tokens !== undefined
          ? { completion_tokens: usage.completion_tokens }
          : usage.output_tokens !== undefined
            ? { completion_tokens: usage.output_tokens }
            : {}),
        ...(usage.total_tokens !== undefined ? { total_tokens: usage.total_tokens } : {}),
        ...(usage.cost !== undefined ? { cost: usage.cost } : {}),
      }
    : undefined;

  return {
    created: response.created,
    data,
    ...(formattedUsage && Object.keys(formattedUsage).length > 0 ? { usage: formattedUsage } : {}),
  };
}

export function resolveOpenAISize(request: UnifiedImageGenerationRequest): string | undefined {
  if (request.size) {
    if (TIER_SIZE_PATTERN.test(request.size)) {
      return OPENAI_TIER_SIZES[request.size as ImageResolution];
    }
    return request.size;
  }
  if (request.aspect_ratio && request.aspect_ratio !== 'auto') {
    const size = OPENAI_ASPECT_RATIO_SIZES[request.aspect_ratio];
    if (!size) {
      throw new ImageRequestValidationError(
        `OpenAI-compatible image targets cannot map aspect_ratio '${request.aspect_ratio}'`
      );
    }
    return size;
  }
  if (request.resolution) return OPENAI_TIER_SIZES[request.resolution];
  return undefined;
}

function appendFormValue(formData: FormData, key: string, value: unknown): void {
  if (value !== undefined && value !== null) formData.append(key, String(value));
}

async function buildOpenAIReferenceRequest(
  request: UnifiedImageGenerationRequest,
  signal?: AbortSignal
): Promise<FormData> {
  const references = request.input_references ?? [];
  if (references.length === 0) {
    throw new ImageRequestValidationError(
      'OpenAI-compatible image editing targets require one or more input references'
    );
  }

  // The chat bridge and /v1/images JSON surface reach this function directly.
  if (references.length > MAX_IMAGE_REFERENCES) {
    throw new ImageRequestValidationError(
      `OpenAI-compatible image editing targets support at most ${MAX_IMAGE_REFERENCES} input references`
    );
  }

  const resolvedRefs = await Promise.all(
    references.map((reference) => resolveImageReference(reference, signal))
  );

  const formData = new FormData();
  appendFormValue(formData, 'model', request.model);
  appendFormValue(formData, 'prompt', request.prompt);
  appendFormValue(formData, 'n', request.n);
  appendFormValue(formData, 'size', resolveOpenAISize(request));
  appendFormValue(formData, 'response_format', request.response_format);
  appendFormValue(formData, 'quality', request.quality === 'auto' ? undefined : request.quality);
  appendFormValue(formData, 'user', request.user);
  appendFormValue(formData, 'output_format', request.output_format);
  appendFormValue(formData, 'background', request.background);
  appendFormValue(formData, 'output_compression', request.output_compression);
  appendFormValue(formData, 'seed', request.seed);
  // N=1 keeps the exact wire shape every existing provider sees (field named
  // `image`, single part). N≥2 uses OpenAI's documented multi-image edit
  // shape: `image[]` repeated per file.
  if (resolvedRefs.length === 1) {
    const parsed = resolvedRefs[0]!;
    formData.append(
      'image',
      new Blob([new Uint8Array(parsed.data)], { type: parsed.mimeType }),
      'reference.png'
    );
  } else {
    for (const parsed of resolvedRefs) {
      formData.append(
        'image[]',
        new Blob([new Uint8Array(parsed.data)], { type: parsed.mimeType }),
        'reference.png'
      );
    }
  }

  if (request.mask) {
    const mask = await resolveImageReference(request.mask, signal);
    formData.append(
      'mask',
      new Blob([new Uint8Array(mask.data)], { type: mask.mimeType }),
      'mask.png'
    );
  }

  return formData;
}

/**
 * Sniffs an image media type from the magic bytes at the head of a buffer.
 *
 * Mirrors `sniffImageMimeSubtype` in `image-rendering.ts` (which reads base64
 * text rather than bytes):
 *   - PNG:  \x89 P N G
 *   - JPEG: \xFF \xD8
 *   - WebP: R I F F ...(4 size bytes)... W E B P
 *   - GIF:  G I F 8
 * Anything unrecognized defaults to png, matching that renderer.
 */
function sniffImageMediaType(data: Buffer): string {
  if (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (
    data.length >= 12 &&
    data.toString('latin1', 0, 4) === 'RIFF' &&
    data.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (data.length >= 4 && data.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  return 'image/png';
}

/**
 * Wraps raw upload bytes as an inline image reference.
 *
 * The multipart edits route and the deprecated edit-request converter both hand
 * the dispatcher buffers; the IR only speaks image data URLs, so the bytes
 * become a base64 data URL. Multipart clients routinely omit the part's content
 * type — curl's `-F image=@photo.webp` sends `application/octet-stream` — and a
 * non-`image/` data URL is not parseable as one (`parseImageDataUrl`), so an
 * unusable MIME falls back to the payload's own signature rather than failing
 * the upload later with a URL-parsing error.
 */
export function imageReferenceFromBuffer(data: Buffer, mimeType?: string): UnifiedImageReference {
  const mediaType = mimeType?.startsWith('image/') ? mimeType : sniffImageMediaType(data);
  return {
    type: 'image_url',
    image_url: { url: `data:${mediaType};base64,${data.toString('base64')}` },
    media_type: mediaType,
  };
}

/**
 * Converts a legacy multipart edit request into the single image IR.
 *
 * @deprecated Only the `Dispatcher.dispatchImageEdits` facade still needs this;
 * new callers should build a `UnifiedImageGenerationRequest` directly.
 */
export function editRequestToGenerationRequest(
  request: UnifiedImageEditRequest
): UnifiedImageGenerationRequest {
  return {
    requestId: request.requestId,
    model: request.model,
    prompt: request.prompt,
    n: request.n,
    size: request.size,
    response_format: request.response_format,
    quality: request.quality,
    user: request.user,
    input_references: [imageReferenceFromBuffer(request.image, request.mimeType)],
    ...(request.mask ? { mask: imageReferenceFromBuffer(request.mask, request.maskMimeType) } : {}),
    incomingApiType: request.incomingApiType,
    originalBody: request.originalBody,
    metadata: request.metadata,
  };
}

function buildOpenAIGenerationRequest(request: UnifiedImageGenerationRequest): Record<string, any> {
  const payload: Record<string, any> = {
    model: request.model,
    prompt: request.prompt,
  };

  const size = resolveOpenAISize(request);
  if (size !== undefined) payload.size = size;
  if (request.n !== undefined) payload.n = request.n;
  if (request.response_format !== undefined) payload.response_format = request.response_format;
  if (request.quality !== undefined && request.quality !== 'auto')
    payload.quality = request.quality;
  if (request.style !== undefined) payload.style = request.style;
  if (request.user !== undefined) payload.user = request.user;
  if (request.output_format !== undefined) payload.output_format = request.output_format;
  if (request.background !== undefined) payload.background = request.background;
  if (request.output_compression !== undefined) {
    payload.output_compression = request.output_compression;
  }
  if (request.seed !== undefined) payload.seed = request.seed;

  return payload;
}

export class ImageTransformer {
  name = 'image';
  defaultEndpoint = '/images/generations';

  getEndpoint(request: UnifiedImageGenerationRequest): string {
    return request.input_references && request.input_references.length > 0
      ? '/images/edits'
      : this.defaultEndpoint;
  }

  async parseGenerationRequest(input: any): Promise<UnifiedImageGenerationRequest> {
    return {
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
      resolution: input.resolution,
      aspect_ratio: input.aspect_ratio,
      response_format: input.response_format,
      quality: input.quality,
      style: input.style,
      output_format: input.output_format,
      background: input.background,
      output_compression: input.output_compression,
      seed: input.seed,
      stream: input.stream,
      input_references: input.input_references,
      provider: input.provider,
      user: input.user,
      requestId: input.requestId,
      incomingApiType: input.incomingApiType,
      originalBody: input.originalBody,
    };
  }

  async parseOpenRouterGenerationRequest(input: any): Promise<UnifiedImageGenerationRequest> {
    validateOpenRouterRequest(input);
    const parsed = await this.parseGenerationRequest(input);
    return {
      ...parsed,
      response_format: input.response_format ?? 'b64_json',
      incomingApiType: input.incomingApiType ?? 'images',
      originalBody: input.originalBody ?? input,
    };
  }

  async transformGenerationRequest(
    request: UnifiedImageGenerationRequest,
    signal?: AbortSignal
  ): Promise<any> {
    if (request.input_references && request.input_references.length > 0) {
      return buildOpenAIReferenceRequest(request, signal);
    }
    return buildOpenAIGenerationRequest(request);
  }

  async transformGenerationResponse(
    response: any,
    _request?: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    return {
      created: response.created ?? Math.floor(Date.now() / 1000),
      data: Array.isArray(response.data)
        ? response.data.map((item: any) => ({
            ...(item.url !== undefined ? { url: item.url } : {}),
            ...(item.b64_json !== undefined ? { b64_json: item.b64_json } : {}),
            ...(item.media_type !== undefined ? { media_type: item.media_type } : {}),
            ...(item.revised_prompt !== undefined ? { revised_prompt: item.revised_prompt } : {}),
          }))
        : [],
      usage: normalizeImageUsage(response.usage),
    };
  }

  /** @deprecated Multipart edits are parsed into `UnifiedImageGenerationRequest` by the route. */
  async parseEditRequest(input: any): Promise<Partial<UnifiedImageEditRequest>> {
    return {
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
      response_format: input.response_format,
      quality: input.quality,
      user: input.user,
    };
  }

  /** @deprecated Superseded by `transformGenerationRequest`, which builds the same form. */
  async transformEditRequest(request: UnifiedImageEditRequest): Promise<FormData> {
    const formData = new FormData();

    formData.append('model', request.model);
    formData.append('prompt', request.prompt);

    if (request.n !== undefined) formData.append('n', request.n.toString());
    if (request.size !== undefined) formData.append('size', request.size);
    if (request.response_format !== undefined)
      formData.append('response_format', request.response_format);
    if (request.quality !== undefined) formData.append('quality', request.quality);
    if (request.user !== undefined) formData.append('user', request.user);

    const imageBuffer = new Uint8Array(request.image);
    const imageBlob = new Blob([imageBuffer], { type: request.mimeType });
    formData.append('image', imageBlob, request.filename);

    if (request.mask && request.maskFilename) {
      const maskBuffer = new Uint8Array(request.mask);
      const maskBlob = new Blob([maskBuffer], { type: request.maskMimeType || 'image/png' });
      formData.append('mask', maskBlob, request.maskFilename);
    }

    return formData;
  }

  /** @deprecated Superseded by `transformGenerationResponse`. */
  async transformEditResponse(response: any): Promise<UnifiedImageEditResponse> {
    return {
      created: response.created ?? Math.floor(Date.now() / 1000),
      data: Array.isArray(response.data)
        ? response.data.map((item: any) => ({
            ...(item.url !== undefined ? { url: item.url } : {}),
            ...(item.b64_json !== undefined ? { b64_json: item.b64_json } : {}),
            ...(item.media_type !== undefined ? { media_type: item.media_type } : {}),
            ...(item.revised_prompt !== undefined ? { revised_prompt: item.revised_prompt } : {}),
          }))
        : [],
      usage: normalizeImageUsage(response.usage),
    };
  }

  formatResponse(response: UnifiedImageGenerationResponse | UnifiedImageEditResponse): any {
    return response;
  }
}
