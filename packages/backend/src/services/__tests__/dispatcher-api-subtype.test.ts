import { describe, expect, test } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { TransformerFactory } from '../transformer-factory';
import { ResponsesTransformer } from '../../transformers/responses';

function makeRoute(
  accessVia: any[],
  apiBaseUrl: string | Record<string, string> = 'https://api.test/v1'
) {
  return {
    provider: 'test-provider',
    model: 'upstream-model',
    config: {
      api_base_url: apiBaseUrl,
      api_key: 'test-key',
      models: {},
    },
    modelConfig: {
      pricing: { source: 'simple', input: 0, output: 0 },
      access_via: accessVia,
    },
  } as any;
}

describe('Dispatcher API subtypes', () => {
  test('falls back to an ordinary Responses target when no Lite target is configured', () => {
    // Plexus fully translates Codex CLI's `responses:lite` wire extensions
    // (additional_tools, namespace/custom tools) via the transform pipeline,
    // so a target that only advertises the base "responses" type is still a
    // valid fallback rather than being excluded outright.
    const dispatcher = new Dispatcher() as any;
    const selection = dispatcher.selectTargetApiType(
      makeRoute(['chat', 'responses']),
      'responses:lite'
    );

    expect(selection.targetApiType).toBe('responses');
    expect(selection.selectionReason).toContain("fell back to base type 'responses'");
  });

  test("defaults to the target's own API type when it has no Responses support at all", () => {
    // A target advertising only "chat" has no direct or base-type match for
    // "responses:lite", but the full transform pipeline still translates
    // between Responses and Chat Completions, so this must default rather
    // than be excluded (matching the treatment of any other unsupported
    // incoming type).
    const dispatcher = new Dispatcher() as any;
    const selection = dispatcher.selectTargetApiType(makeRoute(['chat']), 'responses:lite');

    expect(selection.targetApiType).toBe('chat');
    expect(selection.selectionReason).toContain("not supported, defaulted to 'chat'");
  });

  test('selects an explicitly configured structured subtype', () => {
    const dispatcher = new Dispatcher() as any;
    const selection = dispatcher.selectTargetApiType(
      makeRoute([{ type: 'responses', subtype: 'lite' }]),
      'responses:lite'
    );

    expect(selection.targetApiType).toBe('responses:lite');
  });

  test('uses the base Responses URL and forwards the Lite header', () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }], {
      responses: 'https://api.test/v1',
    });

    expect(dispatcher.resolveBaseUrl(route, 'responses:lite')).toBe('https://api.test/v1');
    expect(
      dispatcher.setupHeaders(route, 'responses:lite', { model: 'alias', messages: [] })
    ).toMatchObject({
      Authorization: 'Bearer test-key',
      'x-openai-internal-codex-responses-lite': 'true',
    });
  });

  test('keeps a Lite request body in the Responses pass-through path', async () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }]);
    const originalBody = {
      model: 'alias',
      input: [{ type: 'additional_tools', role: 'developer', tools: [] }],
    };
    const result = await dispatcher.transformRequestPayload(
      {
        model: 'alias',
        messages: [],
        incomingApiType: 'responses:lite',
        originalBody,
      },
      route,
      TransformerFactory.getTransformer('responses:lite'),
      'responses:lite'
    );

    expect(result.bypassTransformation).toBe(true);
    expect(result.payload.input).toEqual(originalBody.input);
    expect(result.payload.model).toBe('upstream-model');
  });

  test('disables pass-through for Responses bodies carrying Codex namespace/custom tool call history', async () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }]);
    const originalBody = {
      model: 'alias',
      input: [
        { type: 'additional_tools', role: 'developer', tools: [] },
        {
          type: 'function_call',
          name: 'list_open_orders',
          namespace: 'crm',
          call_id: 'call_function',
          arguments: '{}',
        },
        {
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'call_custom',
          name: 'exec',
          input: 'text("ok")',
        },
      ],
    };
    const result = await dispatcher.transformRequestPayload(
      {
        model: 'alias',
        messages: [],
        incomingApiType: 'responses:lite',
        originalBody,
      },
      route,
      TransformerFactory.getTransformer('responses:lite'),
      'responses:lite'
    );

    // Namespace/custom-tool-call history means the raw body can't be
    // forwarded as-is — most Responses-compatible providers don't understand
    // these Codex CLI extensions. Pass-through must be disabled so the full
    // transform pipeline (which flattens/normalizes them) runs instead.
    expect(result.bypassTransformation).toBe(false);
  });

  test('keeps pass-through for Responses bodies without Codex namespace/custom tool extensions', async () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }]);
    const originalBody = {
      model: 'alias',
      input: [
        { type: 'additional_tools', role: 'developer', tools: [] },
        {
          type: 'function_call',
          name: 'get_weather',
          call_id: 'call_function',
          arguments: '{}',
        },
      ],
    };
    const result = await dispatcher.transformRequestPayload(
      {
        model: 'alias',
        messages: [],
        incomingApiType: 'responses:lite',
        originalBody,
      },
      route,
      TransformerFactory.getTransformer('responses:lite'),
      'responses:lite'
    );

    expect(result.bypassTransformation).toBe(true);
    expect(result.payload.input).toEqual(originalBody.input);
  });

  test('end-to-end: Codex namespace/custom tools are flattened for the upstream Responses provider', async () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute(['responses']);
    const originalBody = {
      model: 'alias',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'namespace',
          name: 'crm',
          tools: [{ type: 'function', name: 'list_open_orders', parameters: {} }],
        },
        { type: 'custom', name: 'apply_patch' },
      ],
    };

    // Client-side transformer: parses the raw Codex body into unified form,
    // flattening namespace tools and registering custom tool names.
    const clientTransformer = new ResponsesTransformer();
    const unifiedRequest = await clientTransformer.parseRequest(originalBody);
    unifiedRequest.incomingApiType = 'responses';
    unifiedRequest.originalBody = originalBody;

    const result = await dispatcher.transformRequestPayload(
      unifiedRequest,
      route,
      TransformerFactory.getTransformer('responses'),
      'responses'
    );

    expect(result.bypassTransformation).toBe(false);
    expect(result.payload.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function', name: 'crm__list_open_orders' }),
        expect.objectContaining({ type: 'function', name: 'apply_patch' }),
      ])
    );
  });

  test('end-to-end: Codex "lite" mode additional_tools reach the upstream Responses provider (staging trace d3a2b5f6)', async () => {
    // Reproduces the shape of a real staging debug trace where a Codex CLI
    // `responses:lite` request carried its tool definitions in an
    // `additional_tools` input item rather than the top-level `tools`
    // array. Before the fix, the upstream provider received `tools: []`
    // and hallucinated the tool call as text instead of invoking it.
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }]);
    const originalBody = {
      model: 'gpt-5.6-luna',
      input: [
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [{ type: 'custom', name: 'exec', description: 'Run JS to orchestrate tools' }],
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    };

    const clientTransformer = new ResponsesTransformer();
    const unifiedRequest = await clientTransformer.parseRequest(originalBody);
    unifiedRequest.incomingApiType = 'responses:lite';
    unifiedRequest.originalBody = originalBody;

    const result = await dispatcher.transformRequestPayload(
      unifiedRequest,
      route,
      TransformerFactory.getTransformer('responses:lite'),
      'responses:lite'
    );

    expect(result.bypassTransformation).toBe(false);
    expect(result.payload.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'exec' })])
    );
  });
});
