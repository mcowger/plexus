import { describe, expect, test } from 'vitest';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { OpenAITransformer } from '../openai';
import { GEMINI_MALFORMED_FUNCTION_CALL_CODE } from '../../utils/gemini-malformed-function-call';

function unifiedStreamFromChunks(chunks: any[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function readOpenAISSEChunks(stream: ReadableStream<Uint8Array>): Promise<any[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: any[] = [];

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (event.data === '[DONE]') {
        chunks.push('[DONE]');
        return;
      }
      chunks.push(JSON.parse(event.data));
    },
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }

  return chunks;
}

describe('OpenAITransformer.formatStream robustness', () => {
  test('emits a synthesized stop finish chunk before [DONE] when the source ends with no finish_reason', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_1',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant', content: 'Hi' },
        finish_reason: null,
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    expect(chunks.at(-1)).toBe('[DONE]');

    const finishChunks = chunks.filter((c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason);
    expect(finishChunks).toHaveLength(1);
    expect(finishChunks[0].choices[0].finish_reason).toBe('stop');
    expect(finishChunks[0].choices[0].delta).toEqual({});
    // The flushed stop chunk echoes the id/model seen on the stream.
    expect(finishChunks[0].id).toBe('chatcmpl_1');
    expect(finishChunks[0].model).toBe('gpt-4o');
  });

  test('synthesizes an id on the flushed stop chunk when ZERO chunks arrived', async () => {
    const formatted = new OpenAITransformer().formatStream(unifiedStreamFromChunks([]));
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    expect(chunks.at(-1)).toBe('[DONE]');
    const payloadChunks = chunks.filter((c) => c !== '[DONE]');
    expect(payloadChunks).toHaveLength(1);

    const stopChunk = payloadChunks[0];
    expect(stopChunk.object).toBe('chat.completion.chunk');
    expect(stopChunk.choices).toEqual([{ index: 0, delta: {}, finish_reason: 'stop' }]);
    // No upstream id ever arrived — one must be synthesized so the stop
    // chunk is still a well-formed chat.completion.chunk.
    expect(stopChunk.id).toMatch(/^chatcmpl_/);
    // formatStream's only input is the unified chunk stream itself (the
    // formatter has no request context); with zero chunks no model is
    // reachable, so none is fabricated.
    expect(stopChunk).not.toHaveProperty('model');
  });

  test('does not synthesize an extra finish chunk when one already arrived', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_2',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { content: 'Hi' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_2',
        model: 'gpt-4o',
        created: 1234567890,
        delta: {},
        finish_reason: 'stop',
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const finishChunks = chunks.filter((c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason);
    expect(finishChunks).toHaveLength(1);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('renders a unified error chunk carrying a recognizable finish_reason (length) as a normal finish, not an error payload', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_3',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_3',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        finish_reason: 'length',
        error: {
          statusCode: 500,
          code: 'max_output_tokens',
          message: 'Response ended incomplete: max_output_tokens',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeUndefined();

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'length'
    );
    expect(finishChunk).toBeDefined();
    expect(finishChunk.choices[0].delta).toEqual({});
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('renders a hard unified error chunk (no finish_reason) as an error payload and still terminates with [DONE]', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_4',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_4',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: {
          statusCode: 500,
          code: 'response_failed',
          message: 'The model response failed.',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.message).toBe('The model response failed.');
    expect(errorChunk.error.type).toBe('server_error');
    // The rendered code must be the real upstream code, not Gemini's
    // hardcoded legacy sentinel (see the MALFORMED_FUNCTION_CALL test below).
    expect(errorChunk.error.code).toBe('response_failed');
    expect(chunks.at(-1)).toBe('[DONE]');

    // Never emit two finish/terminal chunks.
    const terminalChunks = chunks.filter(
      (c) => c !== '[DONE]' && (c.error || c.choices?.[0]?.finish_reason)
    );
    expect(terminalChunks).toHaveLength(1);
  });

  test('falls back to a neutral generic error code when the upstream error carries none', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_4b',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: {
          statusCode: 500,
          message: 'Something went wrong upstream with no code attached.',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.code).toBe('upstream_error');
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('preserves existing behavior: MALFORMED_FUNCTION_CALL errors keep their exact code and still suppress [DONE]', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_5',
        model: 'gemini-3.6-flash',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: {
          statusCode: 503,
          code: GEMINI_MALFORMED_FUNCTION_CALL_CODE,
          message: 'Upstream Gemini returned MALFORMED_FUNCTION_CALL — please retry your request.',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    expect(chunks).not.toContain('[DONE]');
    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
    // Unchanged legacy rendering — NOT the raw `MALFORMED_FUNCTION_CALL` code.
    expect(errorChunk.error.code).toBe('upstream_malformed_function_call');
  });

  test('closes the door after an error-channel length finish: a stray chunk afterward produces no second terminal payload', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_6',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_6',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        finish_reason: 'length',
        error: {
          statusCode: 500,
          code: 'max_output_tokens',
          message: 'Response ended incomplete: max_output_tokens',
        },
      },
      // Stray/duplicate chunk arriving after the terminal signal (e.g. a
      // late or duplicated upstream error) must never reach the client.
      {
        id: 'chatcmpl_6',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: {
          statusCode: 500,
          code: 'response_failed',
          message: 'This must never reach the client.',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const terminalChunks = chunks.filter(
      (c) => c !== '[DONE]' && (c.error || c.choices?.[0]?.finish_reason)
    );
    expect(terminalChunks).toHaveLength(1);
    expect(terminalChunks[0].choices?.[0]?.finish_reason).toBe('length');
    expect(chunks.some((c) => c !== '[DONE]' && c.error)).toBe(false);

    const doneCount = chunks.filter((c) => c === '[DONE]').length;
    expect(doneCount).toBe(1);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('round-trips a raw stream_options.include_usage fixture: content, one finish, one usage, one [DONE]', async () => {
    // Mirrors the real OpenAI-compatible wire shape Plexus itself requests
    // for Copilot-native streaming (services/oauth/oauth-native-request.ts
    // `adornCopilotBody`): a trailing `{choices: [], usage: {...}}` frame
    // arrives AFTER the real finish chunk.
    const rawSSE = [
      JSON.stringify({
        id: 'chatcmpl-abc',
        model: 'gpt-4o',
        created: 1234567890,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' }, finish_reason: null }],
      }),
      JSON.stringify({
        id: 'chatcmpl-abc',
        model: 'gpt-4o',
        created: 1234567890,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      JSON.stringify({
        id: 'chatcmpl-abc',
        model: 'gpt-4o',
        created: 1234567890,
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    ];

    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of rawSSE) {
          controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const transformer = new OpenAITransformer();
    const unifiedStream = transformer.transformStream(rawStream);
    const formatted = transformer.formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const contentChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.delta?.content === 'Hi'
    );
    expect(contentChunk).toBeDefined();

    const finishChunks = chunks.filter((c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason);
    expect(finishChunks).toHaveLength(1);
    expect(finishChunks[0].choices[0].finish_reason).toBe('stop');

    const usageChunks = chunks.filter((c) => c !== '[DONE]' && c.usage);
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0].choices).toEqual([]);
    expect(usageChunks[0].usage.total_tokens).toBe(15);

    expect(chunks.some((c) => c !== '[DONE]' && c.error)).toBe(false);
    expect(chunks.filter((c) => c === '[DONE]')).toHaveLength(1);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('propagates usage on a recognizable finish (error-channel, e.g. Responses incomplete/content_filter)', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_cf',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_cf',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        finish_reason: 'content_filter',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0,
        },
        error: {
          statusCode: 500,
          code: 'content_filter',
          message: 'Response ended incomplete: content_filter',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'content_filter'
    );
    expect(finishChunk).toBeDefined();
    expect(finishChunk.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: null,
      reasoning_tokens: 0,
    });
  });

  test('propagates usage on a hard error chunk (e.g. Responses response.failed)', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_failusage',
        model: 'gpt-4o',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_failusage',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0,
        },
        error: {
          statusCode: 500,
          code: 'response_failed',
          message: 'The model response failed.',
        },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage.total_tokens).toBe(28);
  });

  test('does not add a usage field to a hard error chunk when the unified chunk carries none', async () => {
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_nousage',
        model: 'gpt-4o',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: { statusCode: 500, code: 'response_failed', message: 'The model response failed.' },
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toBeUndefined();
  });

  test('a Gemini trailing done-marker chunk after a normal finish is dropped harmlessly (no crash, no extra terminal payload)', async () => {
    // Gemini's transformStream always emits a `{event: 'done', delta: {}}`
    // marker chunk when it sees the raw `[DONE]` sentinel, even after a
    // normal finish. It carries no usage, so it must NOT hit the new
    // trailing-usage-passthrough lane — it should simply be dropped, exactly
    // as it already was.
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_7',
        model: 'gemini-3.1-flash',
        created: 1234567890,
        delta: { role: 'assistant', content: 'Hi' },
        finish_reason: null,
      },
      {
        id: 'chatcmpl_7',
        model: 'gemini-3.1-flash',
        created: 1234567890,
        delta: {},
        finish_reason: 'stop',
      },
      {
        id: '',
        model: '',
        created: 1234567890,
        event: 'done',
        delta: {},
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const finishChunks = chunks.filter((c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason);
    expect(finishChunks).toHaveLength(1);
    expect(chunks.some((c) => c !== '[DONE]' && c.usage)).toBe(false);
    expect(chunks.some((c) => c !== '[DONE]' && c.error)).toBe(false);
    expect(chunks.filter((c) => c === '[DONE]')).toHaveLength(1);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('a unified chunk carrying typed image_generation_calls renders ONLY the markdown content into chat SSE', async () => {
    // responses.ts transformStream pairs each completed image item's typed
    // carry (chunk-level `image_generation_calls`, full base64) with its
    // chat-format markdown rendering on `delta.content`. A chat-format
    // client must receive exactly the markdown — the typed field (which can
    // hold multi-megabyte, uncapped base64) must never leak into the chat
    // wire chunk.
    const markdown = '![generated image](data:image/png;base64,aGVsbG8=)';
    const unifiedStream = unifiedStreamFromChunks([
      {
        id: 'chatcmpl_img',
        model: 'gpt-image-model',
        created: 1234567890,
        delta: { content: markdown },
        image_generation_calls: [{ id: 'ig_1', status: 'completed', result: 'aGVsbG8=' }],
        finish_reason: null,
      },
      {
        id: 'chatcmpl_img',
        model: 'gpt-image-model',
        created: 1234567890,
        delta: {},
        finish_reason: 'stop',
      },
    ]);

    const formatted = new OpenAITransformer().formatStream(unifiedStream);
    const chunks = await readOpenAISSEChunks(formatted as ReadableStream<Uint8Array>);

    const contentChunks = chunks.filter((c) => c !== '[DONE]' && c.choices?.[0]?.delta?.content);
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0].choices[0].delta.content).toBe(markdown);
    expect(
      chunks.some((c) => c !== '[DONE]' && JSON.stringify(c).includes('image_generation_calls'))
    ).toBe(false);
  });
});
