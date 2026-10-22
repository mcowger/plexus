/**
 * The auto-bridge's synthesized output must be renderable by the client
 * formatters EXACTLY AS THEY ALREADY ARE — no formatter change was made for
 * it. The bridge produces the same unified shape `ResponsesTransformer`'s
 * transformStream produces for a real image_generation_call: chunk-level
 * `image_generation_calls` paired 1:1 with the chat-format markdown on the
 * SAME chunk's `delta.content`.
 *
 * This file feeds the REAL synthesizer output through the REAL formatters:
 *   - chat-format clients (openai, anthropic, gemini) render the markdown;
 *   - the responses-format client re-emits the native item and structurally
 *     skips the paired markdown delta;
 *   - the finish chunk's `usage` reaches the client (and, in production, the
 *     transformed-snapshot usage fallback).
 */

import { describe, expect, test } from 'vitest';

import {
  synthesizeChatResponse,
  synthesizeChatStream,
} from '../../services/dispatch/image-model-bridge';
import type { UnifiedChatRequest, UnifiedImageGenerationResponse } from '../../types/unified';
import { AnthropicTransformer, GeminiTransformer, OpenAITransformer } from '../index';
import { ResponsesTransformer } from '../responses';

const TINY_IMAGE_B64 = 'aGVsbG8=';
const EXPECTED_MARKDOWN = `![generated image](data:image/png;base64,${TINY_IMAGE_B64})`;

const request = {
  model: 'image_alias',
  messages: [{ role: 'user', content: 'a watercolor fox' }],
} as UnifiedChatRequest;

const imageResponse: UnifiedImageGenerationResponse = {
  created: 1700000000,
  data: [{ b64_json: TINY_IMAGE_B64 }],
  usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
  plexus: { provider: 'codex', model: 'gpt-image-2', apiType: 'images' },
};

async function bridgedStream(): Promise<ReadableStream> {
  const streamed = await synthesizeChatStream(imageResponse, request);
  return streamed.stream as ReadableStream;
}

async function readSse(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += typeof value === 'string' ? value : decoder.decode(value);
  }
  return output;
}

/** Parses `data:` payloads out of an SSE body, skipping `[DONE]`. */
function sseData(body: string): any[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => !!line)
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload));
}

describe('bridged image output through the chat-format stream formatters', () => {
  test('OpenAI chat: the markdown streams as a content delta and usage lands on the finish', async () => {
    const events = sseData(
      await readSse(new OpenAITransformer().formatStream(await bridgedStream()))
    );

    const contentDeltas = events
      .map((event) => event.choices?.[0]?.delta?.content)
      .filter((content) => typeof content === 'string' && content.length > 0);
    expect(contentDeltas).toEqual([EXPECTED_MARKDOWN]);

    const finish = events.find((event) => event.choices?.[0]?.finish_reason === 'stop');
    expect(finish).toBeDefined();
    expect(finish.usage).toMatchObject({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    });

    // The uncapped typed carry must never leak into a chat wire chunk.
    expect(JSON.stringify(events).includes('"image_generation_calls"')).toBe(false);
  });

  test('Anthropic messages: the markdown streams as a text content_block_delta', async () => {
    const events = sseData(
      await readSse(new AnthropicTransformer().formatStream(await bridgedStream()))
    );

    const textDeltas = events
      .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
      .map((event) => event.delta.text);
    expect(textDeltas).toEqual([EXPECTED_MARKDOWN]);

    expect(events.some((event) => event.type === 'message_stop')).toBe(true);
    expect(JSON.stringify(events).includes('"image_generation_calls"')).toBe(false);
  });

  test('Gemini: the markdown streams as a text part', async () => {
    const events = sseData(
      await readSse(new GeminiTransformer().formatStream(await bridgedStream()))
    );

    const texts = events
      .flatMap((event) => event.candidates?.[0]?.content?.parts ?? [])
      .map((part: any) => part.text)
      .filter((text: string) => typeof text === 'string' && text.length > 0);
    expect(texts).toEqual([EXPECTED_MARKDOWN]);

    const finish = events.find((event) => event.candidates?.[0]?.finishReason === 'STOP');
    expect(finish).toBeDefined();
    expect(finish.usageMetadata).toMatchObject({
      promptTokenCount: 7,
      candidatesTokenCount: 3,
      totalTokenCount: 10,
    });
  });

  test('Responses: the native image item is re-emitted and the paired markdown is skipped', async () => {
    const events = sseData(
      await readSse(new ResponsesTransformer().formatStream(await bridgedStream()))
    );

    const imageItems = events.filter(
      (event) =>
        event.type === 'response.output_item.done' && event.item?.type === 'image_generation_call'
    );
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].item).toMatchObject({
      type: 'image_generation_call',
      status: 'completed',
      result: TINY_IMAGE_B64,
    });

    // The markdown must NOT also stream as text for a Responses client.
    expect(events.some((event) => event.type === 'response.output_text.delta')).toBe(false);
    expect(JSON.stringify(events).includes('![generated image]')).toBe(false);

    const completed = events.find((event) => event.type === 'response.completed');
    expect(
      completed.response.output.some((item: any) => item.type === 'image_generation_call')
    ).toBe(true);
    expect(completed.response.usage).toMatchObject({ input_tokens: 7, output_tokens: 3 });
  });
});

describe('bridged image output through the unary formatters', () => {
  test('OpenAI chat composes the markdown into the assistant message', async () => {
    const unified = await synthesizeChatResponse(imageResponse, request);
    const body = await new OpenAITransformer().formatResponse(unified);

    expect(body.choices[0].message.content).toBe(EXPECTED_MARKDOWN);
    expect(body.model).toBe('image_alias');
  });

  test('Responses re-emits the native image item instead of message text', async () => {
    const unified = await synthesizeChatResponse(imageResponse, request);
    const body = await new ResponsesTransformer().formatResponse(unified);

    const imageItems = body.output.filter((item: any) => item.type === 'image_generation_call');
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].result).toBe(TINY_IMAGE_B64);
    expect(JSON.stringify(body).includes('![generated image]')).toBe(false);
  });
});
