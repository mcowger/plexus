import { describe, it, expect } from 'vitest';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildAnthropicRequest } from '../anthropic/request-builder';
import type { UnifiedChatRequest } from '../../types/unified';

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

describe('Anthropic image block cache_control round-trip', () => {
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
  });
});
