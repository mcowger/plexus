import { describe, expect, test } from 'vitest';
import { composeContentWithImageMarkdown } from '../image-rendering';
import { OpenAITransformer } from '../openai';
import { AnthropicTransformer } from '../anthropic';
import { GeminiTransformer } from '../gemini';
import { OllamaTransformer } from '../ollama';
import { OpenAICompletionTransformer } from '../completions';
import type { UnifiedChatResponse } from '../../types/unified';

// Consumer audit for the pure-content split: unified `content` carries ONLY
// authored text, and every CHAT-FORMAT unary formatter (chat, anthropic
// messages, gemini, ollama, legacy completions) composes the size-guarded
// image markdown itself from the typed `image_generation_calls` carry — the
// exact client-visible bytes the pre-split design baked into unified content.
// The responses-facing formatter is the one format that must NOT compose
// (native re-emit instead) — covered in responses-stream.test.ts.

const TINY_IMAGE_B64 = 'aGVsbG8=';
const TINY_IMAGE_MARKDOWN = `![generated image](data:image/png;base64,${TINY_IMAGE_B64})`;

function unifiedWithImage(content: string | null): UnifiedChatResponse {
  return {
    id: 'resp_compose',
    model: 'image-model',
    created: 1234567890,
    content,
    image_generation_calls: [{ id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 }],
    usage: {
      input_tokens: 5,
      output_tokens: 1,
      total_tokens: 6,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    },
  };
}

describe('composeContentWithImageMarkdown (shared helper)', () => {
  test('appends one markdown segment per typed item after the authored text, joined with \\n', () => {
    const composed = composeContentWithImageMarkdown('Here you go:', [
      { id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
      { id: 'ig_2', status: 'completed', result: TINY_IMAGE_B64 },
    ]);
    expect(composed).toBe(`Here you go:\n${TINY_IMAGE_MARKDOWN}\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('null/empty content with images renders the markdown alone', () => {
    expect(composeContentWithImageMarkdown(null, [{ id: 'ig_1', result: TINY_IMAGE_B64 }])).toBe(
      TINY_IMAGE_MARKDOWN
    );
    expect(composeContentWithImageMarkdown('', [{ id: 'ig_1', result: TINY_IMAGE_B64 }])).toBe(
      TINY_IMAGE_MARKDOWN
    );
  });

  test('no images (undefined, empty array, or result-less entries) returns content UNCHANGED', () => {
    expect(composeContentWithImageMarkdown('text', undefined)).toBe('text');
    expect(composeContentWithImageMarkdown('text', [])).toBe('text');
    expect(composeContentWithImageMarkdown('text', [{ result: '' } as any])).toBe('text');
    // Byte-transparency for image-less responses: null stays null, empty
    // string stays empty string, undefined stays undefined — no coercion.
    expect(composeContentWithImageMarkdown(null, undefined)).toBeNull();
    expect(composeContentWithImageMarkdown('', undefined)).toBe('');
    expect(composeContentWithImageMarkdown(undefined, undefined)).toBeUndefined();
  });

  test('an oversized result composes the omission placeholder, never the base64', () => {
    const oversized = 'B'.repeat(2 * 8 * 1024 * 1024);
    const composed = composeContentWithImageMarkdown('note', [{ id: 'ig_big', result: oversized }]);
    expect(composed).toBe('note\n[generated image omitted: 12.0 MB exceeds inline limit]');
  });
});

describe('every chat-format unary formatter composes image markdown from the typed carry', () => {
  test('chat (OpenAITransformer.formatResponse)', async () => {
    const formatted = await new OpenAITransformer().formatResponse(unifiedWithImage('Here:'));
    expect(formatted.choices[0].message.content).toBe(`Here:\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('anthropic messages (AnthropicTransformer.formatResponse)', async () => {
    const formatted = await new AnthropicTransformer().formatResponse(unifiedWithImage('Here:'));
    const textBlocks = formatted.content.filter((block: any) => block.type === 'text');
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe(`Here:\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('anthropic messages renders a text block even for an image-only response', async () => {
    const formatted = await new AnthropicTransformer().formatResponse(unifiedWithImage(null));
    const textBlocks = formatted.content.filter((block: any) => block.type === 'text');
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe(TINY_IMAGE_MARKDOWN);
  });

  test('gemini (GeminiTransformer.formatResponse)', async () => {
    const formatted = await new GeminiTransformer().formatResponse(unifiedWithImage('Here:'));
    const textParts = formatted.candidates[0].content.parts.filter(
      (part: any) => typeof part.text === 'string' && !part.thought
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe(`Here:\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('ollama (OllamaTransformer.formatResponse)', async () => {
    const formatted = await new OllamaTransformer().formatResponse(unifiedWithImage('Here:'));
    expect(formatted.choices[0].message.content).toBe(`Here:\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('legacy completions (OpenAICompletionTransformer.formatResponse)', async () => {
    const formatted = await new OpenAICompletionTransformer().formatResponse(
      unifiedWithImage('Here:')
    );
    expect(formatted.choices[0].text).toBe(`Here:\n${TINY_IMAGE_MARKDOWN}`);
  });

  test('image-less responses stay byte-identical through the chat formatter (null content passthrough)', async () => {
    const formatted = await new OpenAITransformer().formatResponse({
      id: 'resp_plain',
      model: 'text-model',
      content: null,
    } as UnifiedChatResponse);
    expect(formatted.choices[0].message.content).toBeNull();
  });
});
