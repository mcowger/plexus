import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';

/**
 * Namespace spellings real clients put on the wire, captured from live Muse
 * Code 1.4.2 and Codex CLI 0.159.2 traffic through Plexus:
 *   - Muse replays a namespaced call as `name: "muse.bash"` with no
 *     `namespace` field (trace bada4dd6 — OpenAI 400'd the unflattened name).
 *   - Codex lite nests the custom `exec` tool inside its `functions`
 *     namespace; OpenAI returns, and Codex replays, that call as a bare
 *     `custom_tool_call` named `exec` (trace 43e695c0). Returning it as a JSON
 *     function_call made Codex reject the payload (trace 811c4f5d).
 */

const MUSE_TOOLS = [
  {
    type: 'namespace',
    name: 'muse',
    tools: [
      { type: 'function', name: 'bash', parameters: { type: 'object', properties: {} } },
      { type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } },
    ],
  },
];

const CODEX_LITE_ADDITIONAL_TOOLS = {
  type: 'additional_tools',
  role: 'developer',
  tools: [
    {
      type: 'namespace',
      name: 'functions',
      tools: [
        { type: 'custom', name: 'exec', description: 'Run code' },
        { type: 'function', name: 'wait', parameters: { type: 'object', properties: {} } },
      ],
    },
  ],
};

const USER_MESSAGE = {
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text: 'hi' }],
};

async function collectFormatStreamEvents(
  transformer: ResponsesTransformer,
  chunks: any[]
): Promise<any[]> {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const reader = transformer.formatStream(stream).getReader();
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

function toolCallChunks(name: string, args: string): any[] {
  return [
    {
      id: 'resp_1',
      model: 'm',
      created: 1,
      delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name, arguments: '' } }] },
      finish_reason: null,
    },
    {
      id: 'resp_1',
      model: 'm',
      created: 1,
      delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
      finish_reason: null,
    },
    { id: 'resp_1', model: 'm', created: 1, delta: null, finish_reason: 'tool_calls' },
  ];
}

describe('Muse Code dotted namespace history', () => {
  test('parseRequest flattens `muse.bash` history to the declared flat tool name', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'm',
      tools: MUSE_TOOLS,
      input: [
        USER_MESSAGE,
        { type: 'function_call', call_id: 'call_1', name: 'muse.bash', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      ],
    });

    const call = unified.messages.find((m) => m.tool_calls)?.tool_calls?.[0];
    expect(call?.function.name).toBe('muse__bash');
  });

  test('leaves a dotted name alone when no matching namespace is declared', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'm',
      tools: [{ type: 'function', name: 'x.y', parameters: {} }],
      input: [{ type: 'function_call', call_id: 'call_1', name: 'x.y', arguments: '{}' }],
    });

    expect(unified.messages[0]?.tool_calls?.[0]?.function.name).toBe('x.y');
  });
});

describe('Codex lite custom tools nested in a namespace', () => {
  test('parseRequest exposes a nested custom tool as a string-input function', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'm',
      input: [CODEX_LITE_ADDITIONAL_TOOLS, USER_MESSAGE],
    });

    const exec = unified.tools?.find((t: any) => t.function?.name === 'functions__exec');
    expect(exec?.function?.parameters).toEqual({
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    });
  });

  test('parseRequest maps bare `exec` custom_tool_call history to the nested tool', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'm',
      input: [
        CODEX_LITE_ADDITIONAL_TOOLS,
        USER_MESSAGE,
        { type: 'custom_tool_call', call_id: 'call_1', name: 'exec', input: 'text("hi")' },
        { type: 'custom_tool_call_output', call_id: 'call_1', output: 'hi' },
      ],
    });

    const call = unified.messages.find((m) => m.tool_calls)?.tool_calls?.[0];
    expect(call?.function).toEqual({
      name: 'functions__exec',
      arguments: JSON.stringify({ input: 'text("hi")' }),
    });
  });

  test('formatResponse returns a nested custom tool call as custom_tool_call', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'm',
      input: [CODEX_LITE_ADDITIONAL_TOOLS, USER_MESSAGE],
    });

    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'm',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'functions__exec', arguments: JSON.stringify({ input: 'ls' }) },
        },
      ],
    });

    const item = formatted.output.find((i: any) => i.call_id === 'call_1');
    expect(item).toMatchObject({ type: 'custom_tool_call', name: 'exec', input: 'ls' });
    expect(item).not.toHaveProperty('namespace');
  });

  test('formatResponse resolves an upstream bare `exec` name to the nested custom tool', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'm',
      input: [CODEX_LITE_ADDITIONAL_TOOLS, USER_MESSAGE],
    });

    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'm',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'exec', arguments: JSON.stringify({ input: 'ls' }) },
        },
      ],
    });

    expect(formatted.output.find((i: any) => i.call_id === 'call_1')).toMatchObject({
      type: 'custom_tool_call',
      name: 'exec',
      input: 'ls',
    });
  });

  test('formatStream returns a nested custom tool call as custom_tool_call', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'm',
      input: [CODEX_LITE_ADDITIONAL_TOOLS, USER_MESSAGE],
    });

    const events = await collectFormatStreamEvents(
      transformer,
      toolCallChunks('functions__exec', JSON.stringify({ input: 'ls' }))
    );

    const added = events.find((e) => e.type === 'response.output_item.added' && e.item?.call_id);
    expect(added.item).toMatchObject({ type: 'custom_tool_call', name: 'exec' });
    const done = events.find((e) => e.type === 'response.output_item.done' && e.item?.call_id);
    expect(done.item).toMatchObject({ type: 'custom_tool_call', name: 'exec', input: 'ls' });
    expect(events.some((e) => e.type === 'response.function_call_arguments.delta')).toBe(false);
  });

  test('a nested function tool still splits back with its namespace', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'm',
      input: [CODEX_LITE_ADDITIONAL_TOOLS, USER_MESSAGE],
    });

    const events = await collectFormatStreamEvents(
      transformer,
      toolCallChunks('functions__wait', '{}')
    );

    const done = events.find((e) => e.type === 'response.output_item.done' && e.item?.call_id);
    expect(done.item).toMatchObject({
      type: 'function_call',
      name: 'wait',
      namespace: 'functions',
    });
  });
});
