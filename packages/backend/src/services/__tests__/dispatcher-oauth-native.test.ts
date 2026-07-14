import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Native Anthropic OAuth streaming pass-through.
//
// The whole point of the native path: the upstream Anthropic SSE bytes reach
// the client verbatim (only tool-name renames reversed), with NO pi-ai event
// translation in the middle. This test proves both:
//   1. Fidelity the pi-ai round-trip dropped is preserved: `event: ping`,
//      `stop_details`, `inference_geo`, the cache_creation breakdown, and the
//      exact byte whitespace all survive.
//   2. A request-side tool-name rename is reversed on the response bytes.

const { Dispatcher } = await import('../dispatch/dispatcher');

// A real-shape Anthropic Messages SSE stream, including the bits the pi-ai
// executor discarded. The upstream tool_use name is `mcp__Bash` — the name the
// masking pipeline renamed the caller's `Bash` tool to (collision-shape). On
// the way back it MUST be reversed to the caller's original `Bash`.
const UPSTREAM_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"model":"claude-sonnet-5","id":"msg_x","type":"message","role":"assistant","content":[],"stop_reason":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":11893,"cache_read_input_tokens":27891,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":11893},"output_tokens":2,"service_tier":"standard","inference_geo":"global"}}}  }',
  '',
  'event: ping',
  'data: {"type": "ping"}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_x","name":"mcp__Bash","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0  }',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

function anthropicOAuthConfig() {
  return {
    providers: {
      Claude: {
        type: 'oauth',
        api_base_url: 'oauth://anthropic',
        oauth_provider: 'anthropic',
        oauth_account: 'test-account',
        models: {
          'claude-test': {
            pricing: { source: 'simple', input: 0, output: 0 },
            // Empty access_via mirrors real deployments: the API type is then
            // inferred from the `oauth://` URL as the synthetic 'oauth' type.
            // The native path must still build a proper Anthropic Messages body
            // (not pi-ai's Context IR) — this is the staging regression.
            access_via: [],
          },
        },
      },
    },
    models: {
      'test-alias': {
        targets: [{ provider: 'Claude', model: 'claude-test' }],
      },
    },
    keys: {},
  } as any;
}

function streamingMessagesRequest(): UnifiedChatRequest {
  // Caller sends a `Bash` tool whose schema collides in shape with the real
  // Claude Code Bash tool, forcing the masking pipeline to rename it to
  // `mcp__Bash` on the way out. The response must reverse it back to `Bash`.
  const tools = [
    {
      name: 'Bash',
      description: 'a caller tool that shape-collides with Claude Code Bash',
      input_schema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
      },
    },
  ];
  const body = {
    model: 'test-alias',
    stream: true,
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    tools,
  };
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hi' }],
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    stream: true,
    incomingApiType: 'messages',
    originalBody: body,
  } as any;
}

// Same colliding `Bash` tool, but a non-streaming request.
function nonStreamingMessagesRequest(): UnifiedChatRequest {
  const tools = [
    {
      name: 'Bash',
      description: 'a caller tool that shape-collides with Claude Code Bash',
      input_schema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
      },
    },
  ];
  const body = {
    model: 'test-alias',
    stream: false,
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    tools,
  };
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hi' }],
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    stream: false,
    incomingApiType: 'messages',
    originalBody: body,
  } as any;
}

// A non-streaming Anthropic Messages response whose tool_use uses the MASKED
// name `mcp__Bash` — must be reversed to the caller's `Bash`.
const UPSTREAM_JSON = JSON.stringify({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5',
  content: [
    { type: 'text', text: 'running' },
    { type: 'tool_use', id: 'toolu_x', name: 'mcp__Bash', input: { foo: 'ls' } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 2, output_tokens: 5 },
});

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

describe('Native OAuth pass-through', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      'sk-ant-oat-fake-token-for-test'
    );
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
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

  test('streams upstream Anthropic SSE to the client, preserving pi-ai-dropped fidelity', async () => {
    setConfigForTesting(anthropicOAuthConfig());
    const response = await new Dispatcher().dispatch(streamingMessagesRequest());
    expect(response.stream).toBeDefined();

    const clientBytes = await drain(response.stream!);

    // Fidelity the pi-ai executor round-trip dropped — all must survive.
    expect(clientBytes).toContain('event: ping');
    expect(clientBytes).toContain('"stop_details":null');
    expect(clientBytes).toContain('"inference_geo":"global"');
    expect(clientBytes).toContain('"ephemeral_1h_input_tokens":11893');
    // Exact upstream whitespace quirk preserved (no JSON re-serialization).
    expect(clientBytes).toContain('"service_tier":"standard","inference_geo":"global"}}}  }');
    expect(clientBytes).toContain('"type":"content_block_stop","index":0  }');

    // Tool-name reversal: the upstream `mcp__Bash` (masking's rename of the
    // caller's `Bash`) MUST be restored to `Bash` on the way to the client, and
    // the renamed wire name must NOT leak through.
    expect(clientBytes).toContain('"name":"Bash"');
    expect(clientBytes).not.toContain('mcp__Bash');

    // Went native: real endpoint, no pi-ai executor.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe('https://api.anthropic.com/v1/messages');
  });

  test('builds a native Anthropic Messages body (not pi-ai IR) with the resolved model', async () => {
    // Regression for the staging failures `model: Field required` /
    // `messages: Field required`. With empty access_via the target API type
    // resolves to the synthetic 'oauth' type; the native path must NOT route
    // through pi-ai's `oauth` IR transformer (which emits {context,options,
    // system} with no top-level model/messages). It must produce a real
    // Anthropic Messages body, and pin `model` to the RESOLVED target
    // (`claude-test`), not the incoming alias (`test-alias`).
    setConfigForTesting(anthropicOAuthConfig());
    await new Dispatcher().dispatch(streamingMessagesRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = (fetchSpy.mock.calls[0] as any[])[1];
    const sentBody = JSON.parse(init.body);

    // Real Anthropic Messages shape — the fields upstream requires.
    expect(sentBody.model).toBe('claude-test');
    expect(sentBody.model).not.toBe('test-alias');
    expect(Array.isArray(sentBody.messages)).toBe(true);
    expect(sentBody.messages.length).toBeGreaterThan(0);
    expect(sentBody.max_tokens).toBe(100);

    // NOT pi-ai Context IR.
    expect(sentBody).not.toHaveProperty('context');
    expect(sentBody).not.toHaveProperty('options');
  });

  test('reverses tool names on a NON-streaming Anthropic response body', async () => {
    setConfigForTesting(anthropicOAuthConfig());
    fetchSpy.mockResolvedValueOnce(
      new Response(UPSTREAM_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const response = await new Dispatcher().dispatch(nonStreamingMessagesRequest());

    // rawResponse holds the (reversed) upstream Anthropic body. The masked
    // `mcp__Bash` must be restored to the caller's `Bash`, with no leak.
    const raw = JSON.stringify((response as any).rawResponse);
    expect(raw).toContain('"name":"Bash"');
    expect(raw).not.toContain('mcp__Bash');

    // The synthetic-parsed tool call the client sees also carries the reversed name.
    const toolCallNames = (response.tool_calls ?? []).map((tc: any) => tc.function?.name);
    expect(toolCallNames).toContain('Bash');
    expect(toolCallNames).not.toContain('mcp__Bash');

    // Went native: real endpoint, no pi-ai executor.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe('https://api.anthropic.com/v1/messages');
  });
});
