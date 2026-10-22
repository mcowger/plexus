import { describe, expect, it, test } from 'bun:test';

import { GeminiImageTransformer } from '../images/gemini';

describe('GeminiImageTransformer', () => {
  const transformer = new GeminiImageTransformer();

  test('builds a native Gemini image request from the unified image IR', async () => {
    const result = await transformer.transformGenerationRequest({
      model: 'gemini-2.5-flash-image',
      prompt: 'A watercolor fox',
      resolution: '2K',
      aspect_ratio: '16:9',
      input_references: [
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AA==' },
        },
      ],
    });

    expect(result).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'A watercolor fox' },
            { inlineData: { mimeType: 'image/png', data: 'AA==' } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      },
    });
  });

  test('builds the model endpoint and Gemini auth header', () => {
    expect(transformer.getEndpoint({ model: 'gemini-2.5-flash-image', prompt: 'test' })).toBe(
      '/v1beta/models/gemini-2.5-flash-image:generateContent'
    );

    const headers: Record<string, string> = {};
    transformer.getAuthHeaders!('gemini-key', headers);
    expect(headers).toEqual({ 'x-goog-api-key': 'gemini-key' });
  });

  test('normalizes Gemini inline image parts and usage', async () => {
    const result = await transformer.transformGenerationResponse({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 16,
        totalTokenCount: 20,
      },
    });

    expect(result.data).toEqual([{ b64_json: 'AA==', media_type: 'image/png' }]);
    expect(result.usage).toEqual({
      input_tokens: 4,
      output_tokens: 16,
      total_tokens: 20,
    });
  });

  test('rejects an inpainting mask instead of silently dropping it', async () => {
    await expect(
      transformer.transformGenerationRequest({
        model: 'gemini-2.5-flash-image',
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
