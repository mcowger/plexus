import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';
import { OpenAITransformer } from '../openai';

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
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-5', created_at: 1234567890 },
      },
      {
        type: 'response.output_item.added',
        output_index: 4,
        item: {
          id: 'fc_first',
          type: 'function_call',
          call_id: 'call_first',
          name: 'add_task',
        },
      },
      {
        type: 'response.output_item.added',
        output_index: 9,
        item: {
          id: 'fc_second',
          type: 'function_call',
          call_id: 'call_second',
          name: 'add_task',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 9,
        item_id: 'fc_second',
        delta: '{"title":"second"}',
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 4,
        item_id: 'fc_first',
        delta: '{"title":"first"}',
      },
    ]);

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
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_date',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_1',
        delta: '{"timezone":"UTC"}',
      },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      },
    ]);

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
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'Done' },
      { type: 'response.completed', response: {} },
    ]);

    expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('stop');
  });

  test('recognizes function calls present only in the completed response', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-4o', created_at: 1234567890 },
      },
      {
        type: 'response.completed',
        response: { output: [{ type: 'function_call' }] },
      },
    ]);

    expect(chunks.findLast((chunk) => chunk.finish_reason)?.finish_reason).toBe('tool_calls');
  });
});

describe('ResponsesTransformer stream transformation - error handling', () => {
  test('maps response.failed to a unified error chunk instead of dropping it', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_1', model: 'gpt-5', created_at: 1234567890 },
      },
      {
        type: 'response.failed',
        response: {
          id: 'resp_1',
          status: 'failed',
          error: { code: 'server_error', message: 'The model encountered an error.' },
        },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.message).toBe('The model encountered an error.');
    // No phantom success finish should accompany a failure.
    expect(chunks.some((chunk) => chunk.finish_reason === 'stop')).toBe(false);
  });

  test('maps response.incomplete (max_output_tokens) to a unified error chunk carrying a length finish hint and incomplete_details', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_2', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'Partial output' },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_2',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.finish_reason).toBe('length');
    expect(errorChunk.error.code).toBe('max_output_tokens');
    expect(errorChunk.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  test('maps response.incomplete (content_filter) to a unified error chunk carrying a content_filter finish hint and incomplete_details', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_cf', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'Partial' },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_cf',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
        },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.finish_reason).toBe('content_filter');
    expect(errorChunk.error.code).toBe('content_filter');
    expect(errorChunk.incomplete_details).toEqual({ reason: 'content_filter' });
  });

  test('propagates response.usage on response.failed into the unified error chunk', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_failusage', model: 'gpt-5', created_at: 1234567890 },
      },
      {
        type: 'response.failed',
        response: {
          id: 'resp_failusage',
          status: 'failed',
          error: { code: 'server_error', message: 'boom' },
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toEqual(
      expect.objectContaining({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
    );
  });

  test('propagates response.usage on response.incomplete into the unified error chunk', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_incompleteusage', model: 'gpt-5', created_at: 1234567890 },
      },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_incompleteusage',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toEqual(
      expect.objectContaining({ input_tokens: 20, output_tokens: 8, total_tokens: 28 })
    );
  });

  test('does not attach a usage field when response.failed/response.incomplete carry none', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_nousage', model: 'gpt-5', created_at: 1234567890 },
      },
      {
        type: 'response.failed',
        response: { id: 'resp_nousage', status: 'failed', error: { message: 'boom' } },
      },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.usage).toBeUndefined();
  });

  test('maps a generic top-level error event to a unified error chunk', async () => {
    const chunks = await transformEvents([
      {
        type: 'response.created',
        response: { id: 'resp_3', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'error', code: 'server_error', message: 'boom' },
    ]);

    const errorChunk = chunks.find((chunk) => chunk.event === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk.error.message).toBe('boom');
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
    const events = await collectFormatStreamEvents([
      {
        id: 'resp_err_1',
        model: 'gpt-5',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'resp_err_1',
        model: 'gpt-5',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: {
          statusCode: 500,
          code: 'server_error',
          message: 'The model encountered an error.',
        },
      },
    ]);

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
    const events = await collectFormatStreamEvents([
      {
        id: 'resp_err_2',
        model: 'gpt-5',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial output' },
        finish_reason: null,
      },
      {
        id: 'resp_err_2',
        model: 'gpt-5',
        created: 1234567890,
        event: 'error',
        delta: {},
        finish_reason: 'length',
        incomplete_details: { reason: 'max_output_tokens' },
        error: {
          statusCode: 500,
          code: 'max_output_tokens',
          message: 'Response ended incomplete: max_output_tokens',
        },
      },
    ]);

    expect(events.some((e) => e.type === 'response.completed')).toBe(false);
    expect(events.some((e) => e.type === 'response.failed')).toBe(false);
    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    expect(incompleteEvent.response.status).toBe('incomplete');
    expect(incompleteEvent.response.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(incompleteEvent.response.output?.[0]?.content?.[0]?.text).toBe('partial output');
  });

  test('emits response.incomplete (content_filter) with incomplete_details and usage for a Responses-format client', async () => {
    const events = await collectFormatStreamEvents([
      {
        id: 'resp_err_cf',
        model: 'gpt-5',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'resp_err_cf',
        model: 'gpt-5',
        created: 1234567890,
        event: 'error',
        delta: {},
        finish_reason: 'content_filter',
        incomplete_details: { reason: 'content_filter' },
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

    expect(events.some((e) => e.type === 'response.failed')).toBe(false);
    const incompleteEvent = events.find((e) => e.type === 'response.incomplete');
    expect(incompleteEvent).toBeDefined();
    expect(incompleteEvent.response.status).toBe('incomplete');
    expect(incompleteEvent.response.incomplete_details).toEqual({ reason: 'content_filter' });
    expect(incompleteEvent.response.usage.total_tokens).toBe(15);
  });

  test('keeps emitting response.failed exactly as before for a genuine hard error (no incomplete_details)', async () => {
    const events = await collectFormatStreamEvents([
      {
        id: 'resp_hard_err',
        model: 'gpt-5',
        created: 1234567890,
        delta: { role: 'assistant', content: 'partial' },
        finish_reason: null,
      },
      {
        id: 'resp_hard_err',
        model: 'gpt-5',
        created: 1234567890,
        event: 'error',
        delta: {},
        error: { statusCode: 500, code: 'server_error', message: 'The model response failed.' },
      },
    ]);

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
    const chunks = await transformAndFormatAsChat([
      {
        type: 'response.created',
        response: { id: 'resp_cf_chat', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'Partial' },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_cf_chat',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
        },
      },
    ]);

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'content_filter'
    );
    expect(finishChunk).toBeDefined();
    // A recognized non-fatal finish must NOT be rendered as an error payload.
    expect(chunks.some((c) => c !== '[DONE]' && c.error)).toBe(false);
    expect(chunks.at(-1)).toBe('[DONE]');
  });

  test('response.failed carrying usage propagates that usage to the chat client', async () => {
    const chunks = await transformAndFormatAsChat([
      {
        type: 'response.created',
        response: { id: 'resp_fail_usage', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'partial' },
      {
        type: 'response.failed',
        response: {
          id: 'resp_fail_usage',
          status: 'failed',
          error: { code: 'server_error', message: 'boom' },
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]);

    const usageChunk = chunks.find((c) => c !== '[DONE]' && c.usage);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.prompt_tokens).toBe(10);
    expect(usageChunk.usage.completion_tokens).toBe(5);
    expect(usageChunk.usage.total_tokens).toBe(15);
    // Still rendered as an error (this was a hard failure, not an incomplete).
    const errorChunk = chunks.find((c) => c !== '[DONE]' && c.error);
    expect(errorChunk).toBeDefined();
  });

  test('response.incomplete carrying usage propagates that usage to the chat client alongside the finish_reason', async () => {
    const chunks = await transformAndFormatAsChat([
      {
        type: 'response.created',
        response: { id: 'resp_incomplete_usage', model: 'gpt-5', created_at: 1234567890 },
      },
      { type: 'response.output_text.delta', delta: 'partial' },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_incomplete_usage',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
        },
      },
    ]);

    const finishChunk = chunks.find(
      (c) => c !== '[DONE]' && c.choices?.[0]?.finish_reason === 'length'
    );
    expect(finishChunk).toBeDefined();
    expect(finishChunk.usage.total_tokens).toBe(10);
  });
});
