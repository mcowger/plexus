import { beforeEach, describe, expect, it } from 'bun:test';

import { editRequestToGenerationRequest, ImageTransformer } from '../image';

describe('ImageTransformer', () => {
  let transformer: ImageTransformer;

  beforeEach(() => {
    transformer = new ImageTransformer();
  });

  describe('parseGenerationRequest', () => {
    it('should parse valid OpenAI image generation request', async () => {
      const request = {
        model: 'dall-e-3',
        prompt: 'A white siamese cat',
        n: 1,
        size: '1024x1024',
        response_format: 'url',
        quality: 'standard',
        style: 'vivid',
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.model).toBe('dall-e-3');
      expect(result.prompt).toBe('A white siamese cat');
      expect(result.n).toBe(1);
      expect(result.size).toBe('1024x1024');
      expect(result.response_format).toBe('url');
      expect(result.quality).toBe('standard');
      expect(result.style).toBe('vivid');
    });

    it('should parse minimal request with required fields only', async () => {
      const request = {
        model: 'flux-1-schnell',
        prompt: 'A beautiful sunset',
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.model).toBe('flux-1-schnell');
      expect(result.prompt).toBe('A beautiful sunset');
      expect(result.n).toBeUndefined();
      expect(result.size).toBeUndefined();
    });

    it('should handle request with user field', async () => {
      const request = {
        model: 'gpt-image-1',
        prompt: 'Test image',
        user: 'user_123',
      };

      const result = await transformer.parseGenerationRequest(request);

      expect(result.user).toBe('user_123');
    });
  });

  describe('transformGenerationRequest', () => {
    it('should transform request for provider passthrough', async () => {
      const request = {
        model: 'dall-e-3',
        prompt: 'A cute baby sea otter',
        n: 1,
        size: '1024x1024',
        response_format: 'url' as const,
      };

      const result = await transformer.transformGenerationRequest(request);

      expect(result.model).toBe('dall-e-3');
      expect(result.prompt).toBe('A cute baby sea otter');
      expect(result.n).toBe(1);
      expect(result.size).toBe('1024x1024');
      expect(result.response_format).toBe('url');
    });

    it('should pass through all optional parameters', async () => {
      const request = {
        model: 'gpt-image-1.5',
        prompt: 'Test',
        quality: 'high',
        style: 'natural',
        user: 'user_456',
      };

      const result = await transformer.transformGenerationRequest(request);

      expect(result.quality).toBe('high');
      expect(result.style).toBe('natural');
      expect(result.user).toBe('user_456');
    });
  });

  describe('transformGenerationResponse', () => {
    it('should handle url response format', async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            url: 'https://example.com/image.png',
            revised_prompt: 'A white siamese cat sitting on a couch',
          },
        ],
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.created).toBe(1713833628);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.url).toBe('https://example.com/image.png');
      expect(result.data[0]?.revised_prompt).toBe('A white siamese cat sitting on a couch');
    });

    it('should handle b64_json response format', async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        ],
        usage: {
          input_tokens: 50,
          output_tokens: 100,
          total_tokens: 150,
        },
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.data[0]?.b64_json).toBeDefined();
      expect(result.usage?.total_tokens).toBe(150);
    });

    it('should handle multiple images', async () => {
      const response = {
        created: 1713833628,
        data: [
          { url: 'https://example.com/image1.png' },
          { url: 'https://example.com/image2.png' },
        ],
      };

      const result = await transformer.transformGenerationResponse(response);

      expect(result.data).toHaveLength(2);
    });
  });

  describe('parseEditRequest', () => {
    it('should parse image edit request fields', async () => {
      const request = {
        model: 'gpt-image-1.5',
        prompt: 'Add a hat to the person',
        n: 2,
        size: '1024x1024',
        response_format: 'url',
      };

      const result = await transformer.parseEditRequest(request);

      expect(result.model).toBe('gpt-image-1.5');
      expect(result.prompt).toBe('Add a hat to the person');
      expect(result.n).toBe(2);
      expect(result.size).toBe('1024x1024');
      expect(result.response_format).toBe('url');
    });

    it('should handle minimal edit request', async () => {
      const request = {
        model: 'dall-e-2',
        prompt: 'Change background to blue',
      };

      const result = await transformer.parseEditRequest(request);

      expect(result.model).toBe('dall-e-2');
      expect(result.prompt).toBe('Change background to blue');
    });
  });

  describe('transformEditRequest', () => {
    it('should transform to FormData with image', async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const request = {
        model: 'gpt-image-1.5',
        prompt: 'Add sunglasses',
        image: imageBuffer,
        filename: 'input.png',
        mimeType: 'image/png',
        n: 1,
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result).toBeInstanceOf(FormData);
      expect(result.get('model')).toBe('gpt-image-1.5');
      expect(result.get('prompt')).toBe('Add sunglasses');
      expect(result.get('n')).toBe('1');
    });

    it('should include optional parameters in FormData', async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const request = {
        model: 'gpt-image-1.5',
        prompt: 'Edit the image',
        image: imageBuffer,
        filename: 'input.png',
        mimeType: 'image/png',
        size: '1024x1024',
        response_format: 'b64_json',
        quality: 'high',
        user: 'user_123',
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result.get('size')).toBe('1024x1024');
      expect(result.get('response_format')).toBe('b64_json');
      expect(result.get('quality')).toBe('high');
      expect(result.get('user')).toBe('user_123');
    });

    it('should include mask when provided', async () => {
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const maskBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const request = {
        model: 'gpt-image-1',
        prompt: 'Edit masked area',
        image: imageBuffer,
        filename: 'input.png',
        mimeType: 'image/png',
        mask: maskBuffer,
        maskFilename: 'mask.png',
        maskMimeType: 'image/png',
      };

      const result = await transformer.transformEditRequest(request as any);

      expect(result.get('mask')).toBeDefined();
    });
  });

  describe('transformEditResponse', () => {
    it('should handle image edit response', async () => {
      const response = {
        created: 1713833628,
        data: [
          {
            url: 'https://example.com/edited.png',
            revised_prompt: 'Person with sunglasses',
          },
        ],
      };

      const result = await transformer.transformEditResponse(response);

      expect(result.created).toBe(1713833628);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.url).toBe('https://example.com/edited.png');
      expect(result.data[0]?.revised_prompt).toBe('Person with sunglasses');
    });

    it('should handle edit response with usage', async () => {
      const response = {
        created: 1713833628,
        data: [{ b64_json: 'base64data' }],
        usage: {
          input_tokens: 75,
          output_tokens: 150,
          total_tokens: 225,
        },
      };

      const result = await transformer.transformEditResponse(response);

      expect(result.usage?.total_tokens).toBe(225);
    });
  });

  describe('formatResponse', () => {
    it('should return response as-is for passthrough', async () => {
      const response = {
        created: 1713833628,
        data: [{ url: 'https://example.com/image.png' }],
      };

      const result = await transformer.formatResponse(response);

      expect(result).toEqual(response);
    });
  });

  describe('defaultEndpoint', () => {
    it('should have correct default endpoint', () => {
      expect(transformer.defaultEndpoint).toBe('/images/generations');
    });
  });

  describe('name', () => {
    it('should have correct transformer name', () => {
      expect(transformer.name).toBe('image');
    });
  });

  describe('transformGenerationRequest with input references', () => {
    it('appends the mask to the multipart edit form', async () => {
      const result = (await transformer.transformGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Repaint the masked area',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }],
        mask: { type: 'image_url', image_url: { url: 'data:image/png;base64,/w==' } },
      })) as FormData;

      expect(result).toBeInstanceOf(FormData);
      expect(result.get('image')).toBeInstanceOf(Blob);

      const mask = result.get('mask') as Blob;
      expect(mask).toBeInstanceOf(Blob);
      expect(mask.type).toBe('image/png');
      expect(new Uint8Array(await mask.arrayBuffer())).toEqual(new Uint8Array([0xff]));
    });

    it('omits the mask field when no mask was supplied', async () => {
      const result = (await transformer.transformGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add sunglasses',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }],
      })) as FormData;

      expect(result.get('mask')).toBeNull();
    });

    it('omits response_format when the client did not supply one', async () => {
      const result = (await transformer.transformGenerationRequest({
        model: 'dall-e-2',
        prompt: 'Add sunglasses',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }],
      })) as FormData;

      expect(result.get('response_format')).toBeNull();
    });

    it('forwards response_format when the client supplied one', async () => {
      const result = (await transformer.transformGenerationRequest({
        model: 'dall-e-2',
        prompt: 'Add sunglasses',
        response_format: 'url',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }],
      })) as FormData;

      expect(result.get('response_format')).toBe('url');
    });

    it('appends a single image field named image for one reference (N=1 shape unchanged)', async () => {
      const result = (await transformer.transformGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add sunglasses',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBO' } }],
      })) as FormData;

      const image = result.get('image');
      expect(image).toBeInstanceOf(Blob);
      expect(result.getAll('image[]')).toEqual([]);
    });

    it('appends one image[] field per reference for multiple references (N=2 shape)', async () => {
      const first = {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBO' },
      } as const;
      const second = {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,/w==' },
      } as const;
      const result = (await transformer.transformGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add sunglasses',
        input_references: [first, second],
      })) as FormData;

      const parts = result.getAll('image[]');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBeInstanceOf(Blob);
      expect(parts[1]).toBeInstanceOf(Blob);
      const bytes = new Uint8Array(await (parts[1] as Blob).arrayBuffer());
      expect(Array.from(bytes)).toEqual([0xff]);
      expect(result.get('image')).toBeNull();
    });

    it('rejects more than the reference cap', async () => {
      const reference = {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBO' },
      } as const;

      const pending = transformer.transformGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add sunglasses',
        input_references: Array.from({ length: 17 }, () => reference),
      });

      const error = await pending.catch((e: unknown) => e);
      expect((error as Error).message).toContain('at most 16 input references');
    });
  });

  describe('editRequestToGenerationRequest', () => {
    it('converts multipart buffers into image references', () => {
      const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const mask = Buffer.from([0x01, 0x02, 0x03]);

      const result = editRequestToGenerationRequest({
        requestId: 'req-1',
        model: 'gpt-image-1',
        prompt: 'Add a hat',
        image,
        filename: 'input.webp',
        mimeType: 'image/webp',
        mask,
        maskFilename: 'mask.png',
        maskMimeType: 'image/png',
        n: 2,
        size: '1024x1024',
        response_format: 'b64_json',
        quality: 'high',
        user: 'user_123',
        incomingApiType: 'images',
        originalBody: { prompt: 'Add a hat' },
      });

      expect(result).toEqual({
        requestId: 'req-1',
        model: 'gpt-image-1',
        prompt: 'Add a hat',
        n: 2,
        size: '1024x1024',
        response_format: 'b64_json',
        quality: 'high',
        user: 'user_123',
        input_references: [
          {
            type: 'image_url',
            image_url: { url: `data:image/webp;base64,${image.toString('base64')}` },
            media_type: 'image/webp',
          },
        ],
        mask: {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${mask.toString('base64')}` },
          media_type: 'image/png',
        },
        incomingApiType: 'images',
        originalBody: { prompt: 'Add a hat' },
      });
    });

    it('sniffs the media type when the upload carries no image MIME', () => {
      const webp = Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0x1a, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'latin1'),
        Buffer.from('payload', 'latin1'),
      ]);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

      const result = editRequestToGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add a hat',
        image: webp,
        filename: 'photo.webp',
        mimeType: 'application/octet-stream',
        mask: png,
        maskFilename: 'mask.png',
        maskMimeType: 'application/octet-stream',
      });

      expect(result.input_references?.[0]).toEqual({
        type: 'image_url',
        image_url: { url: `data:image/webp;base64,${webp.toString('base64')}` },
        media_type: 'image/webp',
      });
      expect(result.mask?.media_type).toBe('image/png');
    });

    it('falls back to png when the bytes match no known image signature', () => {
      const result = editRequestToGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Add a hat',
        image: Buffer.from('not-an-image', 'latin1'),
        filename: 'blob.bin',
        mimeType: 'application/octet-stream',
      });

      expect(result.input_references?.[0]?.media_type).toBe('image/png');
    });

    it('omits the mask and carries the key access policy metadata', () => {
      const metadata = {
        plexus_metadata: { plexus_key_policy: { allowedModels: ['gpt-image-1'] } },
      } as any;

      const result = editRequestToGenerationRequest({
        model: 'gpt-image-1',
        prompt: 'Change background to blue',
        image: Buffer.from([0x01]),
        filename: 'input.png',
        mimeType: 'image/png',
        metadata,
      });

      expect(result.mask).toBeUndefined();
      expect(result.metadata).toBe(metadata);
      expect(result.input_references).toEqual([
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AQ==' },
          media_type: 'image/png',
        },
      ]);
    });
  });
});
