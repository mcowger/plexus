import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';

function responsesEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

describe('ResponsesTransformer stream transformation', () => {
  test('keeps parallel function calls distinct when their argument deltas are interleaved', async () => {
    const transformer = new ResponsesTransformer();
    const source = [
      responsesEvent('response.created', {
        response: { id: 'resp_1', model: 'gpt-5', created_at: 1234567890 },
      }),
      responsesEvent('response.output_item.added', {
        output_index: 4,
        item: {
          id: 'fc_first',
          type: 'function_call',
          call_id: 'call_first',
          name: 'add_task',
        },
      }),
      responsesEvent('response.output_item.added', {
        output_index: 9,
        item: {
          id: 'fc_second',
          type: 'function_call',
          call_id: 'call_second',
          name: 'add_task',
        },
      }),
      responsesEvent('response.function_call_arguments.delta', {
        output_index: 9,
        item_id: 'fc_second',
        delta: '{"title":"second"}',
      }),
      responsesEvent('response.function_call_arguments.delta', {
        output_index: 4,
        item_id: 'fc_first',
        delta: '{"title":"first"}',
      }),
    ].join('');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(source));
        controller.close();
      },
    });

    const reader = transformer.transformStream(stream).getReader();
    const chunks: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const toolCallChunks = chunks.filter((chunk) => chunk.delta.tool_calls);
    expect(toolCallChunks).toEqual([
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
});
