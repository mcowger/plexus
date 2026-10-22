import { describe, expect, it, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import type { UnifiedImageGenerationRequest } from '../../types/unified';
import { ImageRequestValidationError } from '../image';
import { CodexImageTransformer } from '../images/codex';

const BASE_REQUEST: UnifiedImageGenerationRequest = {
  model: 'gpt-image-1',
  prompt: 'A red panda astronaut',
};

async function rejection(promise: Promise<unknown>): Promise<ImageRequestValidationError> {
  try {
    await promise;
  } catch (error) {
    return error as ImageRequestValidationError;
  }
  throw new Error('expected the transform to reject');
}

function thrown(run: () => unknown): ImageRequestValidationError {
  try {
    run();
  } catch (error) {
    return error as ImageRequestValidationError;
  }
  throw new Error('expected the call to throw');
}

function mockRemoteImage(bytes: number[], contentType: string) {
  const spy = registerSpy(globalThis, 'fetch');
  spy.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(bytes.length) }),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });
  return spy;
}

describe('CodexImageTransformer', () => {
  const transformer = new CodexImageTransformer();

  describe('endpoints', () => {
    test('uses the generations endpoint without input references', () => {
      expect(transformer.name).toBe('codex-images');
      expect(transformer.defaultEndpoint).toBe('/images/generations');
      expect(transformer.getEndpoint(BASE_REQUEST)).toBe('/images/generations');
      expect(transformer.getEndpoint({ ...BASE_REQUEST, input_references: [] })).toBe(
        '/images/generations'
      );
    });

    test('uses the edits endpoint when input references are present', () => {
      expect(
        transformer.getEndpoint({
          ...BASE_REQUEST,
          input_references: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
          ],
        })
      ).toBe('/images/edits');
    });

    test('rejects streaming with 501', () => {
      const error = thrown(() => transformer.getEndpoint({ ...BASE_REQUEST, stream: true }));
      expect(error).toBeInstanceOf(ImageRequestValidationError);
      expect(error.routingContext.statusCode).toBe(501);
    });
  });

  describe('generation payload', () => {
    test('builds the Codex generation JSON from the unified IR', async () => {
      const result = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        size: '1024x1024',
        n: 2,
        quality: 'high',
        background: 'transparent',
        response_format: 'b64_json',
        originalBody: { model: 'wrong-model', unsupported_field: 'not-forwarded' },
      });

      expect(result).toEqual({
        prompt: 'A red panda astronaut',
        model: 'gpt-image-1',
        size: '1024x1024',
        n: 2,
        quality: 'high',
        background: 'transparent',
      });
    });

    test('omits unset options so upstream defaults apply', async () => {
      expect(await transformer.transformGenerationRequest(BASE_REQUEST)).toEqual({
        prompt: 'A red panda astronaut',
        model: 'gpt-image-1',
      });
    });

    test("forwards the literal 'auto' quality and size that OpenAI targets drop", async () => {
      expect(
        await transformer.transformGenerationRequest({
          ...BASE_REQUEST,
          size: 'auto',
          quality: 'auto',
          background: 'auto',
        })
      ).toEqual({
        prompt: 'A red panda astronaut',
        model: 'gpt-image-1',
        size: 'auto',
        quality: 'auto',
        background: 'auto',
      });
    });

    test('keeps n as the client sent it', async () => {
      const result = await transformer.transformGenerationRequest({ ...BASE_REQUEST, n: 4 });
      expect(result.n).toBe(4);
    });
  });

  describe('size resolution', () => {
    test('maps tier-valued size and resolution through the shared tier table', async () => {
      const fromSize = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        size: '2K',
      });
      expect(fromSize.size).toBe('2048x2048');

      const fromResolution = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        resolution: '1K',
      });
      expect(fromResolution.size).toBe('1024x1024');
    });

    test('prefers an explicit size over aspect ratio and resolution', async () => {
      const result = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        size: '1536x1024',
        aspect_ratio: '1:1',
        resolution: '4K',
      });
      expect(result.size).toBe('1536x1024');
    });

    test('maps supported aspect ratios to Codex sizes by orientation', async () => {
      const expected: Record<string, string> = {
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

      for (const [aspectRatio, size] of Object.entries(expected)) {
        const result = await transformer.transformGenerationRequest({
          ...BASE_REQUEST,
          aspect_ratio: aspectRatio,
        });
        expect(result.size, `aspect_ratio ${aspectRatio}`).toBe(size);
      }
    });

    test("omits size for aspect_ratio 'auto'", async () => {
      const result = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        aspect_ratio: 'auto',
      });
      expect(result).not.toHaveProperty('size');
    });

    test('rejects an aspect ratio Codex cannot express', async () => {
      const error = await rejection(
        transformer.transformGenerationRequest({ ...BASE_REQUEST, aspect_ratio: '1:8' })
      );
      expect(error).toBeInstanceOf(ImageRequestValidationError);
      expect(error.routingContext.statusCode).toBe(400);
      expect(error.message).toContain('1:8');
    });
  });

  describe('unsupported options', () => {
    const cases: Array<[string, Partial<UnifiedImageGenerationRequest>]> = [
      ['response_format url', { response_format: 'url' }],
      ['output_format', { output_format: 'webp' }],
      ['output_compression', { output_compression: 80 }],
      ['seed', { seed: 42 }],
      ['style', { style: 'vivid' }],
      ['user', { user: 'user-123' }],
      ['mask', { mask: { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } }],
    ];

    test.each(cases)('rejects %s with an explicit 400', async (_label, overrides) => {
      const error = await rejection(
        transformer.transformGenerationRequest({ ...BASE_REQUEST, ...overrides })
      );
      expect(error).toBeInstanceOf(ImageRequestValidationError);
      expect(error.routingContext.statusCode).toBe(400);
    });

    test('rejects unsupported options on edit requests too', async () => {
      const error = await rejection(
        transformer.transformGenerationRequest({
          ...BASE_REQUEST,
          seed: 7,
          input_references: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
          ],
        })
      );
      expect(error.routingContext.statusCode).toBe(400);
    });

    test("accepts response_format 'b64_json'", async () => {
      await expect(
        transformer.transformGenerationRequest({ ...BASE_REQUEST, response_format: 'b64_json' })
      ).resolves.toBeDefined();
    });
  });

  describe('edit payload', () => {
    test('re-encodes inline and remote references as data URLs with auto defaults', async () => {
      const fetchSpy = mockRemoteImage([1, 2, 3], 'image/webp');

      const result = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        input_references: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
          { type: 'image_url', image_url: { url: 'https://example.com/reference.webp' } },
        ],
      });

      expect(result).toEqual({
        images: [
          { image_url: 'data:image/png;base64,AA==' },
          { image_url: 'data:image/webp;base64,AQID' },
        ],
        prompt: 'A red panda astronaut',
        model: 'gpt-image-1',
        background: 'auto',
        quality: 'auto',
        size: 'auto',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toBe('https://example.com/reference.webp');
    });

    test('lets client values override the auto defaults', async () => {
      const result = await transformer.transformGenerationRequest({
        ...BASE_REQUEST,
        quality: 'low',
        background: 'opaque',
        aspect_ratio: '16:9',
        n: 2,
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
      });

      expect(result).toEqual({
        images: [{ image_url: 'data:image/png;base64,AA==' }],
        prompt: 'A red panda astronaut',
        model: 'gpt-image-1',
        background: 'opaque',
        quality: 'low',
        size: '1536x1024',
        n: 2,
      });
    });

    test('rejects more than five references without downloading them', async () => {
      const fetchSpy = registerSpy(globalThis, 'fetch');
      const references = Array.from({ length: 6 }, () => ({
        type: 'image_url' as const,
        image_url: { url: 'https://example.com/reference.png' },
      }));

      const error = await rejection(
        transformer.transformGenerationRequest({ ...BASE_REQUEST, input_references: references })
      );

      expect(error).toBeInstanceOf(ImageRequestValidationError);
      expect(error.routingContext.statusCode).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('response normalization', () => {
    test('normalizes images, media type, and usage details', async () => {
      const result = await transformer.transformGenerationResponse({
        created: 1748372400,
        data: [{ b64_json: 'AA==' }, { b64_json: 'AQID' }],
        background: 'opaque',
        quality: 'high',
        size: '1024x1024',
        output_format: 'png',
        usage: {
          input_tokens: 12,
          output_tokens: 4160,
          total_tokens: 4172,
          input_tokens_details: { image_tokens: 8, text_tokens: 4 },
          output_tokens_details: { image_tokens: 4160 },
        },
      });

      expect(result).toEqual<unknown>({
        created: 1748372400,
        data: [
          { b64_json: 'AA==', media_type: 'image/png' },
          { b64_json: 'AQID', media_type: 'image/png' },
        ],
        usage: {
          input_tokens: 12,
          prompt_tokens: 12,
          output_tokens: 4160,
          completion_tokens: 4160,
          total_tokens: 4172,
          input_tokens_details: { image_tokens: 8, text_tokens: 4 },
          output_tokens_details: { image_tokens: 4160 },
        },
      });
    });

    test('maps every known output format and never guesses an unknown one', async () => {
      const mediaTypeFor = async (outputFormat?: string) => {
        const result = await transformer.transformGenerationResponse({
          created: 1,
          data: [{ b64_json: 'AA==' }],
          ...(outputFormat !== undefined ? { output_format: outputFormat } : {}),
        });
        return result.data[0]!.media_type;
      };

      expect(await mediaTypeFor('png')).toBe('image/png');
      expect(await mediaTypeFor('jpeg')).toBe('image/jpeg');
      expect(await mediaTypeFor('jpg')).toBe('image/jpeg');
      expect(await mediaTypeFor('webp')).toBe('image/webp');
      expect(await mediaTypeFor('avif')).toBeUndefined();
      expect(await mediaTypeFor()).toBeUndefined();
    });

    test('stamps a receipt timestamp when the upstream omits created', async () => {
      const before = Math.floor(Date.now() / 1000);
      const result = await transformer.transformGenerationResponse({
        data: [{ b64_json: 'AA==' }],
        output_format: 'png',
      });
      expect(result.created).toBeGreaterThanOrEqual(before);
      expect(result.usage).toBeUndefined();
    });

    test('rejects a response without image data as an upstream 502', async () => {
      const empty = await rejection(
        transformer.transformGenerationResponse({ created: 1748372400, data: [] })
      );
      expect(empty).toBeInstanceOf(ImageRequestValidationError);
      expect(empty.routingContext.statusCode).toBe(502);

      const withoutBytes = await rejection(
        transformer.transformGenerationResponse({ created: 1748372400, data: [{ url: 'x' }] })
      );
      expect(withoutBytes.routingContext.statusCode).toBe(502);

      const emptyBytes = await rejection(
        transformer.transformGenerationResponse({ created: 1748372400, data: [{ b64_json: '' }] })
      );
      expect(emptyBytes.routingContext.statusCode).toBe(502);
    });
  });
});
