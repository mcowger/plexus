import { describe, expect, it } from 'vitest';

import type { MessageContent, UnifiedChatRequest } from '../../../types/unified';
import { buildAnthropicRequest } from '../request-builder';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function requestWithImage(
  url: string,
  extra: Partial<Extract<MessageContent, { type: 'image_url' }>> = {}
): UnifiedChatRequest {
  return {
    model: 'claude-sonnet-5-5',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url }, ...extra },
        ],
      },
    ],
    max_tokens: 1024,
  } satisfies UnifiedChatRequest;
}

async function imageBlock(request: UnifiedChatRequest) {
  const payload = await buildAnthropicRequest(request);
  return payload.messages[0].content[1];
}

describe('buildAnthropicRequest image_url conversion', () => {
  it('forwards base64 data URIs with their media type and bytes', async () => {
    const block = await imageBlock(requestWithImage(`data:image/png;base64,${PNG_B64}`));

    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_B64 },
    });
  });

  it('keeps the whole payload of a large data URI intact', async () => {
    const big = 'A'.repeat(300_000);
    const block = await imageBlock(requestWithImage(`data:image/png;base64,${big}`));

    expect(block.source.data).toHaveLength(big.length);
  });

  it('prefers the data URI media type over the part media_type', async () => {
    const block = await imageBlock(
      requestWithImage(`data:image/webp;base64,${PNG_B64}`, { media_type: 'image/jpeg' })
    );

    expect(block.source.media_type).toBe('image/webp');
  });

  it('falls back to the part media_type when the data URI has none', async () => {
    const block = await imageBlock(
      requestWithImage(`data:;base64,${PNG_B64}`, { media_type: 'image/gif' })
    );

    expect(block.source).toEqual({ type: 'base64', media_type: 'image/gif', data: PNG_B64 });
  });

  it('tolerates extra data URI parameters before ;base64', async () => {
    const block = await imageBlock(requestWithImage(`data:image/png;name=a.png;base64,${PNG_B64}`));

    expect(block.source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });
  });

  it('forwards http(s) URLs as url sources', async () => {
    const block = await imageBlock(requestWithImage('https://example.com/cat.png'));

    expect(block.source).toEqual({ type: 'url', url: 'https://example.com/cat.png' });
  });

  it('preserves cache_control on image blocks', async () => {
    const block = await imageBlock(
      requestWithImage(`data:image/png;base64,${PNG_B64}`, { cache_control: { type: 'ephemeral' } })
    );

    expect(block.cache_control).toEqual({ type: 'ephemeral' });
  });

  it.each([
    ['empty payload', 'data:image/png;base64,'],
    ['non-base64 data URI', 'data:image/svg+xml,%3Csvg%2F%3E'],
    ['unsupported scheme', 'file:///tmp/a.png'],
    ['empty url', ''],
  ])('rejects %s with a 400 instead of sending an empty image', async (_label, url) => {
    await expect(buildAnthropicRequest(requestWithImage(url))).rejects.toMatchObject({
      message: expect.stringContaining('Unsupported image_url'),
      routingContext: { statusCode: 400, code: 'invalid_request_error' },
    });
  });
});
