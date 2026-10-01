import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Native Meta (Muse Code) OAuth dispatch.
//
// Muse Code sends Meta's own Responses body, including its `type: "namespace"`
// tool grouping and namespace-qualified `function_call` history. api.meta.ai —
// the endpoint Muse talks to directly — accepts that shape, so a native Meta
// route must forward it VERBATIM. The route returns raw upstream SSE, so
// flattening the request would leave `muse__read_file` calls unsplit and the
// client would reject them as unknown tools (see
// `getDefaultResponsesExtensions` / `hasUnsupportedResponsesExtensions`).

const { Dispatcher } = await import('../dispatch/dispatcher');
const { ResponsesTransformer } = await import('../../transformers/responses');

const META_TOKEN = 'mk_live_test';

// Raw Meta Responses SSE carrying a namespace-qualified function_call. The
// exact whitespace is preserved to prove raw-byte pass-through.
const UPSTREAM_SSE = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_muse","object":"response","status":"in_progress","model":"muse-spark-1.3-contributor","output":[]}}',
  '',
  'event: response.output_item.added',
  'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","status":"in_progress","call_id":"call_1","name":"read_file","namespace":"muse","arguments":""}}',
  '',
  'event: response.output_item.done',
  'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","status":"completed","call_id":"call_1","name":"read_file","namespace":"muse","arguments":"{\\"path\\":\\"calc.py\\"}"}}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_muse","object":"response","status":"completed","model":"muse-spark-1.3-contributor","output":[],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
  '',
  '',
].join('\n');

function metaOAuthConfig() {
  return {
    providers: {
      Meta: {
        type: 'oauth',
        api_base_url: 'oauth://meta',
        oauth_provider: 'meta',
        oauth_account: 'test-account',
        models: {
          'muse-spark-1.3-contributor': {
            pricing: { source: 'simple', input: 0, output: 0 },
            // Empty access_via mirrors real deployments; the native path must
            // still speak Responses and hit Meta's /responses endpoint.
            access_via: [],
          },
        },
      },
    },
    models: {
      'muse-spark-1.3': {
        targets: [{ provider: 'Meta', model: 'muse-spark-1.3-contributor' }],
      },
    },
    keys: {},
  } as any;
}

// A Muse Code Responses request: the whole tool set is one `namespace` tool.
function museNamespaceRequest(): UnifiedChatRequest {
  const body = {
    model: 'muse-spark-1.3',
    stream: true,
    store: false,
    reasoning: { effort: 'low', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: 'tbh:test',
    tools: [
      {
        type: 'namespace',
        name: 'muse',
        description: 'Muse Code tool set.',
        tools: [
          {
            type: 'function',
            name: 'read_file',
            description: 'Read a file.',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
          { type: 'function', name: 'bash', description: 'Run a command.', parameters: {} },
        ],
      },
    ],
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix calc.py' }] },
    ],
  };
  return {
    model: 'muse-spark-1.3',
    messages: [{ role: 'user', content: 'fix calc.py' }],
    stream: true,
    incomingApiType: 'responses',
    originalBody: body,
  } as any;
}

// A Codex-lite body (additional_tools) routed to Meta: Meta does NOT advertise
// these extensions, so it must still take the transform pipeline.
function codexLiteRequest(): UnifiedChatRequest {
  const body = {
    model: 'muse-spark-1.3',
    stream: true,
    input: [
      { type: 'additional_tools', role: 'developer', tools: [] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ],
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        parameters: { type: 'object', properties: {} },
      },
    ],
  };
  return {
    model: 'muse-spark-1.3',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    incomingApiType: 'responses:lite',
    originalBody: body,
  } as any;
}

// A Responses body parsed the way the inbound route does, so the transform
// path sees the client's (flattened) tools.
async function parsedRequest(body: any): Promise<UnifiedChatRequest> {
  const request = await new ResponsesTransformer().parseRequest(body);
  return { ...request, incomingApiType: 'responses', originalBody: body } as UnifiedChatRequest;
}

async function drain(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += typeof value === 'string' ? value : dec.decode(value);
  }
  return out;
}

describe('Native Meta OAuth dispatch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(META_TOKEN);
    fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(
      new Response(UPSTREAM_SSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('forwards Muse namespace tools VERBATIM to api.meta.ai, unflattened', async () => {
    setConfigForTesting(metaOAuthConfig());
    const response = await new Dispatcher().dispatch(museNamespaceRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://api.meta.ai/v1/responses');
    expect(init.headers.Authorization).toBe(`Bearer ${META_TOKEN}`);
    expect(init.headers['x-api-version']).toBe('1.0.0');

    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('muse-spark-1.3-contributor');
    // The namespace grouping is intact — NO `muse__read_file` flattening.
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].type).toBe('namespace');
    expect(sent.tools[0].name).toBe('muse');
    expect(sent.tools[0].tools.map((t: any) => t.name)).toEqual(['read_file', 'bash']);
    expect(JSON.stringify(sent.tools)).not.toContain('muse__');
    // Same-format Responses → raw-SSE pass-through (the response is not
    // re-serialized, so the namespace field survives too).
    expect(response.bypassTransformation).toBe(true);
  });

  test('streams RAW namespace-qualified Meta SSE to the client, byte-preserved', async () => {
    setConfigForTesting(metaOAuthConfig());
    const response = await new Dispatcher().dispatch(museNamespaceRequest());

    expect(response.stream).toBeDefined();
    const clientBytes = await drain(response.stream!);
    expect(clientBytes).toContain('event: response.created');
    // The namespace field survives verbatim — no `muse__read_file` reentry.
    expect(clientBytes).toContain('"name":"read_file","namespace":"muse"');
    expect(clientBytes).not.toContain('muse__read_file');
  });

  test('keeps Codex-lite extensions on the transform path for Meta', async () => {
    setConfigForTesting(metaOAuthConfig());
    const response = await new Dispatcher().dispatch(codexLiteRequest());

    // Meta does not advertise `additional_tools`/`tool_search`, so the request
    // is translated and the response is translated back (the client
    // transformer's namespaceMap can then split any flattened calls).
    expect(response.bypassTransformation).toBe(false);

    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.input).toBeDefined();
    expect(sent.messages).toBeUndefined();
  });

  test("forwards Muse's dotted `muse.bash` call history verbatim", async () => {
    setConfigForTesting(metaOAuthConfig());
    const request = museNamespaceRequest();
    (request.originalBody as any).input.push(
      { type: 'function_call', call_id: 'call_1', name: 'muse.bash', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' }
    );
    const response = await new Dispatcher().dispatch(request);

    expect(response.bypassTransformation).toBe(true);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.input.find((i: any) => i.type === 'function_call').name).toBe('muse.bash');
  });

  test('flattens custom tools Meta does not accept, so they stay callable', async () => {
    setConfigForTesting(metaOAuthConfig());
    const body = {
      ...museNamespaceRequest().originalBody,
      tools: [{ type: 'custom', name: 'apply_patch' }],
    };
    const response = await new Dispatcher().dispatch(await parsedRequest(body));

    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'apply_patch' }),
    ]);
  });

  test('an explicit empty responses_extensions flattens Muse namespace tools', async () => {
    const config = metaOAuthConfig();
    config.providers.Meta.responses_extensions = [];
    setConfigForTesting(config);
    const response = await new Dispatcher().dispatch(
      await parsedRequest(museNamespaceRequest().originalBody)
    );

    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.tools.map((t: any) => t.name)).toEqual(['muse__read_file', 'muse__bash']);
  });
});
