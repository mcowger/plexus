import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { isCodexCliShapedBody } from '../oauth/oauth-native-request';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Native Codex OAuth pass-through.
//
// Codex is NOT Anthropic: no masking. The ChatGPT backend wants a specific
// Responses body. Two paths:
//   1. CLI-shaped body  → sent VERBATIM (auth only), extensions preserved.
//   2. Not CLI-shaped   → normalized via ResponsesTransformer + adorned.
// Responses clients stream RAW backend SSE; cross-format clients get translated.

const { Dispatcher } = await import('../dispatch/dispatcher');

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

// A plain (non-CLI) OpenAI Responses request: plain function tools, no
// client_metadata, no instructions/text.
function plainResponsesRequest(): UnifiedChatRequest {
  const body = {
    model: 'codex-alias',
    stream: true,
    top_p: 0.5,
    frequency_penalty: 1,
    max_output_tokens: 256,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'weather',
        parameters: { type: 'object', properties: {} },
      },
    ],
  };
  return {
    model: 'codex-alias',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'weather',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
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
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(CODEX_TOKEN);
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

    // Codex fingerprint headers + auth derived from the token JWT.
    expect(init.headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
    expect(init.headers['chatgpt-account-id']).toBe(ACCOUNT_ID);
    expect(init.headers['originator']).toBe('codex_cli_rs');
    expect(init.headers['OpenAI-Beta']).toBe('responses=experimental');
    expect(init.headers['session-id']).toBe('sess-cli-1');
  });

  test('PATH 2 (non-CLI): normalizes + adorns the body for the backend', async () => {
    setConfigForTesting(codexOAuthConfig());
    const response = await new Dispatcher().dispatch(plainResponsesRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.bypassTransformation).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');

    const sent = JSON.parse(init.body);
    // Adorned with the backend-required fields.
    expect(sent.store).toBe(false);
    expect(sent.include).toContain('reasoning.encrypted_content');
    expect(typeof sent.instructions).toBe('string');
    expect(sent.text.verbosity).toBe('low');
    expect(sent.model).toBe('gpt-5-codex');
    // Plain function tool preserved as a function (not turned into custom).
    expect(sent.tools.find((t: any) => t.name === 'get_weather').type).toBe('function');
    // Unsupported sampling params the Codex backend rejects must NOT be
    // forwarded. The entry transformer defaults `temperature` to 1.0; the
    // backend returns `Unsupported parameter: temperature`, so it (and the
    // rest of the unsupported set) must be dropped.
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    expect(sent).not.toHaveProperty('frequency_penalty');
    // The Codex backend accepts NO max-tokens field (rejects both names).
    expect(sent).not.toHaveProperty('max_output_tokens');
    expect(sent).not.toHaveProperty('max_completion_tokens');
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
    const response = await new Dispatcher().dispatch(chatRequest());

    expect(response.bypassTransformation).toBe(false);
    const sent = JSON.parse((fetchSpy.mock.calls[0] as any[])[1].body);
    expect(sent.input).toBeDefined();
    expect(sent.messages).toBeUndefined();
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
});
