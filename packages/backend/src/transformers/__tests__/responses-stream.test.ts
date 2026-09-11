import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';
import { OpenAITransformer } from '../openai';
import {
  AT_LIMIT_IMAGE_RESULT,
  AUTHORED_WITH_MARKDOWN,
  AUTHORED_WITH_PLACEHOLDER,
  CHAT_FAILED_USAGE_EVENTS,
  CHAT_IMAGE_EVENTS,
  CHAT_INCOMPLETE_CONTENT_FILTER_EVENTS,
  CHAT_INCOMPLETE_USAGE_EVENTS,
  COMPLETED_FUNCTION_CALL_EVENTS,
  CLIENT_FAILED_EVENTS,
  CLIENT_FAILED_ITEMS_EVENTS,
  CLIENT_HARD_ERROR_EVENTS,
  CLIENT_INCOMPLETE_CONTENT_FILTER_EVENTS,
  CLIENT_INCOMPLETE_ITEMS_EVENTS,
  CLIENT_INCOMPLETE_MAX_EVENTS,
  DETAIL_LESS_CHAT_EVENTS,
  DETAIL_LESS_RESPONSES_EVENTS,
  FAILED_RESPONSE_EVENTS,
  FAILED_WITHOUT_USAGE_EVENTS,
  FAILED_WITH_USAGE_EVENTS,
  FUNCTION_CALL_COMPLETION_EVENTS,
  GENERIC_ERROR_EVENTS,
  IMAGE_AT_LIMIT_RESPONSE,
  IMAGE_COMPLETED_ONLY_EVENTS,
  IMAGE_DEDUPLICATION_EVENTS,
  IMAGE_NATIVE_MESSAGE_EVENTS,
  IMAGE_NATIVE_OVERSIZED_EVENTS,
  IMAGE_NATIVE_SINGLE_EVENTS,
  IMAGE_NO_RESULT_RESPONSE,
  IMAGE_ORDER_RESPONSE,
  IMAGE_OUTPUT_FORMAT_RESPONSE,
  IMAGE_OVERSIZED_RESPONSE,
  IMAGE_OVERSIZED_STREAM_EVENTS,
  IMAGE_PLACEHOLDER_12_MB,
  IMAGE_PARTIAL_EVENTS,
  IMAGE_RESPONSE,
  IMAGE_ROUND_TRIP_EVENTS,
  IMAGE_STREAM_ITEM_DONE_EVENTS,
  INCOMPLETE_CONTENT_FILTER_EVENTS,
  INCOMPLETE_WITHOUT_DETAILS_EVENTS,
  INCOMPLETE_WITH_USAGE_EVENTS,
  INCOMPLETE_MAX_OUTPUT_EVENTS,
  NATIVE_OVERSIZED_IMAGE_RESULT,
  OVERSIZED_IMAGE_RESULT_12_MB,
  OVERSIZED_IMAGE_RESULT_6_MB,
  PARALLEL_FUNCTION_CALL_EVENTS,
  TEXT_COMPLETION_EVENTS,
  TEXT_ONLY_RESPONSE,
  TINY_IMAGE_B64,
  TINY_IMAGE_MARKDOWN,
  TYPED_IMAGE_COMPLETED_ONLY_EVENTS,
  TYPED_IMAGE_DEDUPLICATION_EVENTS,
  TYPED_IMAGE_DELTA_EVENTS,
  TYPED_IMAGE_EVENTS,
  UNARY_IMAGE_ONLY_RESPONSE,
  UNARY_IMAGE_ROUND_TRIP_RESPONSE,
  UNARY_OVERSIZED_IMAGE_RESPONSE,
  UNARY_OVERSIZED_IMAGE_RESULT,
  UNARY_TYPED_IMAGE_RESPONSE,
  UNARY_NO_RESULT_RESPONSE,
  createCollisionResponseBody,
  createImageSniffResponse,
  createPlaceholderCollisionResponseBody,
  createToolSearchItem,
  TOOL_SEARCH_CHAT_EVENTS,
  TOOL_SEARCH_COMPLETED_ONLY_EVENTS,
  TOOL_SEARCH_COMPLETED_STOP_EVENTS,
  TOOL_SEARCH_DEDUPLICATION_EVENTS,
  TOOL_SEARCH_NATIVE_CHUNKS,
  TOOL_SEARCH_STOP_EVENTS,
  TOOL_SEARCH_STREAM_EVENTS,
  TOOL_SEARCH_UNARY_RESPONSE,
  TOOL_SEARCH_WITH_FUNCTION_EVENTS,
} from './responses-stream.fixtures';

async function transformEvents(events: Record<string, unknown>[]): Promise<any[]> {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        );
      }
      controller.close();
    },
  });

  const reader = new ResponsesTransformer().transformStream(source).getReader();
  const chunks: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

describe('ResponsesTransformer stream transformation', () => {
  test('keeps parallel function calls distinct when their argument deltas are interleaved', async () => {
    const chunks = await transformEvents(PARALLEL_FUNCTION_CALL_EVENTS);

    expect(chunks.filter((chunk) => chunk.delta.tool_calls)).toEqual([
      {
        id: 'resp_1',
        model: 'gpt-5',
        created: expect.any(Number),
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_first',
              type: 'function',
              function: { name: 'add_task', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'resp_1',
        model: 'gpt-5',
        created: expect.any(Number),
        delta: {
          tool_calls: [
            {
              index: 1,
              id: 'call_second',
              type: 'function',
              function: { name: 'add_task', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'resp_1',
        model: 'gpt-5',
        created: expect.any(Number),
        delta: { tool_calls: [{ index: 1, function: { arguments: '{"title":"second"}' } }] },
        finish_reason: null,
      },
      {
        id: 'resp_1',
        model: 'gpt-5',
        created: expect.any(Number),
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"title":"first"}' } }] },
        finish_reason: null,
      },
    ]);
  });

  test('finishes with tool_calls after streaming a function call', async () => {
    const chunks = await transformEvents(FUNCTION_CALL_COMPLETION_EVENTS);

    expect(chunks.find((chunk) => chunk.delta?.tool_calls)?.delta.tool_calls).toEqual([
      {
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'get_date', arguments: '' },
      },
    ]);
    expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('tool_calls');
  });

  test('finishes with stop when no function call was streamed', async () => {
    const chunks = await transformEvents(TEXT_COMPLETION_EVENTS);

    expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('stop');
  });

  test('recognizes function calls present only in the completed response', async () => {
    const chunks = await transformEvents(COMPLETED_FUNCTION_CALL_EVENTS);

    expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('tool_calls');
  });
});

describe('ResponsesTransformer stream transformation - error handling', () => {
  test('maps response.failed to a unified error chunk instead of dropping it', async () => {
    const chunks = await transformEvents(FAILED_RESPONSE_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.message).toBe('The model encountered an error.');
    // No phantom success finish should accompany a failure.
    expect(chunks.some((chunk) => chunk.finish_reason === 'stop')).toBe(false);
  });

  test('maps response.incomplete (max_output_tokens) to a unified error chunk carrying a length finish hint and incomplete_details', async () => {
    const chunks = await transformEvents(INCOMPLETE_MAX_OUTPUT_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.finish_reason).toBe('length');
    expect(errorChunk.error.code).toBe('max_output_tokens');
    expect(errorChunk.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  test('maps response.incomplete (content_filter) to a unified error chunk carrying a content_filter finish hint and incomplete_details', async () => {
    const chunks = await transformEvents(INCOMPLETE_CONTENT_FILTER_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.finish_reason).toBe('content_filter');
    expect(errorChunk.error.code).toBe('content_filter');
    expect(errorChunk.incomplete_details).toEqual({ reason: 'content_filter' });
  });

  test('defaults incomplete_details to reason "unknown" (finish hint "length") when upstream response.incomplete carries none', async () => {
    // Some upstreams emit response.incomplete with no incomplete_details at
    // all. The unified chunk must still carry BOTH markers of an "ended
    // incomplete" outcome — incomplete_details (what the responses-facing
    // formatStream keys response.incomplete emission on) and an
    // OpenAI-compatible finish hint ('length': the same
    // everything-but-content_filter default as usage-logging's raw-mode
    // incomplete mapping) — otherwise downstream renders the event as a
    // hard failure.
    const chunks = await transformEvents(INCOMPLETE_WITHOUT_DETAILS_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.incomplete_details).toEqual({ reason: 'unknown' });
    expect(errorChunk.finish_reason).toBe('length');
    expect(errorChunk.error.code).toBe('unknown');
  });

  test('propagates response.usage on response.failed into the unified error chunk', async () => {
    const chunks = await transformEvents(FAILED_WITH_USAGE_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toEqual(
      expect.objectContaining({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
    );
  });

  test('propagates response.usage on response.incomplete into the unified error chunk', async () => {
    const chunks = await transformEvents(INCOMPLETE_WITH_USAGE_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toEqual(
      expect.objectContaining({ input_tokens: 20, output_tokens: 8, total_tokens: 28 })
    );
  });

  test('does not attach a usage field when response.failed/response.incomplete carry none', async () => {
    const chunks = await transformEvents(FAILED_WITHOUT_USAGE_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toBeUndefined();
  });

  test('maps a generic top-level error event to a unified error chunk', async () => {
    const chunks = await transformEvents(GENERIC_ERROR_EVENTS);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.message).toBe('boom');
  });
});

// Tiny image payloads and generated size-boundary values live in responses-stream.fixtures.ts.

describe('ResponsesTransformer image_generation_call rendering (pure unified content + chat composition)', () => {
  // The chat-visible text for a unified response, exactly as a CHAT-format
  // client receives it: OpenAITransformer.formatResponse composes the
  // authored text + rendered image markdown from the typed carry
  // (transformers/image-rendering.ts). The expected strings in this describe
  // are the pre-split baked-content bytes — chat clients must keep receiving
  // them byte-identically.
  const chatVisibleContent = async (unified: any): Promise<string | null> => {
    const chat = await new OpenAITransformer().formatResponse(unified);
    return chat.choices[0].message.content;
  };

  test('an image_generation_call with a base64 result renders markdown data-URI content for chat clients', async () => {
    const unified = await new ResponsesTransformer().transformResponse(IMAGE_RESPONSE);

    // Unified content stays PURE — no message item, no text. The image
    // travels typed; the markdown exists only in the chat projection.
    expect(unified.content).toBeNull();
    expect(unified.image_generation_calls).toEqual([
      { id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
    ]);
    expect(await chatVisibleContent(unified)).toBe(TINY_IMAGE_MARKDOWN);
  });

  test('chat composition appends image markdown after the authored message text', async () => {
    const unified = await new ResponsesTransformer().transformResponse(IMAGE_ORDER_RESPONSE);

    expect(unified.content).toBe('Here is your image:');
    expect(await chatVisibleContent(unified)).toBe(`Here is your image:\n${TINY_IMAGE_MARKDOWN}`);
  });

  // `output_format` is a REQUEST-side image tool field — it is not present
  // on image_generation_call output items, so the mime subtype is sniffed
  // from the decoded base64 head's magic bytes instead (PNG/JPEG/WebP/GIF,
  // defaulting to png).
  describe('mime subtype sniffing from the base64 signature', () => {
    const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

    const renderImage = async (result: string) =>
      chatVisibleContent(
        await new ResponsesTransformer().transformResponse(createImageSniffResponse(result))
      );

    test('PNG signature (\\x89PNG) renders image/png', async () => {
      const png = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      expect(await renderImage(png)).toBe(`![generated image](data:image/png;base64,${png})`);
    });

    test('JPEG signature (\\xFF\\xD8) renders image/jpeg', async () => {
      const jpeg = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      expect(await renderImage(jpeg)).toBe(`![generated image](data:image/jpeg;base64,${jpeg})`);
    });

    test('WebP signature (RIFF....WEBP) renders image/webp', async () => {
      const webp = b64([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
        0x20,
      ]);
      expect(await renderImage(webp)).toBe(`![generated image](data:image/webp;base64,${webp})`);
    });

    test('GIF signature (GIF8) renders image/gif', async () => {
      const gif = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);
      expect(await renderImage(gif)).toBe(`![generated image](data:image/gif;base64,${gif})`);
    });

    test('an unrecognized signature defaults to image/png', async () => {
      // TINY_IMAGE_B64 decodes to "hello" — no known magic bytes.
      expect(await renderImage(TINY_IMAGE_B64)).toBe(TINY_IMAGE_MARKDOWN);
    });

    test('a request-style output_format field on the item is IGNORED (not a response field)', async () => {
      const unified = await new ResponsesTransformer().transformResponse(
        IMAGE_OUTPUT_FORMAT_RESPONSE
      );

      // The payload's actual bytes ("hello" — no signature) decide: png.
      expect(await chatVisibleContent(unified)).toBe(TINY_IMAGE_MARKDOWN);
    });

    test('RIFF head WITHOUT the WEBP tag does not sniff as webp', async () => {
      const riffOnly = b64([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
      ]);
      expect(await renderImage(riffOnly)).toBe(
        `![generated image](data:image/png;base64,${riffOnly})`
      );
    });
  });

  test('an image_generation_call without a base64 result contributes nothing', async () => {
    const unified = await new ResponsesTransformer().transformResponse(IMAGE_NO_RESULT_RESPONSE);

    expect(unified.content).toBeNull();
    expect(unified.image_generation_calls).toBeUndefined();
    expect(await chatVisibleContent(unified)).toBeNull();
  });

  test('a text-only response keeps its existing unified content shape (happy path unchanged)', async () => {
    const unified = await new ResponsesTransformer().transformResponse(TEXT_ONLY_RESPONSE);

    expect(unified.content).toBe('Full answer');
  });

  test('a base64 result over the inline limit renders the omission placeholder for chat clients, not a data URI', async () => {
    // One char past MAX_INLINE_IMAGE_BASE64_CHARS (8 * 1024 * 1024).
    // Approximate decoded size = 8388609 * 3/4 bytes ≈ 6.0 MB.
    const oversized = OVERSIZED_IMAGE_RESULT_6_MB;
    const unified = await new ResponsesTransformer().transformResponse(IMAGE_OVERSIZED_RESPONSE);

    // Pure unified content; the size guard applies only to the chat
    // projection — the typed carry keeps the full payload.
    expect(unified.content).toBeNull();
    expect(unified.image_generation_calls?.[0]?.result).toBe(oversized);
    expect(await chatVisibleContent(unified)).toBe(
      '[generated image omitted: 6.0 MB exceeds inline limit]'
    );
  });

  test('a base64 result exactly at the inline limit still renders as a data URI (boundary)', async () => {
    const atLimit = AT_LIMIT_IMAGE_RESULT;
    const unified = await new ResponsesTransformer().transformResponse(IMAGE_AT_LIMIT_RESPONSE);

    expect(await chatVisibleContent(unified)).toBe(
      `![generated image](data:image/png;base64,${atLimit})`
    );
  });
});

describe('ResponsesTransformer transformStream - image_generation_call rendering', () => {
  test('a completed image_generation_call output item becomes a unified content delta (markdown data URI)', async () => {
    const chunks = await transformEvents(IMAGE_STREAM_ITEM_DONE_EVENTS);

    const contentChunks = chunks.filter(
      (chunk) => typeof chunk.delta?.content === 'string' && chunk.delta.content.length > 0
    );
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0].delta.content).toBe(TINY_IMAGE_MARKDOWN);
  });

  test('an image_generation_call present only in response.completed still renders, before the final chunk', async () => {
    const chunks = await transformEvents(IMAGE_COMPLETED_ONLY_EVENTS);

    const contentIndex = chunks.findIndex((chunk) => chunk.delta?.content === TINY_IMAGE_MARKDOWN);
    const finishIndex = chunks.findIndex((chunk) => chunk.finish_reason);
    expect(contentIndex).toBeGreaterThan(-1);
    expect(finishIndex).toBeGreaterThan(contentIndex);
  });

  test('does not double-render an item that streamed via output_item.done AND appears in response.completed', async () => {
    const chunks = await transformEvents(IMAGE_DEDUPLICATION_EVENTS);

    const contentChunks = chunks.filter((chunk) => chunk.delta?.content === TINY_IMAGE_MARKDOWN);
    expect(contentChunks).toHaveLength(1);
  });

  test('partial-image delta events are skipped (explicitly out of scope) — only the completed item renders', async () => {
    const chunks = await transformEvents(IMAGE_PARTIAL_EVENTS);

    const contentChunks = chunks.filter(
      (chunk) => typeof chunk.delta?.content === 'string' && chunk.delta.content.length > 0
    );
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0].delta.content).toBe(TINY_IMAGE_MARKDOWN);
    expect(chunks.some((chunk) => JSON.stringify(chunk).includes('UEFSVElBTA=='))).toBe(false);
  });

  test('a base64 result over the inline limit streams the omission placeholder instead of the data URI', async () => {
    // Twice MAX_INLINE_IMAGE_BASE64_CHARS (8 * 1024 * 1024).
    // Approximate decoded size = 16777216 * 3/4 bytes = 12.0 MB.
    const oversized = OVERSIZED_IMAGE_RESULT_12_MB;
    const chunks = await transformEvents(IMAGE_OVERSIZED_STREAM_EVENTS);

    const contentChunks = chunks.filter(
      (chunk) => typeof chunk.delta?.content === 'string' && chunk.delta.content.length > 0
    );
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0].delta.content).toBe(
      '[generated image omitted: 12.0 MB exceeds inline limit]'
    );
    // The oversized base64 payload must never reach a CONTENT delta (chat/
    // messages clients render content strings — that's what the inline size
    // guard protects). The chunk-level `image_generation_calls` typed carry
    // deliberately DOES hold the full base64 so responses-facing clients can
    // receive the native item byte-intact — see the typed-carry describe
    // below.
    expect(
      chunks.some(
        (chunk) =>
          typeof chunk.delta?.content === 'string' && chunk.delta.content.includes('BBBBBBBB')
      )
    ).toBe(false);
    expect(contentChunks[0].image_generation_calls?.[0]?.result).toBe(oversized);
  });
});

// A markdown-only collapse would be lossy for SAME-format clients: a
// non-bypass responses -> responses route (e.g. a responses:lite subtype,
// adapter active, vision fallthrough) would receive `message`/`output_text`
// markdown instead of the native `image_generation_call` item — and the
// oversized placeholder would destroy the base64 for clients that take it
// natively. The typed carry (UnifiedImageGenerationCall) keeps the item
// intact through the unified layer; the responses-facing formatStream /
// formatResponse re-emit it natively. On the unary path the typed carry is
// the ONLY image carrier (unified content stays pure); on the streaming path
// it rides chunk-level, paired with the chat markdown delta on the same
// chunk, which the responses-facing formatStream structurally skips.
describe('ResponsesTransformer typed image_generation_call carry (responses -> responses)', () => {
  function unifiedStreamFromChunks(chunks: any[]): ReadableStream {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  async function collectFormatStreamEvents(
    chunks: any[],
    transformer = new ResponsesTransformer()
  ): Promise<any[]> {
    const reader = transformer.formatStream(unifiedStreamFromChunks(chunks)).getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    return output
      .split('\n\n')
      .filter((block) => block.trim().length > 0)
      .map((block) => {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        return JSON.parse((dataLine as string).replace(/^data:\s*/, ''));
      });
  }

  describe('transformStream carries the typed item alongside the markdown', () => {
    test('a completed image item carries a typed entry on the SAME chunk as its markdown delta', async () => {
      const chunks = await transformEvents(TYPED_IMAGE_EVENTS);

      const imageChunks = chunks.filter((chunk) => chunk.image_generation_calls);
      expect(imageChunks).toHaveLength(1);
      expect(imageChunks[0].image_generation_calls).toEqual([
        { id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
      ]);
      // The chat-format markdown rendering rides the same chunk's content.
      expect(imageChunks[0].delta.content).toBe(TINY_IMAGE_MARKDOWN);
    });

    test('the typed entry is chunk-level, NOT inside delta (chat formatters forward delta by reference)', async () => {
      const chunks = await transformEvents(TYPED_IMAGE_DELTA_EVENTS);

      const imageChunk = chunks.find((chunk) => chunk.image_generation_calls);
      expect(imageChunk).toBeDefined();
      expect(imageChunk.delta.image_generation_calls).toBeUndefined();
    });

    test('the completed-fallback also carries the typed entry, without double-carrying deduped items', async () => {
      const chunks = await transformEvents(TYPED_IMAGE_DEDUPLICATION_EVENTS);

      const imageChunks = chunks.filter((chunk) => chunk.image_generation_calls);
      expect(imageChunks).toHaveLength(1);
    });

    test('a completed-only item (never streamed via output_item.done) still gets the typed carry', async () => {
      const chunks = await transformEvents(TYPED_IMAGE_COMPLETED_ONLY_EVENTS);

      const imageChunks = chunks.filter((chunk) => chunk.image_generation_calls);
      expect(imageChunks).toHaveLength(1);
      expect(imageChunks[0].image_generation_calls[0]).toEqual({
        id: 'ig_9',
        status: 'completed',
        result: TINY_IMAGE_B64,
      });
    });
  });

  describe('formatStream re-emits typed items as native output items', () => {
    test('emits a native image_generation_call output item (byte-intact) instead of markdown text', async () => {
      const events = await collectFormatStreamEvents(IMAGE_NATIVE_SINGLE_EVENTS);

      const doneEvents = events.filter(
        (e) => e.type === 'response.output_item.done' && e.item?.type === 'image_generation_call'
      );
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].item).toEqual({
        id: 'ig_1',
        type: 'image_generation_call',
        status: 'completed',
        result: TINY_IMAGE_B64,
      });

      // The paired markdown must NOT also stream as output_text — the native
      // item is the only carrier for a Responses-format client.
      expect(events.some((e) => e.type === 'response.output_text.delta')).toBe(false);
      expect(JSON.stringify(events).includes('![generated image]')).toBe(false);
    });

    test('the final response.completed output array includes the native image item', async () => {
      const events = await collectFormatStreamEvents(IMAGE_NATIVE_SINGLE_EVENTS);

      const completed = events.find((e) => e.type === 'response.completed');
      expect(completed).toBeDefined();
      const imageItems = completed.response.output.filter(
        (item: any) => item.type === 'image_generation_call'
      );
      expect(imageItems).toHaveLength(1);
      expect(imageItems[0].result).toBe(TINY_IMAGE_B64);
    });

    test('an OVERSIZED result re-emits with the FULL base64 — the native format has no inline cap', async () => {
      const oversized = NATIVE_OVERSIZED_IMAGE_RESULT;
      // transformStream renders the placeholder on content for oversized
      // items — mirror that pairing here.
      const events = await collectFormatStreamEvents(IMAGE_NATIVE_OVERSIZED_EVENTS);

      const doneEvent = events.find(
        (e) => e.type === 'response.output_item.done' && e.item?.type === 'image_generation_call'
      );
      expect(doneEvent).toBeDefined();
      expect(doneEvent.item.result).toBe(oversized);
      // The placeholder must not leak into any text.
      expect(JSON.stringify(events).includes('exceeds inline limit')).toBe(false);
    });

    test('message text on OTHER chunks still streams normally alongside a native image item', async () => {
      const events = await collectFormatStreamEvents(IMAGE_NATIVE_MESSAGE_EVENTS);

      const textDeltas = events.filter((e) => e.type === 'response.output_text.delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0].delta).toBe('Here is your image:');

      const completed = events.find((e) => e.type === 'response.completed');
      const types = completed.response.output.map((item: any) => item.type);
      expect(types).toContain('message');
      expect(types).toContain('image_generation_call');
      const messageItem = completed.response.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe('Here is your image:');
    });

    test('full streaming round-trip (provider SSE -> unified -> client SSE) keeps the item byte-intact', async () => {
      const unifiedChunks = await transformEvents(IMAGE_ROUND_TRIP_EVENTS);

      const events = await collectFormatStreamEvents(unifiedChunks);
      const doneEvent = events.find(
        (e) => e.type === 'response.output_item.done' && e.item?.type === 'image_generation_call'
      );
      expect(doneEvent).toBeDefined();
      expect(doneEvent.item.result).toBe(TINY_IMAGE_B64);
      expect(events.some((e) => e.type === 'response.output_text.delta')).toBe(false);
    });
  });

  describe('formatResponse (unary) re-emits typed items as native output items', () => {
    test('transformResponse attaches the typed items and keeps unified content PURE', async () => {
      const unified = await new ResponsesTransformer().transformResponse(
        UNARY_TYPED_IMAGE_RESPONSE
      );

      expect(unified.image_generation_calls).toEqual([
        { id: 'ig_1', status: 'completed', result: TINY_IMAGE_B64 },
      ]);
      // PURE authored text — the chat-format markdown projection is composed
      // by the client-facing renderers, never baked in here.
      expect(unified.content).toBe('Here is your image:');
    });

    test('a result-less image item still contributes no typed entry', async () => {
      const unified = await new ResponsesTransformer().transformResponse(UNARY_NO_RESULT_RESPONSE);

      expect(unified.image_generation_calls).toBeUndefined();
    });

    test('formatResponse emits the native item and strips the paired markdown from the message text', async () => {
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(UNARY_IMAGE_ROUND_TRIP_RESPONSE);

      const formatted = await transformer.formatResponse(unified as any);

      const imageItems = formatted.output.filter(
        (item: any) => item.type === 'image_generation_call'
      );
      expect(imageItems).toHaveLength(1);
      expect(imageItems[0]).toMatchObject({
        type: 'image_generation_call',
        id: 'ig_1',
        status: 'completed',
        result: TINY_IMAGE_B64,
      });

      const messageItem = formatted.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe('Here is your image:');
      expect(JSON.stringify(formatted).includes('![generated image]')).toBe(false);
    });

    test('an image-only unary response round-trips as a native item (no markdown text)', async () => {
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(UNARY_IMAGE_ONLY_RESPONSE);

      // Pure unified content: nothing authored, nothing baked. The typed
      // carry is what keeps the empty-completion detector seeing visible
      // output (see empty-completion.ts countTypedImageGenerationCalls).
      expect(unified.content).toBeNull();
      expect(unified.image_generation_calls?.[0]?.result).toBe(TINY_IMAGE_B64);

      const formatted = await transformer.formatResponse(unified as any);
      const imageItems = formatted.output.filter(
        (item: any) => item.type === 'image_generation_call'
      );
      expect(imageItems).toHaveLength(1);
      expect(imageItems[0].result).toBe(TINY_IMAGE_B64);
      const messageItem = formatted.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe('');
    });

    test('an OVERSIZED unary result re-emits byte-intact natively — the placeholder never reaches the client', async () => {
      const oversized = UNARY_OVERSIZED_IMAGE_RESULT;
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(UNARY_OVERSIZED_IMAGE_RESPONSE);

      // Pure unified content (the guarded placeholder exists only in the
      // chat projection)...
      expect(unified.content).toBeNull();
      // ...while the typed carry keeps the full payload.
      expect(unified.image_generation_calls?.[0]?.result).toBe(oversized);

      const formatted = await transformer.formatResponse(unified as any);
      const imageItem = formatted.output.find((item: any) => item.type === 'image_generation_call');
      expect(imageItem.result).toBe(oversized);
      const messageItem = formatted.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe('');
      expect(JSON.stringify(formatted).includes('exceeds inline limit')).toBe(false);
    });
  });

  describe('unary content-corruption probe — authored text colliding with rendered image segments', () => {
    // The model can legitimately AUTHOR text containing the exact string of a
    // rendered image segment (echoing a small image's markdown, or quoting
    // the oversized-omission placeholder). The authored copy is genuine
    // message content and must reach every client byte-intact; the rendered
    // segment is a chat-format projection a responses client never sees (it
    // gets the native item instead). Any indexOf-based "remove the rendered
    // segment" surgery removes the FIRST occurrence — the authored copy —
    // and leaks the appended rendering: content corruption.

    test('authored text containing an exact copy of the image markdown reaches a responses client byte-intact', async () => {
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(createCollisionResponseBody());
      const formatted = await transformer.formatResponse(unified as any);

      // The native item is the image's only carrier...
      const imageItems = formatted.output.filter(
        (item: any) => item.type === 'image_generation_call'
      );
      expect(imageItems).toHaveLength(1);
      expect(imageItems[0].result).toBe(TINY_IMAGE_B64);

      // ...and the AUTHORED text — including its own copy of the markdown —
      // survives byte-intact: nothing removed, no appended rendering leaked.
      const messageItem = formatted.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe(AUTHORED_WITH_MARKDOWN);
    });

    test('authored text quoting the oversized-omission placeholder reaches a responses client byte-intact', async () => {
      const oversized = OVERSIZED_IMAGE_RESULT_12_MB;
      const placeholder = IMAGE_PLACEHOLDER_12_MB;
      const authored = AUTHORED_WITH_PLACEHOLDER;
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(createPlaceholderCollisionResponseBody());

      const formatted = await transformer.formatResponse(unified as any);

      const imageItem = formatted.output.find((item: any) => item.type === 'image_generation_call');
      expect(imageItem.result).toBe(oversized);

      const messageItem = formatted.output.find((item: any) => item.type === 'message');
      expect(messageItem.content[0].text).toBe(authored);
      // Exactly ONE occurrence — the authored quote. The rendered
      // placeholder itself must never leak into the responses payload.
      expect(messageItem.content[0].text.split(placeholder).length - 1).toBe(1);
    });

    test('the same authored-collision response renders authored text + appended markdown for a CHAT client (duplication is genuine content)', async () => {
      const unified = await new ResponsesTransformer().transformResponse(
        createCollisionResponseBody()
      );
      const chat = await new OpenAITransformer().formatResponse(unified as any);

      expect(chat.choices[0].message.content).toBe(
        `${AUTHORED_WITH_MARKDOWN}\n${TINY_IMAGE_MARKDOWN}`
      );
    });
  });
});

describe('ResponsesTransformer formatStream - error handling (client-facing)', () => {
  function unifiedStreamFromChunks(chunks: any[]): ReadableStream {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  async function collectFormatStreamEvents(chunks: any[]): Promise<any[]> {
    const reader = new ResponsesTransformer()
      .formatStream(unifiedStreamFromChunks(chunks))
      .getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    return output
      .split('\n\n')
      .filter((block) => block.trim().length > 0)
      .map((block) => {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        return JSON.parse((dataLine as string).replace(/^data:\s*/, ''));
      });
  }

  test('emits response.failed (not response.completed) when a unified error chunk arrives', async () => {
    const events = await collectFormatStreamEvents(CLIENT_FAILED_EVENTS);

    expect(events.some((e) => e.type === 'response.completed')).toBe(false);
    const failedEvent = events.find((e) => e.type === 'response.failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent.response.status).toBe('failed');
    expect(failedEvent.response.error.message).toBe('The model encountered an error.');
  });

  test('surfaces response.incomplete (not response.failed) when the unified chunk carries incomplete_details', async () => {
    // A hard failure (no incomplete_details) still becomes response.failed —
    // see the test above. When transformStream marked this as an "ended
    // incomplete" outcome (incomplete_details present), the Responses-facing
    // client must see the more specific response.incomplete event, not a
    // generic hard failure.
    const events = await collectFormatStreamEvents(CLIENT_INCOMPLETE_MAX_EVENTS);

    expect(events.some((e) => e.type === 'response.completed')).toBe(false);
    expect(events.some((e) => e.type === 'response.failed')).toBe(false);
    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    expect(incompleteEvent.response.status).toBe('incomplete');
    expect(incompleteEvent.response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(incompleteEvent.response.output?.[0]?.content?.[0]?.text).toBe('partial output');
  });

  test('emits response.incomplete (content_filter) with incomplete_details and usage for a Responses-format client', async () => {
    const events = await collectFormatStreamEvents(CLIENT_INCOMPLETE_CONTENT_FILTER_EVENTS);

    expect(events.some((e) => e.type === 'response.failed')).toBe(false);
    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    expect(incompleteEvent.response.status).toBe('incomplete');
    expect(incompleteEvent.response.incomplete_details).toEqual({ reason: 'content_filter' });
    expect(incompleteEvent.response.usage.total_tokens).toBe(15);
  });

  test('a detail-less upstream response.incomplete still reaches a Responses client as response.incomplete (reason "unknown"), not response.failed', async () => {
    // Full pipeline (transformStream -> formatStream): when the upstream
    // omits incomplete_details entirely, the defaulted { reason: 'unknown' }
    // must keep the event on the incomplete path — without the default, the
    // missing field made formatStream downgrade the outcome to a hard
    // response.failed.
    const unified = await transformEvents(DETAIL_LESS_RESPONSES_EVENTS);
    const events = await collectFormatStreamEvents(unified);

    expect(events.some((e) => e.type === 'response.failed')).toBe(false);
    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    expect(incompleteEvent.response.status).toBe('incomplete');
    expect(incompleteEvent.response.incomplete_details).toEqual({ reason: 'unknown' });
    expect(incompleteEvent.response.output?.[0]?.content?.[0]?.text).toBe('partial output');
  });

  test('a detail-less upstream response.incomplete reaches a CHAT client as a normal "length" finish, not an error payload', async () => {
    // Full pipeline (transformStream -> OpenAI formatStream): the defaulted
    // finish hint ('length') must make the chat-facing formatter render the
    // detail-less incomplete as an ordinary finish — the same rendering
    // known-reason (max_output_tokens) incompletes already get — instead of
    // the hard-error payload it produced when finish_reason was absent.
    const unified = await transformEvents(DETAIL_LESS_CHAT_EVENTS);

    const reader = new OpenAITransformer()
      .formatStream(unifiedStreamFromChunks(unified))
      .getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    const chunks = output
      .split('\n\n')
      .filter((block) => block.trim().length > 0)
      .map((block) => {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        const payload = (dataLine as string).replace(/^data:\s*/, '');
        return payload === '[DONE]' ? '[DONE]' : JSON.parse(payload);
      });

    expect(chunks.some((chunk) => chunk !== '[DONE]' && chunk.error)).toBe(false);
    const finishChunk = chunks.find(
      (chunk) => chunk !== '[DONE]' && chunk.choices?.[0]?.finish_reason
    );
    expect(finishChunk).toBeDefined();
    expect(finishChunk.choices[0].finish_reason).toBe('length');
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('marks still-in-progress output items status "incomplete" when emitting response.incomplete', async () => {
    // Everything that was mid-stream when the upstream ended incomplete —
    // the reasoning item, the message item, and the tool call — was never
    // finished, so the finalized items must carry status 'incomplete', not a
    // fabricated 'completed'.
    const events = await collectFormatStreamEvents(CLIENT_INCOMPLETE_ITEMS_EVENTS);

    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    const outputItems = incompleteEvent.response.output;
    expect(outputItems.map((item: any) => item.type).sort()).toEqual([
      'function_call',
      'message',
      'reasoning',
    ]);
    for (const item of outputItems) {
      expect(item.status).toBe('incomplete');
    }

    // The finalization output_item.done events on this path carry the same
    // item-level status as the final response.incomplete output array.
    const doneEvents = events.filter((e) => e.type === 'response.output_item.done');
    expect(doneEvents.length).toBe(3);
    for (const done of doneEvents) {
      expect(done.item.status).toBe('incomplete');
    }
  });

  test('response.failed finalization keeps item statuses unchanged (completed)', async () => {
    const events = await collectFormatStreamEvents(CLIENT_FAILED_ITEMS_EVENTS);

    const failedEvent = events.find((e) => e.type === 'response.failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent.response.output).toHaveLength(1);
    expect(failedEvent.response.output[0].status).toBe('completed');
  });

  test('keeps emitting response.failed exactly as before for a genuine hard error (no incomplete_details)', async () => {
    const events = await collectFormatStreamEvents(CLIENT_HARD_ERROR_EVENTS);

    expect(events.some((e) => e.type === 'response.incomplete')).toBe(false);
    const failedEvent = events.find((e) => e.type === 'response.failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent.response.status).toBe('failed');
  });
});

describe('ResponsesTransformer transformStream -> OpenAITransformer formatStream (cross-format)', () => {
  // Proves the fix cross-format, not just within ResponsesTransformer: a
  // Responses-API UPSTREAM feeding a CHAT-format client (e.g. the client
  // sent Chat Completions but got routed to a Responses-API provider) must
  // still see the mapped finish reason and the propagated usage.
  async function transformAndFormatAsChat(events: Record<string, unknown>[]): Promise<any[]> {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        }
        controller.close();
      },
    });

    const unifiedStream = new ResponsesTransformer().transformStream(source);
    const chatStream = new OpenAITransformer().formatStream(unifiedStream);

    const reader = chatStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    return buffer
      .split('\n\n')
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        const data = (dataLine as string).replace(/^data:\s*/, '');
        return data === '[DONE]' ? '[DONE]' : JSON.parse(data);
      });
  }

  test('response.incomplete (content_filter) surfaces as a chat finish_reason "content_filter"', async () => {
    const chunks = await transformAndFormatAsChat(CHAT_INCOMPLETE_CONTENT_FILTER_EVENTS);

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'content_filter'
    );
    expect(finishChunk).toBeDefined();
    // A recognized non-fatal finish must NOT be rendered as an error payload.
    expect(chunks.some((c) => c !== '[DONE]' && c.error)).toBe(false);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('response.failed carrying usage propagates that usage to the chat client', async () => {
    const chunks = await transformAndFormatAsChat(CHAT_FAILED_USAGE_EVENTS);

    const usageChunk = chunks.find((c) => c !== '[DONE]' && c.usage);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.prompt_tokens).toBe(10);
    expect(usageChunk.usage.completion_tokens).toBe(5);
    expect(usageChunk.usage.total_tokens).toBe(15);
    // Still rendered as an error (this was a hard failure, not an incomplete).
    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
  });

  test('a streamed completed image_generation_call reaches a chat client as a markdown data-URI content delta', async () => {
    const chunks = await transformAndFormatAsChat(CHAT_IMAGE_EVENTS);

    const contentChunks = chunks.filter(
      (c) =>
        c !== '[DONE]' &&
        typeof c.choices?.[0]?.delta?.content === 'string' &&
        c.choices[0].delta.content.length > 0
    );
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0].choices[0].delta.content).toBe(TINY_IMAGE_MARKDOWN);
    expect(chunks.some((c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'stop')).toBe(
      true
    );
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('response.incomplete carrying usage propagates that usage to the chat client alongside the finish_reason', async () => {
    const chunks = await transformAndFormatAsChat(CHAT_INCOMPLETE_USAGE_EVENTS);

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'length'
    );
    expect(finishChunk).toBeDefined();
    expect(finishChunk.usage.total_tokens).toBe(10);
  });
});

// Typed client_tool_calls carry (see UnifiedClientToolCall in
// types/unified.ts) — a built-in Responses tool-call item whose execution is
// delegated to the CLIENT (`execution: "client"`, e.g. tool_search_call).
// Regression coverage for the bug this PR fixes: these items were previously
// silently dropped (unrecognized item type), leaving the client with no
// signal that a tool call was pending — the turn looked finished when it
// wasn't. Also locks in the fix for a follow-up bug found in review: unlike
// function_call, a client_tool_calls-only stream must NOT set finish_reason
// to 'tool_calls' — chat/messages-format clients have no way to represent
// this item (no delta.tool_calls gets populated for it), so upgrading
// finish_reason for them would send a 'tool_calls' finish with an empty
// tool_calls array, which SDKs commonly loop or throw on.
describe('ResponsesTransformer typed client_tool_calls carry (tool_search_call)', () => {
  function unifiedStreamFromChunks(chunks: any[]): ReadableStream {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  async function collectFormatStreamEvents(chunks: any[], transformer: any): Promise<any[]> {
    const reader = transformer.formatStream(unifiedStreamFromChunks(chunks)).getReader();
    const decoder = new TextDecoder();
    let output = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    return output
      .split('\n\n')
      .filter((block: string) => block.trim().length > 0)
      .map((block: string) => {
        const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
        const data = (dataLine as string).replace(/^data:\s*/, '');
        return data === '[DONE]' ? '[DONE]' : JSON.parse(data);
      });
  }

  describe('transformStream (inbound: Responses SSE -> unified chunks)', () => {
    test('a streamed tool_search_call item carries as a chunk-level client_tool_calls entry', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_STREAM_EVENTS);

      const toolChunks = chunks.filter((chunk) => chunk.client_tool_calls);
      expect(toolChunks).toHaveLength(1);
      expect(toolChunks[0].client_tool_calls).toEqual([createToolSearchItem()]);
      // Chunk-level, not inside delta — same reason as image_generation_calls.
      expect(toolChunks[0].delta.client_tool_calls).toBeUndefined();
    });

    test('the completed-fallback also carries the item, without double-carrying deduped items', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_DEDUPLICATION_EVENTS);

      expect(chunks.filter((chunk) => chunk.client_tool_calls)).toHaveLength(1);
    });

    test('a completed-only item (never streamed via output_item.done) still gets carried', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_COMPLETED_ONLY_EVENTS);

      const toolChunks = chunks.filter((chunk) => chunk.client_tool_calls);
      expect(toolChunks).toHaveLength(1);
      expect(toolChunks[0].client_tool_calls[0].id).toBe('tsc_9');
    });

    test('finishes with "stop", NOT "tool_calls", when the only output is a client_tool_calls item', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_STOP_EVENTS);

      expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('stop');
    });

    test('finishes with "stop" when a client_tool_calls item appears only in the completed response', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_COMPLETED_STOP_EVENTS);

      expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('stop');
    });

    test('a real function_call alongside a client_tool_calls item still finishes with "tool_calls"', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_WITH_FUNCTION_EVENTS);

      expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('tool_calls');
    });
  });

  describe('formatStream (outbound: unified chunks -> native Responses output)', () => {
    test('re-emits the typed item as a native tool_search_call output item', async () => {
      const events = await collectFormatStreamEvents(
        TOOL_SEARCH_NATIVE_CHUNKS,
        new ResponsesTransformer()
      );
      const completed = events.find((e) => e.type === 'response.completed');
      expect(completed).toBeDefined();
      const outputTypes = completed.response.output.map((o: any) => o.type);
      expect(outputTypes).toContain('tool_search_call');
      const native = completed.response.output.find((o: any) => o.type === 'tool_search_call');
      expect(native).toMatchObject({
        call_id: 'call_1',
        execution: 'client',
        arguments: { query: 'exec_command' },
      });
    });
  });

  describe('non-streaming round trip (transformResponse -> formatResponse)', () => {
    test('transformResponse extracts client_tool_calls and formatResponse re-emits it natively', async () => {
      const transformer = new ResponsesTransformer();
      const unified = await transformer.transformResponse(TOOL_SEARCH_UNARY_RESPONSE);

      expect(unified.client_tool_calls).toEqual([createToolSearchItem()]);

      const formatted = await transformer.formatResponse(unified);
      const native = formatted.output.find((o: any) => o.type === 'tool_search_call');
      expect(native).toMatchObject({ call_id: 'call_1', execution: 'client' });
    });
  });

  describe('cross-format (Responses -> Chat Completions): no false "tool_calls" finish', () => {
    test('a chat-format client never receives finish_reason "tool_calls" for a client_tool_calls-only turn', async () => {
      const chunks = await transformEvents(TOOL_SEARCH_CHAT_EVENTS);

      const chatEvents = await collectFormatStreamEvents(chunks, new OpenAITransformer());
      const finishEvent = chatEvents.find((e) => e !== '[DONE]' && e.choices?.[0]?.finish_reason);
      expect(finishEvent).toBeDefined();
      expect(finishEvent.choices[0].finish_reason).toBe('stop');
      // No tool_calls array should ever appear on any chunk for this client —
      // the chat formatter has no representation for client_tool_calls.
      expect(chatEvents.some((e) => e !== '[DONE]' && e.choices?.[0]?.delta?.tool_calls)).toBe(
        false
      );
    });
  });
});
