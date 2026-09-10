import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../openai';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildAnthropicRequest, buildAnthropicImageBlock } from '../anthropic/request-builder';
import type { UnifiedChatRequest } from '../../types/unified';

/**
 * Regression tests for image content parts in the Anthropic request builder.
 *
 * The unified schema carries images as OpenAI-style `image_url` parts whose
 * `url` is either a `data:` URL with inline base64 or an `http(s)` URL.
 * The builder used to emit a base64 image source with `data: ''` regardless
 * of input, which Anthropic rejects:
 *
 *   400 invalid_request_error
 *   "messages.N.content.M.image.source.base64: image cannot be empty"
 *
 * so any chat-completions client attaching an image to a Claude target 400'd.
 */

// 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function unified(messages: UnifiedChatRequest['messages']): UnifiedChatRequest {
  return { model: 'claude-fable-5-1', messages } as UnifiedChatRequest;
}

describe('buildAnthropicImageBlock', () => {
  it('converts a base64 data URL into a base64 image source', () => {
    const block = buildAnthropicImageBlock({
      image_url: { url: `data:image/png;base64,${PNG_B64}` },
    });

    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_B64 },
    });
  });

  it('prefers an explicit media_type over the one in the data URL', () => {
    const block = buildAnthropicImageBlock({
      image_url: { url: `data:image/png;base64,${PNG_B64}` },
      media_type: 'image/webp',
    });

    expect(block?.source.media_type).toBe('image/webp');
  });

  it('falls back to image/jpeg when the data URL carries no MIME type', () => {
    const block = buildAnthropicImageBlock({
      image_url: { url: `data:;base64,${PNG_B64}` },
    });

    expect(block?.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: PNG_B64 });
  });

  it('converts an http(s) URL into a url image source', () => {
    const block = buildAnthropicImageBlock({
      image_url: { url: 'https://example.com/cat.png' },
    });

    expect(block).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/cat.png' },
    });
  });

  it('returns undefined rather than an empty payload for a data URL with no bytes', () => {
    expect(
      buildAnthropicImageBlock({ image_url: { url: 'data:image/png;base64,' } })
    ).toBeUndefined();
    expect(
      buildAnthropicImageBlock({ image_url: { url: 'data:image/png;base64,   ' } })
    ).toBeUndefined();
  });

  it('returns undefined for a non-base64 data URL (Anthropic only accepts base64 inline)', () => {
    expect(
      buildAnthropicImageBlock({ image_url: { url: 'data:text/plain,hello%20world' } })
    ).toBeUndefined();
  });

  it('returns undefined when there is no usable url at all', () => {
    expect(buildAnthropicImageBlock({})).toBeUndefined();
    expect(buildAnthropicImageBlock({ image_url: { url: '' } })).toBeUndefined();
    expect(
      buildAnthropicImageBlock({ image_url: { url: 'ftp://example.com/x.png' } })
    ).toBeUndefined();
  });
});

describe('Anthropic request builder — image content parts', () => {
  it('never emits an image block with empty base64 data', async () => {
    const built = await buildAnthropicRequest(
      unified([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
          ],
        },
      ])
    );

    const images = built.messages[0].content.filter((b: any) => b.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });
    // The precise shape Anthropic 400'd on before the fix.
    expect(images[0].source.data).not.toBe('');
  });

  it('keeps cache_control on the converted image block', async () => {
    const built = await buildAnthropicRequest(
      unified([
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${PNG_B64}` },
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ])
    );

    expect(built.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('drops an unusable image part but keeps the surrounding text', async () => {
    const built = await buildAnthropicRequest(
      unified([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' } },
            { type: 'text', text: 'after' },
          ],
        },
      ])
    );

    expect(built.messages[0].content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
    ]);
  });

  it('end-to-end: a chat-completions image_url part reaches Anthropic with its bytes intact', async () => {
    // Mirrors a coding client attaching a screenshot over OpenAI chat-completions
    // to a Claude alias — the case that used to 400 with "image cannot be empty".
    const chatRequest = {
      model: 'claude-fable-5-1',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this screenshot' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
          ],
        },
      ],
    };

    const parsed = await new OpenAITransformer().parseRequest(chatRequest);
    const built = await buildAnthropicRequest(parsed);

    const image = built.messages[0].content.find((b: any) => b.type === 'image');
    expect(image).toBeDefined();
    expect(image.source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });
  });

  it('messages -> messages round-trip preserves a base64 image byte-for-byte', async () => {
    const anthropicRequest = {
      model: 'claude-fable-5-1',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: PNG_B64 },
            },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    };

    const parsed = await parseAnthropicRequest(anthropicRequest);
    const built = await buildAnthropicRequest({
      ...parsed,
      incomingApiType: 'messages',
      originalBody: anthropicRequest,
    });

    const image = built.messages[0].content.find((b: any) => b.type === 'image');
    expect(image.source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });
  });
});
