import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';
import { OpenAITransformer } from '../openai';
import requestFixture from './fixtures/codex-lite-openrouter-chat-request.json';
import responseChunksFixture from './fixtures/codex-lite-openrouter-chat-response-chunks.json';

/**
 * Golden-trace regression test: real request/response captured from a
 * confirmed-correct live staging interaction (Codex CLI "lite" mode,
 * `additional_tools` input item, OpenRouter forced into chat-completions
 * mode: `openrouter-s` / `openai/gpt-5.6-luna`). Fixtures are the untrimmed
 * `rawRequest` and parsed `rawResponse` SSE chunks from staging trace
 * d083e55a-3f23-41a6-9c82-9a79d18a99ad. Replays them through the actual
 * transform pipeline (ResponsesTransformer.parseRequest ->
 * OpenAITransformer.transformStream -> ResponsesTransformer.formatStream)
 * and asserts against the real, observed-correct output.
 */

function sseStreamFromChunks(chunks: any[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

async function collectFormatStreamEvents(
  responsesTransformer: ResponsesTransformer,
  chunks: any[]
): Promise<any[]> {
  const openaiTransformer = new OpenAITransformer();
  const unifiedStream = openaiTransformer.transformStream(sseStreamFromChunks(chunks));
  const formatted = responsesTransformer.formatStream(unifiedStream);

  const reader = formatted.getReader();
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
    })
    .filter((event) => event.type !== '[DONE]');
}

describe('golden trace: Codex CLI lite mode against OpenRouter chat completions (staging d083e55a)', () => {
  test('parseRequest lifts additional_tools and preserves custom tool call history', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(requestFixture);

    const toolNames = unified.tools?.map((t: any) => t.function.name);
    expect(toolNames).toEqual(expect.arrayContaining(['exec', 'wait', 'request_user_input']));

    const execTool: any = unified.tools?.find((t: any) => t.function.name === 'exec');
    expect(execTool?.function?.parameters?.properties).toHaveProperty('input');

    const toolCallMessages = unified.messages.filter(
      (m: any) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    const execCalls = toolCallMessages.flatMap((m: any) =>
      m.tool_calls.filter((tc: any) => tc.function.name === 'exec')
    );
    expect(execCalls.length).toBeGreaterThan(0);

    const toolResultMessages = unified.messages.filter((m: any) => m.role === 'tool');
    expect(toolResultMessages.length).toBe(7);
  });

  test('additional_tools input item does not leak into the message list', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(requestFixture);

    expect(
      unified.messages.some((m: any) => JSON.stringify(m).includes('"type":"additional_tools"'))
    ).toBe(false);
  });

  test('end-to-end: the real OpenRouter chat-completion-chunk stream is converted back into a correct custom_tool_call for exec', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest(requestFixture);

    const events = await collectFormatStreamEvents(transformer, responseChunksFixture as any[]);

    const doneEvent = events.find(
      (e) => e.type === 'response.output_item.done' && e.item?.type === 'custom_tool_call'
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent.item.name).toBe('exec');
    expect(doneEvent.item.call_id).toBe('call_x1iAotVivK6LxSOhrkT9PeQ0');
    expect(doneEvent.item.input).toContain(
      'const r = await tools.exec_command({cmd:"nl -ba packages/plexus-models/src/convert.ts'
    );
    expect(doneEvent.item.input.endsWith('text(r.output);')).toBe(true);

    // Custom tool input is freeform JS wrapped in `{"input": ...}` JSON on
    // the wire; it can't be safely unwrapped from partial deltas, so no
    // function_call_arguments.delta events should be emitted for it.
    expect(events.some((e) => e.type === 'response.function_call_arguments.delta')).toBe(false);

    const completedEvent = events.find((e) => e.type === 'response.completed');
    expect(completedEvent).toBeDefined();
  });
});
