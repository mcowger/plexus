import { afterEach, beforeEach, describe, expect, it, jest, spyOn, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { isCodexCliShapedBody } from '../oauth/oauth-native-request';
import * as discovery from '../providers/provider-model-discovery';

// Native Codex OAuth pass-through.
//
// Codex is NOT Anthropic: no masking. The ChatGPT backend wants a specific
// Responses bodies are preserved when supported; non-CLI bodies are adorned.
// Cross-format requests and unsupported extensions are transformed.

const { Dispatcher } = await import('../dispatch/dispatcher');
const { ResponsesTransformer } = await import('../../transformers/responses');

// A minimal but real-shaped Codex Responses SSE stream from the backend. The
// exact whitespace is preserved to prove raw-byte pass-through.
const UPSTREAM_SSE = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_abc","object":"response","status":"in_progress","model":"gpt-5-codex","output":[]}}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"NATIVE"}   ',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_abc","object":"response","status":"completed","model":"gpt-5-codex","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"NATIVE"}]}],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
  '',
  '',
].join('\n');

// The real Codex backend can leave response.completed.response.output empty;
// the completed output item is carried by response.output_item.done instead.
const UPSTREAM_SSE_EMPTY_COMPLETION_OUTPUT = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_abc","object":"response","status":"in_progress","model":"gpt-5-codex","output":[]}}',
  '',
  'event: response.output_item.done',
  'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_abc","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"NATIVE"}]}}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_abc","object":"response","status":"completed","model":"gpt-5-codex","output":[],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
  '',
  '',
].join('\n');

// A fake Codex OAuth token: JWT whose payload carries the chatgpt_account_id
// claim the wire header is derived from.
const ACCOUNT_ID = 'acc_test_12345';
const CODEX_TOKEN = (() => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT_ID } })
  ).toString('base64url');
  return `${header}.${payload}.sig`;
})();

function codexOAuthConfig() {
  return {
    providers: {
      Codex: {
        type: 'oauth',
        api_base_url: 'oauth://openai-codex',
        oauth_provider: 'openai-codex',
        oauth_account: 'test-account',
        models: {
          'gpt-5-codex': {
            pricing: { source: 'simple', input: 0, output: 0 },
            // Empty access_via → API type inferred as the synthetic 'oauth'
            // type (mirrors real deployments). The native path must still speak
            // Responses and hit the codex backend.
            access_via: [],
          },
        },
      },
    },
    models: {
      'codex-alias': {
        targets: [{ provider: 'Codex', model: 'gpt-5-codex' }],
      },
    },
    keys: {},
  } as any;
}

// A genuine Codex-CLI-shaped Responses request: client_metadata + custom
// (freeform) tool + additional_tools input item.
function codexCliRequest(): UnifiedChatRequest {
  const body = {
    model: 'codex-alias',
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    text: { verbosity: 'low' },
    prompt_cache_key: 'sess-cli-1',
    reasoning: { effort: 'low', summary: 'auto' },
    // Unsupported sampling params must be stripped even on the verbatim path.
    temperature: 0.7,
    top_p: 0.9,
    truncation: 'auto',
    client_metadata: {
      'x-codex-installation-id': 'inst-1',
      session_id: 'sess-cli-1',
      turn_id: 'turn-1',
      thread_id: 'thread-1',
    },
    tools: [
      { type: 'custom', name: 'apply_patch', description: 'freeform patch tool' },
      { type: 'function', name: 'exec_command', description: 'run cmd', parameters: {} },
    ],
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  };
  return {
    model: 'codex-alias',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    incomingApiType: 'responses',
    originalBody: body,
  } as any;
}

function chatRequest(): UnifiedChatRequest {
  const body = {
    model: 'codex-alias',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'codex-alias',
    messages: body.messages,
    stream: true,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

function nonStreamingChatRequest(): UnifiedChatRequest {
  const body = {
    model: 'codex-alias',
    stream: false,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'codex-alias',
    messages: body.messages,
    stream: false,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

function messagesRequest(): UnifiedChatRequest {
  const body = {
    model: 'codex-alias',
    max_tokens: 256,
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'codex-alias',
    messages: body.messages,
    max_tokens: 256,
    stream: true,
    incomingApiType: 'messages',
    originalBody: body,
  } as any;
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

describe('isCodexCliShapedBody', () => {
  test('detects Codex CLI by client_metadata', () => {
    expect(isCodexCliShapedBody({ client_metadata: { turn_id: 't' } })).toBe(true);
    expect(isCodexCliShapedBody({ client_metadata: { 'x-codex-installation-id': 'i' } })).toBe(
      true
    );
  });
  test('detects Codex CLI by native tool extensions', () => {
    expect(isCodexCliShapedBody({ tools: [{ type: 'custom', name: 'apply_patch' }] })).toBe(true);
    expect(isCodexCliShapedBody({ tools: [{ type: 'namespace', name: 'ns' }] })).toBe(true);
    expect(isCodexCliShapedBody({ input: [{ type: 'additional_tools', tools: [] }] })).toBe(true);
  });
  test('rejects a plain OpenAI Responses request', () => {
    expect(
      isCodexCliShapedBody({
        input: [{ type: 'message' }],
        tools: [{ type: 'function', name: 'x' }],
      })
    ).toBe(false);
    expect(isCodexCliShapedBody({})).toBe(false);
    expect(isCodexCliShapedBody(null)).toBe(false);
  });
});

describe('Native Codex OAuth pass-through', () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(CODEX_TOKEN);
    spyOn(discovery, 'listCodexOAuthModels').mockResolvedValue({
      source: 'codex-backend',
      models: [
        {
          id: 'gpt-5-codex',
          codexReasoning: {
            supportedEfforts: ['none', 'low', 'medium', 'high'],
            supportsEffortUpdates: false,
          },
        },
      ],
    });
    fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(
      new Response(UPSTREAM_SSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('PATH 1 (CLI): sends the body VERBATIM to the codex backend, extensions intact', async () => {
    setConfigForTesting(codexOAuthConfig());
    await new Dispatcher().dispatch(codexCliRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');

    const sent = JSON.parse(init.body);
    // Verbatim: the custom (freeform) tool must NOT be flattened to a function.
    expect(sent.tools.find((t: any) => t.name === 'apply_patch').type).toBe('custom');
    expect(sent.client_metadata).toBeDefined();
    expect(sent.model).toBe('gpt-5-codex');
    // Unsupported sampling params are stripped even on the verbatim path.
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    expect(sent).not.toHaveProperty('truncation');

    // Codex fingerprint headers + auth derived from the token JWT.
    expect(init.headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
    expect(init.headers['chatgpt-account-id']).toBe(ACCOUNT_ID);
    expect(init.headers['originator']).toBe('codex_cli_rs');
    expect(init.headers['OpenAI-Beta']).toBe('responses=experimental');
    expect(init.headers['session-id']).toBe('sess-cli-1');
  });

  test('normalizes string input for a CLI-shaped request', async () => {
    setConfigForTesting(codexOAuthConfig());
    const body = {
      model: 'codex-alias',
      input: 'hi',
      stream: true,
      client_metadata: { turn_id: 'turn' },
    };
    const parsed = await new ResponsesTransformer().parseRequest(body);
    await new Dispatcher().dispatch({
      ...parsed,
      incomingApiType: 'responses',
      originalBody: body,
    });
    const sent = JSON.parse((fetchSpy.mock.calls[0] as [unknown, RequestInit])[1].body as string);
    expect(sent.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ]);
  });

  test('converts system input messages to developer messages for Codex', async () => {
    setConfigForTesting(codexOAuthConfig());
    const input = [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Be concise.' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi.' }] },
    ];
    const body = { model: 'codex-alias', input, stream: true };
    const parsed = await new ResponsesTransformer().parseRequest(body);
    await new Dispatcher().dispatch({
      ...parsed,
      incomingApiType: 'responses',
      originalBody: body,
    });
    const sent = JSON.parse((fetchSpy.mock.calls[0] as [unknown, RequestInit])[1].body as string);
    expect(sent.input).toEqual([{ ...input[0], role: 'developer' }, input[1]]);
    expect(input[0]?.role).toBe('system');
  });

  test('preserves a named tool choice and Responses fields while adorning a non-CLI body', async () => {
    setConfigForTesting(codexOAuthConfig());
    const body = {
      model: 'codex-alias',
      stream: true,
      top_p: 0.5,
      truncation: 'auto',
      frequency_penalty: 1,
      max_output_tokens: 256,
      input: 'Call get_weather.',
      tools: [
        { type: 'function', name: 'get_weather', parameters: { type: 'object', properties: {} } },
      ],
      tool_choice: { type: 'function', name: 'get_weather' },
      metadata: { purpose: 'weather' },
    };
    const parsed = await new ResponsesTransformer().parseRequest(body);
    const response = await new Dispatcher().dispatch({
      ...parsed,
      incomingApiType: 'responses',
      originalBody: body,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.bypassTransformation).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');

    const sent = JSON.parse(init.body);
    // Adorned with the backend-required fields.
    expect(sent.store).toBe(false);
    expect(sent.include).toContain('reasoning.encrypted_content');
    expect(sent.instructions).toBe('');
    expect(sent.text.verbosity).toBe('low');
    expect(sent.model).toBe('gpt-5-codex');
    expect(sent.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] },
    ]);
    expect(sent.tool_choice).toEqual(body.tool_choice);
    expect(sent.metadata).toEqual(body.metadata);
    // Plain function tool preserved as a function (not turned into custom).
    expect(sent.tools.find((t: any) => t.name === 'get_weather').type).toBe('function');
    // Unsupported sampling params the Codex backend rejects must NOT be
    // forwarded. The entry transformer defaults `temperature` to 1.0; the
    // backend returns `Unsupported parameter: temperature`, so it (and the
    // rest of the unsupported set) must be dropped.
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    expect(sent).not.toHaveProperty('frequency_penalty');
    expect(sent).not.toHaveProperty('truncation');
    // The Codex backend accepts NO max-tokens field (rejects both names).
    expect(sent).not.toHaveProperty('max_output_tokens');
    expect(sent).not.toHaveProperty('max_completion_tokens');
  });

  test.each([
    {
      instructions: '',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
    },
    {
      instructions: null,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
    },
    {
      instructions: 'Only this turn',
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Repo rules' }],
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
      ],
    },
  ])(
    'preserves supplied native instructions without inserting developer input',
    async ({ instructions, input }) => {
      setConfigForTesting(codexOAuthConfig());
      const body = { model: 'codex-alias', stream: true, instructions, input };
      const parsed = await new ResponsesTransformer().parseRequest(body);
      const response = await new Dispatcher().dispatch({
        ...parsed,
        incomingApiType: 'responses',
        originalBody: body,
      });
      const sent = JSON.parse((fetchSpy.mock.calls[0] as [unknown, RequestInit])[1].body as string);
      expect(response.bypassTransformation).toBe(true);
      expect(sent.instructions).toBe(instructions ?? '');
      expect(sent.input).toEqual(input);
    }
  );

  test.each([false, true])(
    'relocates known-target native instructions unless the model opts out (opt-out: %s)',
    async (optOut) => {
      const config = codexOAuthConfig();
      config.providers.Codex.models['gpt-6.2-sol'] = {
        pricing: { source: 'simple', input: 0, output: 0 },
        access_via: [],
        ...(optOut ? { adapter: [{ name: 'cache_responses_instructions', enabled: false }] } : {}),
      };
      config.models['codex-alias'].targets[0].model = 'gpt-6.2-sol';
      setConfigForTesting(config);
      const input = [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
      ];
      const body = { model: 'codex-alias', stream: true, instructions: 'Project rules', input };
      const parsed = await new ResponsesTransformer().parseRequest(body);
      const response = await new Dispatcher().dispatch({
        ...parsed,
        incomingApiType: 'responses',
        originalBody: body,
      });
      const [url, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
      const sent = JSON.parse(init.body as string);
      expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
      expect(response.bypassTransformation).toBe(true);
      if (optOut) {
        expect(sent.instructions).toBe('Project rules');
        expect(sent.input).toEqual(input);
      } else {
        expect(sent.instructions).toBe('');
        expect(sent.input).toEqual([
          {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'Project rules' }],
          },
          ...input,
        ]);
      }
      expect(body.instructions).toBe('Project rules');
      expect(body.input).toEqual(input);
    }
  );

  test('relocates opt-in instructions after CLI tool extensions on full replays', async () => {
    const config = codexOAuthConfig();
    config.providers.Codex.adapter = [
      { name: 'cache_responses_instructions', options: {}, enabled: true },
    ];
    setConfigForTesting(config);
    fetchSpy
      .mockResolvedValueOnce(
        new Response(UPSTREAM_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      )
      .mockResolvedValueOnce(
        new Response(UPSTREAM_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );

    const first = codexCliRequest();
    const additionalTools = { type: 'additional_tools', role: 'developer', tools: [] };
    const existingDeveloper = {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Repo rules' }],
    };
    const user = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] };
    const appended = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'again' }],
    };
    first.originalBody.instructions = 'Project rules';
    first.originalBody.input = [additionalTools, existingDeveloper, user];
    const second = codexCliRequest();
    second.originalBody = { ...first.originalBody, input: [...first.originalBody.input, appended] };
    const originalFirst = structuredClone(first.originalBody);
    const originalSecond = structuredClone(second.originalBody);

    const dispatcher = new Dispatcher();
    const firstResponse = await dispatcher.dispatch(first);
    const secondResponse = await dispatcher.dispatch(second);
    expect(firstResponse.bypassTransformation).toBe(true);
    expect(secondResponse.bypassTransformation).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const calls = fetchSpy.mock.calls as [unknown, RequestInit][];
    expect(calls[0]![0]).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(calls[1]![0]).toBe('https://chatgpt.com/backend-api/codex/responses');
    const firstSent = JSON.parse(calls[0]![1].body as string);
    const secondSent = JSON.parse(calls[1]![1].body as string);
    const prefix = [
      additionalTools,
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'Project rules' }],
      },
      existingDeveloper,
      user,
    ];
    expect(firstSent.input).toEqual(prefix);
    expect(secondSent.input).toEqual([...prefix, appended]);
    expect(secondSent.input.slice(0, prefix.length)).toEqual(firstSent.input);
    expect(firstSent).not.toHaveProperty('instructions');
    expect(secondSent).not.toHaveProperty('instructions');
    expect(first.originalBody).toEqual(originalFirst);
    expect(second.originalBody).toEqual(originalSecond);
  });

  test.each([
    { effort: 'off', context: 'all_turns', max_tokens: 100, adaptive: true },
    { effort: 'high', enabled: false, context: 'all_turns', max_tokens: 100, adaptive: false },
  ])('normalizes disabled reasoning while preserving Responses fields', async (reasoning) => {
    setConfigForTesting(codexOAuthConfig());
    const body = { model: 'codex-alias', input: 'hi', stream: true, reasoning };
    const parsed = await new ResponsesTransformer().parseRequest(body);
    await new Dispatcher().dispatch({
      ...parsed,
      incomingApiType: 'responses',
      originalBody: body,
    });

    const sent = JSON.parse((fetchSpy.mock.calls[0] as [unknown, RequestInit])[1].body as string);
    expect(sent.reasoning).toEqual({ effort: 'none', context: 'all_turns' });
  });

  test('flattens Muse dotted history the backend rejects, and translates the response back', async () => {
    setConfigForTesting(codexOAuthConfig());
    const body = {
      model: 'codex-alias',
      stream: true,
      tools: [
        {
          type: 'namespace',
          name: 'muse',
          tools: [{ type: 'function', name: 'bash', parameters: { type: 'object' } }],
        },
      ],
      tool_choice: { type: 'function', name: 'muse__bash' },
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'function_call', call_id: 'c1', name: 'muse.bash', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: 'ok' },
      ],
    };
    const parsed = await new ResponsesTransformer().parseRequest(body);
    const response = await new Dispatcher().dispatch({
      ...parsed,
      incomingApiType: 'responses',
      originalBody: body,
    } as UnifiedChatRequest);

    // Flattened, so the response must be translated for names to split back.
    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.tools.map((t: any) => t.name)).toEqual(['muse__bash']);
    expect(sent.tool_choice).toEqual({ type: 'function', name: 'muse__bash' });
    expect(sent.input.find((i: any) => i.type === 'function_call').name).toBe('muse__bash');
  });

  test('streams RAW backend Responses SSE to the client, byte-preserved', async () => {
    setConfigForTesting(codexOAuthConfig());
    const response = await new Dispatcher().dispatch(codexCliRequest());
    expect(response.stream).toBeDefined();

    const clientBytes = await drain(response.stream!);
    expect(clientBytes).toContain('event: response.created');
    expect(clientBytes).toContain('"type":"response.completed"');
    // Exact upstream whitespace quirk preserved (no re-serialization).
    expect(clientBytes).toContain('"delta":"NATIVE"}   ');
    // Went native to the codex backend.
    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe(
      'https://chatgpt.com/backend-api/codex/responses'
    );
  });

  test('marks backend Responses SSE for translation to a Chat Completions client', async () => {
    setConfigForTesting(codexOAuthConfig());
    const request = chatRequest();
    request.tool_choice = { type: 'function', function: { name: 'lookup' } };
    request.tools = [
      {
        type: 'function',
        function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
      },
    ];
    const response = await new Dispatcher().dispatch(request);

    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.input).toBeDefined();
    expect(sent.messages).toBeUndefined();
    expect(sent.tool_choice).toEqual({ type: 'function', name: 'lookup' });
  });

  test('puts translated Chat guidance first for GPT-6.2 Codex', async () => {
    const config = codexOAuthConfig();
    config.providers.Codex.models['gpt-6.2-sol'] = {
      pricing: { source: 'simple', input: 0, output: 0 },
      access_via: [],
    };
    config.models['codex-62'] = { targets: [{ provider: 'Codex', model: 'gpt-6.2-sol' }] };
    setConfigForTesting(config);
    const request = chatRequest();
    request.model = 'codex-62';
    request.messages = [
      { role: 'system', content: 'Alpha' },
      { role: 'user', content: 'hi' },
    ];
    request.originalBody = { model: request.model, stream: true, messages: request.messages };
    const response = await new Dispatcher().dispatch(request);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as [unknown, RequestInit])[1].body as string);
    expect(response.bypassTransformation).toBe(false);
    expect(sent.input[0]).toEqual({
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Alpha' }],
    });
    expect(sent.instructions).toBe('');
  });

  test('aggregates backend Responses SSE for a non-streaming Chat Completions client', async () => {
    setConfigForTesting(codexOAuthConfig());
    // The ChatGPT backend can return its forced SSE body with a JSON content
    // type when the original client requested a non-streaming response.
    fetchSpy.mockResolvedValueOnce(
      new Response(UPSTREAM_SSE_EMPTY_COMPLETION_OUTPUT, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const response = await new Dispatcher().dispatch(nonStreamingChatRequest());

    expect(response.stream).toBeUndefined();
    expect(response.content).toBe('NATIVE');
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.stream).toBe(true);
  });

  test('marks backend Responses SSE for translation to a Messages client', async () => {
    setConfigForTesting(codexOAuthConfig());
    const response = await new Dispatcher().dispatch(messagesRequest());

    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.input).toBeDefined();
    expect(sent.messages).toBeUndefined();
  });

  test.each([
    ['unchanged', ACCOUNT_ID],
    ['changed', 'acc_refreshed_99999'],
  ])('retries a Codex 401 only for the original account (%s)', async (_scenario, accountId) => {
    setConfigForTesting(codexOAuthConfig());
    const REFRESHED_CODEX_TOKEN = (() => {
      const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: accountId },
          iat: 2,
        })
      ).toString('base64url');
      return `${header}.${payload}.sig`;
    })();

    const getApiKeySpy = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey');
    getApiKeySpy.mockResolvedValueOnce(CODEX_TOKEN).mockResolvedValueOnce(REFRESHED_CODEX_TOKEN);

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'Provided authentication token is expired.',
              code: 'token_expired',
            },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(UPSTREAM_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );

    const attempt = new Dispatcher().dispatch(codexCliRequest());
    if (accountId !== ACCOUNT_ID) {
      await expect(attempt).rejects.toThrow('Provided authentication token is expired.');
      expect(getApiKeySpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      return;
    }
    const response = await attempt;
    expect(response.stream).toBeDefined();

    const clientBytes = await drain(response.stream!);
    expect(clientBytes).toContain('event: response.created');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // First attempt used expired token
    const firstCallInit = fetchSpy.mock.calls[0] as any[];
    expect(firstCallInit[1].headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
    expect(firstCallInit[1].headers['chatgpt-account-id']).toBe(ACCOUNT_ID);

    // Same account, fresh bearer.
    const secondCallInit = fetchSpy.mock.calls[1] as any[];
    expect(secondCallInit[1].headers['Authorization']).toBe(`Bearer ${REFRESHED_CODEX_TOKEN}`);
    expect(secondCallInit[1].headers['chatgpt-account-id']).toBe(ACCOUNT_ID);
  });
});
