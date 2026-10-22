import { describe, expect, it, test } from 'bun:test';

import { OpenRouterImageTransformer } from '../images/openrouter';

describe('OpenRouterImageTransformer', () => {
  const transformer = new OpenRouterImageTransformer();

  test('builds the dedicated OpenRouter image request without using the original body', async () => {
    const result = await transformer.transformGenerationRequest({
      model: 'bytedance-seed/seedream-4.5',
      prompt: 'A red panda astronaut',
      resolution: '2K',
      aspect_ratio: '16:9',
      output_format: 'png',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/reference.png' },
        },
      ],
      originalBody: {
        model: 'wrong-model',
        unsupported_field: 'not-forwarded',
      },
    });

    expect(result).toEqual({
      model: 'bytedance-seed/seedream-4.5',
      prompt: 'A red panda astronaut',
      resolution: '2K',
      aspect_ratio: '16:9',
      output_format: 'png',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/reference.png' },
        },
      ],
    });
  });

  test('uses the dedicated /images endpoint', () => {
    expect(transformer.getEndpoint({ model: 'image-model', prompt: 'test' })).toBe('/images');
  });

  test('normalizes the OpenRouter response and usage', async () => {
    const result = await transformer.transformGenerationResponse({
      created: 1748372400,
      data: [{ b64_json: 'AA==' }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 4175,
        total_tokens: 4175,
        cost: 0.04,
      },
    });

    expect(result).toEqual({
      created: 1748372400,
      data: [{ b64_json: 'AA==' }],
      usage: {
        prompt_tokens: 0,
        input_tokens: 0,
        completion_tokens: 4175,
        output_tokens: 4175,
        total_tokens: 4175,
        cost: 0.04,
      },
    });
  });

  test('rejects an inpainting mask instead of silently dropping it', async () => {
    await expect(
      transformer.transformGenerationRequest({
        model: 'bytedance-seed/seedream-4.5',
        prompt: 'Repaint the masked area',
        input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
        mask: { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('mask'),
      routingContext: expect.objectContaining({ statusCode: 400 }),
    });
  });
});
