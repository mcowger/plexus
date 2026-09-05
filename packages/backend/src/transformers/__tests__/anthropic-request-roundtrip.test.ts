import { describe, it, expect } from 'vitest';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildAnthropicRequest } from '../anthropic/request-builder';
import { ResponsesTransformer } from '../responses';
import { OpenAITransformer } from '../openai';

/**
 * Round-trip tests for the Anthropic (messages) transformer.
 *
 * These cover the regression where a same-format (messages -> messages)
 * transform dropped Anthropic-native fields that the unified schema does not
 * model:
 *   - top-level: thinking, output_config, metadata
 *   - per-block: cache_control on user/assistant text + image blocks
 *   - tool-level: eager_input_streaming (and other extra tool fields)
 */

// A representative Anthropic messages request, modelled on a real client
// payload (cache_control on user text, thinking config, output_config,
// metadata, and tools with eager_input_streaming).
const ANTHROPIC_REQUEST = {
  model: 'claude-sonnet-4-6',
  max_tokens: 64000,
  stream: true,
  system: [
    {
      type: 'text',
      text: 'You are a helpful assistant.',
      cache_control: { type: 'ephemeral' },
    },
  ],
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Three friends — Ada, Bo, and Cy — solve a puzzle.',
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
  ],
  thinking: {
    type: 'adaptive',
    display: 'summarized',
  },
  output_config: {
    effort: 'high',
  },
  metadata: {
    user_id: 'u-123',
  },
  tools: [
    {
      name: 'get_current_timestamp',
      description: 'Get the current Unix timestamp in seconds.',
      input_schema: { properties: {}, type: 'object' },
      eager_input_streaming: true,
    },
  ],
};

describe('Anthropic messages -> messages round-trip preserves native fields', () => {
  it('preserves top-level thinking, output_config, metadata (Fix #1)', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    });

    expect(built.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(built.output_config).toEqual({ effort: 'high' });
    expect(built.metadata).toEqual({ user_id: 'u-123' });
  });

  it('preserves cache_control on user text blocks (Fix #2)', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    });

    const userContent = built.messages[0].content;
    const textBlock = userContent.find((b: any) => b.type === 'text');
    expect(textBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('preserves cache_control on system text blocks', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    });

    const systemBlock = built.system[0];
    expect(systemBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('preserves eager_input_streaming on tools (Fix #3)', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    });

    const tool = built.tools[0];
    expect(tool.name).toBe('get_current_timestamp');
    expect(tool.input_schema).toEqual({ properties: {}, type: 'object' });
    expect(tool.eager_input_streaming).toBe(true);
  });

  it('does not pollute cross-format (non-messages) transforms with originalBody fields', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    // No incomingApiType/originalBody → cross-format path (e.g. chat -> messages)
    const built = await buildAnthropicRequest(unified);

    expect(built.thinking).toBeUndefined();
    expect(built.output_config).toBeUndefined();
    expect(built.metadata).toBeUndefined();
  });
});

describe('Anthropic reasoning intent normalization', () => {
  it('treats adaptive thinking as enabled and uses output effort', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });

    expect(unified.reasoning).toEqual({ effort: 'high', enabled: true, adaptive: true });
  });

  it('does not invent an effort when adaptive thinking has no budget or output effort', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
    });

    expect(unified.reasoning).toEqual({ enabled: true, adaptive: true });
  });

  it('does not retain an effort when thinking is explicitly disabled', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'high' },
    });

    expect(unified.reasoning).toEqual({ enabled: false });
  });

  it('maps a budgeted thinking request to effort and preserves the budget', async () => {
    const unified = await parseAnthropicRequest({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });

    expect(unified.reasoning).toEqual({
      effort: 'medium',
      max_tokens: 8192,
      enabled: true,
    });
  });
});

describe('Anthropic image source translation', () => {
  it('preserves cache_control on image blocks (Fix #2)', async () => {
    const requestWithImage = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    };

    const unified = await parseAnthropicRequest(requestWithImage);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: requestWithImage,
    });

    const imageBlock = built.messages[0].content.find((b: any) => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(imageBlock.source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    });
  });

  it('round-trips Anthropic URL image sources (not coerced to empty base64)', async () => {
    const requestWithUrlImage = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/shot.png' },
            },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    };

    const unified = await parseAnthropicRequest(requestWithUrlImage);
    const built = await buildAnthropicRequest(unified);

    expect(built.messages[0].content.find((b: any) => b.type === 'image').source).toEqual({
      type: 'url',
      url: 'https://example.com/shot.png',
    });
  });

  it('forwards chat-style data-URI image_url parts as Anthropic base64 sources', async () => {
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
              media_type: 'image/png',
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: 'what is in this screenshot?' },
          ],
        },
      ],
    });

    expect(built.messages[0].content.find((b: any) => b.type === 'image').source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    });
    expect(built.messages[0].content.find((b: any) => b.type === 'image').cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('forwards raw base64 image data as an Anthropic base64 source', async () => {
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'iVBORw0KGgo=' },
              media_type: 'image/png',
            },
          ],
        },
      ],
    });

    expect(built.messages[0].content[0].source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    });
  });

  it('forwards http:// image URLs as Anthropic url sources (spec has no scheme rule)', async () => {
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'http://example.com/shot.png' } }],
        },
      ],
    });

    expect(built.messages[0].content[0].source).toEqual({
      type: 'url',
      url: 'http://example.com/shot.png',
    });
  });

  it('forwards data-URI media types verbatim and leaves media-type validation to Anthropic', async () => {
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,PHN2Zz4=' } },
          ],
        },
      ],
    });

    expect(built.messages[0].content[0].source).toEqual({
      type: 'base64',
      media_type: 'image/svg+xml',
      data: 'PHN2Zz4=',
    });
  });

  it.each([
    ['a non-base64 data URI', { image_url: { url: 'data:image/png,not-base64' } }],
    ['an empty image URL', { image_url: { url: '' } }],
    ['a non-string image URL', { image_url: { url: 123 } }],
    ['a missing image_url', {}],
  ])('rejects %s', async (_label, imagePart) => {
    const request = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'image_url' as const, ...imagePart }],
        },
      ],
    };

    await expect(buildAnthropicRequest(request as any)).rejects.toMatchObject({
      message: expect.stringMatching(/invalid Anthropic image source/i),
      routingContext: {
        statusCode: 400,
        code: 'invalid_image_source',
      },
    });
  });
});

describe('Anthropic structured-output carry (text.format / response_format)', () => {
  const SCHEMA = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  };

  it('maps Responses text.format onto output_config.format (responses → messages)', async () => {
    const unified = await new ResponsesTransformer().parseRequest({
      model: 'claude-sonnet-4-6',
      input: 'hello',
      text: {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: SCHEMA,
          strict: true,
        },
      },
    });

    const built = await buildAnthropicRequest(unified);

    expect(built.output_config.format).toEqual({ type: 'json_schema', schema: SCHEMA });
  });

  it('maps Chat response_format onto output_config.format (chat → messages)', async () => {
    const unified = await new OpenAITransformer().parseRequest({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'result', schema: SCHEMA, strict: true },
      },
    });

    const built = await buildAnthropicRequest(unified);

    expect(built.output_config.format).toEqual({ type: 'json_schema', schema: SCHEMA });
  });

  it('merges format into an existing output_config without clobbering effort', async () => {
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
      incomingApiType: 'messages',
      originalBody: { output_config: { effort: 'high' } },
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    });

    expect(built.output_config).toEqual({
      effort: 'high',
      format: { type: 'json_schema', schema: SCHEMA },
    });
  });

  it('does not override a client-supplied output_config.format on messages → messages', async () => {
    const clientFormat = { type: 'json_schema', schema: { type: 'object' } };
    const built = await buildAnthropicRequest({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
      incomingApiType: 'messages',
      originalBody: { output_config: { effort: 'low', format: clientFormat } },
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    });

    expect(built.output_config.format).toEqual(clientFormat);
    expect(built.output_config.effort).toBe('low');
  });

  it('forwards Responses input_image through to an Anthropic image block', async () => {
    const unified = await new ResponsesTransformer().parseRequest({
      model: 'claude-sonnet-4-6',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' },
            { type: 'input_text', text: 'describe this' },
          ],
        },
      ],
    });

    const built = await buildAnthropicRequest(unified);
    const imageBlock = built.messages[0].content.find((b: any) => b.type === 'image');
    expect(imageBlock.source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    });
  });
});
