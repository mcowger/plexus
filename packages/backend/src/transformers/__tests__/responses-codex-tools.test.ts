import { describe, expect, test } from 'vitest';
import { ResponsesTransformer } from '../responses';

/**
 * Codex CLI extensions: namespace tool flattening/split-back, and custom
 * (freeform) tool normalization (e.g. apply_patch), matching the wire shape
 * of codex-ollama-proxy's customToolArgumentsForModel/customToolInput.
 */

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

describe('Codex CLI namespace tool flattening', () => {
  test('parseRequest flattens namespace tools to flat function tools', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [
            {
              type: 'function',
              name: 'list_open_orders',
              description: 'List open orders',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    });

    expect(unified.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'crm__list_open_orders',
          description: 'List open orders',
          parameters: { type: 'object', properties: {} },
          strict: undefined,
        },
      },
    ]);
  });

  test('parseRequest joins namespaced function_call input items to the flat name', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'list_open_orders',
          namespace: 'crm',
          arguments: '{}',
        },
      ],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [{ type: 'function', name: 'list_open_orders', parameters: {} }],
        },
      ],
    });

    expect(unified.messages[0]?.tool_calls?.[0]?.function.name).toBe('crm__list_open_orders');
  });

  test('formatResponse splits a flattened tool call back into namespace + name', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [{ type: 'function', name: 'list_open_orders', parameters: {} }],
        },
      ],
    });

    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-5.6',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'crm__list_open_orders', arguments: '{}' },
        },
      ],
    });

    const toolCallItem = formatted.output.find((item: any) => item.type === 'function_call');
    expect(toolCallItem).toMatchObject({
      name: 'list_open_orders',
      namespace: 'crm',
      arguments: '{}',
    });
  });

  test('formatStream splits a flattened tool call back into namespace + name', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [{ type: 'function', name: 'list_open_orders', parameters: {} }],
        },
      ],
    });

    const events = await collectFormatStreamEvents(transformer, [
      {
        id: 'resp_1',
        model: 'gpt-5.6',
        created: 1,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'crm__list_open_orders', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'resp_1',
        model: 'gpt-5.6',
        created: 1,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
        finish_reason: null,
      },
      { id: 'resp_1', model: 'gpt-5.6', created: 1, delta: null, finish_reason: 'tool_calls' },
    ]);

    const addedEvent = events.find(
      (e) => e.type === 'response.output_item.added' && e.item?.type === 'function_call'
    );
    expect(addedEvent.item).toMatchObject({ name: 'list_open_orders', namespace: 'crm' });

    const doneEvent = events.find(
      (e) => e.type === 'response.output_item.done' && e.item?.type === 'function_call'
    );
    expect(doneEvent.item).toMatchObject({
      name: 'list_open_orders',
      namespace: 'crm',
      arguments: '{}',
    });
  });
});

describe('Codex CLI custom (freeform) tool normalization', () => {
  test('parseRequest exposes a custom tool as a function tool taking string input', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch', description: 'Apply a patch' }],
    });

    expect(unified.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'apply_patch',
          description: 'Apply a patch',
          parameters: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
        },
      },
    ]);
  });

  test('parseRequest wraps custom_tool_call raw input as JSON function-call arguments', async () => {
    const transformer = new ResponsesTransformer();
    const rawPatch = '*** Begin Patch\n*** Update File: foo.ts\n*** End Patch';
    const unified = await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [
        { type: 'custom_tool_call', call_id: 'call_1', name: 'apply_patch', input: rawPatch },
      ],
    });

    const toolCall = unified.messages[0]?.tool_calls?.[0];
    expect(toolCall?.function.name).toBe('apply_patch');
    expect(JSON.parse(toolCall!.function.arguments)).toEqual({ input: rawPatch });
  });

  test('parseRequest converts custom_tool_call_output the same as function_call_output', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'custom_tool_call_output', call_id: 'call_1', output: 'patch applied' }],
    });

    expect(unified.messages[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'patch applied',
    });
  });

  test('formatResponse converts a custom tool call back to custom_tool_call with unwrapped input', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const rawPatch = '*** Begin Patch\n*** Update File: foo.ts\n*** End Patch';
    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-5.6',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'apply_patch', arguments: JSON.stringify({ input: rawPatch }) },
        },
      ],
    });

    const customToolItem = formatted.output.find((item: any) => item.type === 'custom_tool_call');
    expect(customToolItem).toMatchObject({ name: 'apply_patch', input: rawPatch });
  });

  test('customToolInput unwraps {command:[...]} tuple form some models emit', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const rawPatch = '*** Begin Patch\n*** End Patch';
    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-5.6',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'apply_patch',
            arguments: JSON.stringify({ command: ['apply_patch', rawPatch] }),
          },
        },
      ],
    });

    const customToolItem = formatted.output.find((item: any) => item.type === 'custom_tool_call');
    expect(customToolItem).toMatchObject({ name: 'apply_patch', input: rawPatch });
  });

  test('customToolInput passes through a raw patch string unchanged', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const rawPatch = '*** Begin Patch\n*** End Patch';
    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-5.6',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'apply_patch', arguments: rawPatch },
        },
      ],
    });

    const customToolItem = formatted.output.find((item: any) => item.type === 'custom_tool_call');
    expect(customToolItem).toMatchObject({ name: 'apply_patch', input: rawPatch });
  });

  test('formatStream converts a custom tool call back to custom_tool_call with unwrapped input', async () => {
    const transformer = new ResponsesTransformer();
    await transformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const rawPatch = '*** Begin Patch\n*** End Patch';
    const events = await collectFormatStreamEvents(transformer, [
      {
        id: 'resp_1',
        model: 'gpt-5.6',
        created: 1,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'apply_patch', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
      {
        id: 'resp_1',
        model: 'gpt-5.6',
        created: 1,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: rawPatch }) } }],
        },
        finish_reason: null,
      },
      { id: 'resp_1', model: 'gpt-5.6', created: 1, delta: null, finish_reason: 'tool_calls' },
    ]);

    const addedEvent = events.find(
      (e) => e.type === 'response.output_item.added' && e.item?.type === 'custom_tool_call'
    );
    expect(addedEvent).toBeDefined();
    expect(addedEvent.item).toMatchObject({ name: 'apply_patch' });

    // Custom tool input can't be unwrapped from partial JSON, so no
    // response.function_call_arguments.delta should be emitted for it.
    expect(events.some((e) => e.type === 'response.function_call_arguments.delta')).toBe(false);

    const doneEvent = events.find(
      (e) => e.type === 'response.output_item.done' && e.item?.type === 'custom_tool_call'
    );
    expect(doneEvent.item).toMatchObject({ name: 'apply_patch', input: rawPatch });
  });
});

describe('non-Codex traffic is unaffected', () => {
  test('ordinary function tools pass through parseRequest/formatResponse unchanged', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest({
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    expect(unified.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
          strict: undefined,
        },
      },
    ]);

    const formatted = await transformer.formatResponse({
      id: 'resp_1',
      model: 'gpt-4o',
      created: 1,
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"SF"}' },
        },
      ],
    });

    const toolCallItem = formatted.output.find((item: any) => item.type === 'function_call');
    expect(toolCallItem).toMatchObject({ name: 'get_weather', arguments: '{"city":"SF"}' });
    expect(toolCallItem).not.toHaveProperty('namespace');
  });
});

describe('Codex CLI extensions: provider-side transformResponse -> client-side formatResponse', () => {
  test('round-trips a namespaced tool call through separate provider/client transformer instances', async () => {
    // Client-side: parses the original Codex request, flattening namespace tools.
    const clientTransformer = new ResponsesTransformer();
    await clientTransformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [{ type: 'function', name: 'list_open_orders', parameters: {} }],
        },
      ],
    });

    // Provider-side: a fresh transformer instance ingests the upstream Responses
    // API response, which only ever sees the flattened tool name.
    const providerTransformer = new ResponsesTransformer();
    const unified = await providerTransformer.transformResponse({
      id: 'resp_1',
      object: 'response',
      model: 'gpt-5.6',
      created_at: 1,
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'crm__list_open_orders',
          arguments: '{}',
        },
      ],
    });

    // Client-side formatResponse uses its own namespaceMap (from parseRequest)
    // to split the flat name back into {name, namespace} for the Codex client.
    const formatted = await clientTransformer.formatResponse(unified);
    const toolCallItem = formatted.output.find((item: any) => item.type === 'function_call');
    expect(toolCallItem).toMatchObject({ name: 'list_open_orders', namespace: 'crm' });
  });

  test('round-trips a custom tool call through separate provider/client transformer instances', async () => {
    const clientTransformer = new ResponsesTransformer();
    await clientTransformer.parseRequest({
      model: 'gpt-5.6',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });

    const rawPatch = '*** Begin Patch\n*** End Patch';
    const providerTransformer = new ResponsesTransformer();
    const unified = await providerTransformer.transformResponse({
      id: 'resp_1',
      object: 'response',
      model: 'gpt-5.6',
      created_at: 1,
      output: [
        { type: 'custom_tool_call', call_id: 'call_1', name: 'apply_patch', input: rawPatch },
      ],
    });

    const formatted = await clientTransformer.formatResponse(unified);
    const customToolItem = formatted.output.find((item: any) => item.type === 'custom_tool_call');
    expect(customToolItem).toMatchObject({ name: 'apply_patch', input: rawPatch });
  });
});

describe('Codex CLI "lite" mode: additional_tools input item', () => {
  /**
   * Reproduces the shape of a real staging debug trace (request
   * d3a2b5f6-73ea-4b39-894f-e7b431895699) where Codex CLI's `responses:lite`
   * mode sent its tool definitions as an `additional_tools` input item
   * instead of the top-level `tools` array. Before the fix, `parseRequest`
   * only read `body.tools`, so the upstream provider got `tools: []`, had
   * nothing to call, and emitted the intended `exec` tool call as plain
   * text instead — exactly what the user saw in staging.
   */
  function liteModeRequestBody() {
    return {
      model: 'gpt-5.6-luna',
      stream: true,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      input: [
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [
            {
              type: 'custom',
              name: 'exec',
              description: 'Run JavaScript code to orchestrate/compose tool calls',
              format: { type: 'grammar', syntax: 'lark', definition: 'start: SOURCE' },
            },
            {
              type: 'function',
              name: 'wait',
              description: 'Waits on a yielded `exec` cell and returns new output.',
              parameters: {
                type: 'object',
                properties: { cell_id: { type: 'string' } },
                required: ['cell_id'],
                additionalProperties: false,
              },
            },
            {
              type: 'function',
              name: 'request_user_input',
              description: 'Request user input for one to three short questions.',
              parameters: {
                type: 'object',
                properties: { questions: { type: 'array' } },
                required: ['questions'],
                additionalProperties: false,
              },
            },
          ],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'List the files in this repo.' }],
        },
        {
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'call_ksTKVOeBazMKIXc2iBUAwpAy',
          name: 'exec',
          input:
            'const r = await tools.exec_command({cmd:"git status --short"}); text(r.output);\n',
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_ksTKVOeBazMKIXc2iBUAwpAy',
          output: [
            { type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
            { type: 'input_text', text: 'AGENTS.md\nREADME.md\npackage.json\n' },
          ],
        },
      ],
    };
  }

  test('parseRequest lifts additional_tools into the unified tool list', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(liteModeRequestBody());

    expect(unified.tools).toBeDefined();
    const names = unified.tools?.map((t: any) => t.function?.name);
    expect(names).toEqual(expect.arrayContaining(['exec', 'wait', 'request_user_input']));

    // The freeform `exec` custom tool is exposed as a function tool with the
    // {input: string} wrapper schema, same as a top-level `custom` tool.
    const execTool = unified.tools?.find((t: any) => t.function?.name === 'exec');
    expect(execTool?.function?.parameters).toMatchObject({
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    });
  });

  test('parseRequest wraps the custom_tool_call history entry as a tool call', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(liteModeRequestBody());

    const toolCallMessage = unified.messages.find(
      (m) => m.tool_calls?.[0]?.function.name === 'exec'
    );
    expect(toolCallMessage).toBeDefined();
    const parsedArgs = JSON.parse(toolCallMessage!.tool_calls![0]!.function.arguments);
    expect(parsedArgs.input).toContain('git status --short');

    const toolResultMessage = unified.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_ksTKVOeBazMKIXc2iBUAwpAy'
    );
    expect(toolResultMessage).toBeDefined();
  });

  test('additional_tools input item does not leak into the message list', async () => {
    const transformer = new ResponsesTransformer();
    const unified = await transformer.parseRequest(liteModeRequestBody());

    expect(unified.messages.some((m) => (m as any).type === 'additional_tools')).toBe(false);
    expect(unified.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  test('end-to-end: a lifted exec tool call is available for the model to invoke and the result is split back for the client', async () => {
    // Client-side transformer: parses the raw Codex lite-mode body,
    // registering `exec` as a custom tool via the lifted additional_tools.
    const clientTransformer = new ResponsesTransformer();
    await clientTransformer.parseRequest(liteModeRequestBody());

    // Provider-side transformer: ingests the upstream model's tool call.
    // This must be a *different* instance to reflect Plexus's real
    // client-transformer vs. provider-transformer split.
    const providerTransformer = new ResponsesTransformer();
    const unified = await providerTransformer.transformResponse({
      id: 'resp_1',
      object: 'response',
      model: 'gpt-5.6-luna',
      created_at: 1,
      output: [
        {
          type: 'custom_tool_call',
          call_id: 'call_2',
          name: 'exec',
          input: 'text("hello")',
        },
      ],
    });

    const formatted = await clientTransformer.formatResponse(unified);
    const toolCallItem = formatted.output.find((item: any) => item.type === 'custom_tool_call');
    expect(toolCallItem).toMatchObject({ name: 'exec', input: 'text("hello")' });
  });
});
