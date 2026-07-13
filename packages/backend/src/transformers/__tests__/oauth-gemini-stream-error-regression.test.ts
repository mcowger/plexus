import { describe, expect, test } from 'vitest';
import { piAiEventToChunk } from '../oauth/type-mappers';
import { formatGeminiStream } from '../gemini/stream-formatter';

function createUnifiedChunkStream(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function readUtf8(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

describe('OAuth -> Gemini stream error regression', () => {
  // Gemini uses the 'delta' identity channel — the mirror image of Codex/Anthropic.
  // Background: commit 082d33f8 ("Gemini compatibility") suppressed the start chunk
  // because the old Gemini formatter emitted a functionCall part per chunk, so an
  // empty-args start chunk produced a premature/malformed `args:{}` call. That
  // suppression is still correct. But the current formatter reads the function name
  // ONLY from the delta stream and drops any call whose name never arrives, so the
  // identity must ride on the deltas. The three tests below lock down both halves
  // of that contract. See toolCallIdentityChannel() in ../oauth/type-mappers.ts.
  test('piAiEventToChunk suppresses tool call start chunks for Gemini', () => {
    const chunk = piAiEventToChunk(
      {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: {
          content: [
            {
              type: 'toolCall',
              id: 'call_1',
              name: 'manage_todo_list',
              arguments: {},
            },
          ],
        },
      } as any,
      'gemini-3-flash-preview',
      'google-gemini-cli'
    );

    // Half 1: no start chunk. An empty-args start chunk historically produced a
    // malformed functionCall in the Gemini formatter (see commit 082d33f8).
    expect(chunk).toBeNull();
  });

  test('piAiEventToChunk keeps tool identity on Gemini argument deltas', () => {
    const partial = {
      content: [
        {
          type: 'toolCall',
          id: 'call_1',
          name: 'manage_todo_list',
          arguments: {},
        },
      ],
    };

    const delta = piAiEventToChunk(
      {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"status":"done"}',
        partial,
      } as any,
      'gemini-3-flash-preview',
      'google-gemini-cli'
    );

    // Half 2: because there is no start chunk, the delta MUST carry id + name.
    // gemini/stream-formatter.ts sets `state.name = tc.function.name` from deltas
    // and drops the call via `if (!state.name) return null;` if it never arrives.
    // The first cut of #719 stripped identity from all deltas, which made every
    // Gemini tool call vanish — this asserts we don't regress to that.
    expect(delta?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'manage_todo_list', arguments: '{"status":"done"}' },
    });
  });

  // End-to-end guard: drive real mapper output through the real Gemini formatter.
  // A unit test on the mapper alone would not have caught the dropped-tool-call
  // regression, because the harm only shows up once the formatter tries (and fails)
  // to build a functionCall with no name. This is the test that actually exercises
  // that path — start event suppressed, identity + args accumulated from deltas,
  // a well-formed functionCall emitted on completion.
  test('formatGeminiStream emits a functionCall for a Gemini tool call with no start chunk', async () => {
    const partial = {
      content: [{ type: 'toolCall', id: 'call_1', name: 'get_weather', arguments: {} }],
    };

    const events = [
      { type: 'toolcall_start', contentIndex: 0, partial },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{"city":', partial },
      { type: 'toolcall_delta', contentIndex: 0, delta: '"sf"}', partial },
      { type: 'done', reason: 'tool_use', message: {} },
    ];

    const unifiedChunks = events
      .map((event) => piAiEventToChunk(event as any, 'gemini-3-flash-preview', 'google-gemini-cli'))
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null);

    const output = await readUtf8(
      formatGeminiStream(createUnifiedChunkStream(unifiedChunks)) as ReadableStream<Uint8Array>
    );

    expect(output).toContain('"functionCall"');
    expect(output).toContain('"get_weather"');
    expect(output).toContain('"city"');
    expect(output).toContain('"sf"');
  });

  test('piAiEventToChunk maps oauth error message into chunk content', () => {
    const chunk = piAiEventToChunk(
      {
        type: 'error',
        reason: 'error',
        error: {
          message: 'upstream quota exceeded',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      } as any,
      'gemini-3-flash-preview',
      'github-copilot'
    );

    expect(chunk).toBeDefined();
    expect(chunk?.finish_reason).toBe('error');
    expect(chunk?.delta?.content).toBe('upstream quota exceeded');
  });

  test('formatGeminiStream suppresses partial tool call args until completion', async () => {
    const stream = createUnifiedChunkStream([
      {
        id: 'oauth-1',
        model: 'gemini-3-flash-preview',
        created: Math.floor(Date.now() / 1000),
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: {
                name: 'manage_todo_list',
                arguments: '{"items":[',
              },
            },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'oauth-1',
        model: 'gemini-3-flash-preview',
        created: Math.floor(Date.now() / 1000),
        delta: {
          content: 'done',
        },
        finish_reason: 'stop',
      },
    ]);

    const formatted = formatGeminiStream(stream);
    const output = await readUtf8(formatted as ReadableStream<Uint8Array>);

    expect(output).not.toContain('functionCall');
    expect(output).toContain('"finishReason":"STOP"');
  });
});
