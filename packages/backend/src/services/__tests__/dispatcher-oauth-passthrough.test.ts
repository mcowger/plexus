import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { registerSpy } from '../../../test/test-utils';
import { TransformerFactory } from '../dispatch/transformer-factory';
import { handleResponse } from '../responses/response-handler';
import type { UsageStorageService } from '../observability/usage-storage';
import type { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import type { UsageRecord } from '../../types/usage';

// Regression test for issue #162 (dispatcher-level):
//   a multi-turn conversation routed to Claude Code OAuth must succeed, not
//   throw, on the second turn.
//
// Original root cause was in the (now removed) pi-ai OAuth executor's IR
// conversion. There is now no executor: Anthropic OAuth runs
// natively through the standard path (native masked Messages body + raw-byte
// response). This test guards that the native path handles a multi-turn OAuth
// request end-to-end without error.

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts.
const { Dispatcher } = await import('../dispatch/dispatcher');

function oauthConfigWithChatAccessVia() {
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
            access_via: ['chat', 'messages'],
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

function multiTurnChatRequest(): UnifiedChatRequest {
  // Replicates the exact shape OpenWebUI sends on turn 2: assistant content is
  // a plain string (per OpenAI chat completions spec).
  return {
    model: 'test-alias',
    messages: [
      { role: 'user', content: 'Tell me a fun fact about the Roman Empire' },
      {
        role: 'assistant',
        content:
          'Roman concrete grows stronger over time because seawater reacts with volcanic ash in the mix.',
      },
      { role: 'user', content: 'why' },
    ],
    stream: false,
    incomingApiType: 'chat',
    originalBody: {
      model: 'test-alias',
      stream: false,
      messages: [
        { role: 'user', content: 'Tell me a fun fact about the Roman Empire' },
        {
          role: 'assistant',
          content:
            'Roman concrete grows stronger over time because seawater reacts with volcanic ash in the mix.',
        },
        { role: 'user', content: 'why' },
      ],
    },
  };
}

describe('Dispatcher OAuth pass-through regression (issue #162)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      'sk-ant-oat-fake-token-for-test'
    );
    // Native OAuth runs through the standard fetch path — mock the
    // upstream so no real network call is made. A minimal Anthropic Messages
    // non-streaming response body is enough to exercise the native path.
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'because' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('multi-turn request with string assistant content dispatches via the native path', async () => {
    // Native OAuth builds the Anthropic body via the native transformer (no
    // pi-ai Context IR / executor) and runs through the standard fetch path.
    setConfigForTesting(oauthConfigWithChatAccessVia());
    const dispatcher = new Dispatcher();

    await expect(dispatcher.dispatch(multiTurnChatRequest())).resolves.toBeDefined();

    // Confirm we actually hit the native Anthropic endpoint with the OAuth
    // Bearer token + CC fingerprint headers (not pi-ai's executor).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-ant-oat-fake-token-for-test');
    expect(headers['anthropic-beta']).toBeTruthy();
    expect(headers['x-app']).toBe('cli');
  });
});

// Regression coverage for the production defect where OpenAI-format clients
// (chat/responses) routed to an OAuth-Anthropic native target received RAW
// Anthropic SSE back (empty completions — no `choices`, no `data: [DONE]`).
// Root cause: the native-OAuth response bypass in request-payload-builder.ts
// was unconditional (`true`) for the Anthropic branch, regardless of the
// incoming client's API format. Fix mirrors the identical Codex defect fixed
// in commit 4f74c1c6 ("fix(oauth): translate cross-format Codex responses"):
// scope the bypass to same-format (`messages`) clients only; chat/responses
// clients must flow through the standard transform pipeline.

function oauthAnthropicCrossFormatConfig() {
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
            access_via: ['chat', 'messages', 'responses'],
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

// A realistic upstream Anthropic Messages SSE stream: message_start ->
// content_block_start/delta (text) -> content_block_stop -> message_delta
// (stop_reason: end_turn) -> message_stop. Whitespace/shape kept exactly as
// a real Anthropic response would send it — the messages-inbound regression
// guard asserts byte-for-byte equality against this constant.
const UPSTREAM_ANTHROPIC_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_test123","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from Claude"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

function chatStreamingRequest(): UnifiedChatRequest {
  const body = {
    model: 'test-alias',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'test-alias',
    messages: body.messages,
    stream: true,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

function responsesStreamingRequest(): UnifiedChatRequest {
  const body = {
    model: 'test-alias',
    stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  };
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    incomingApiType: 'responses',
    originalBody: body,
  } as any;
}

function messagesStreamingRequest(): UnifiedChatRequest {
  const body = {
    model: 'test-alias',
    max_tokens: 256,
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'test-alias',
    messages: body.messages,
    max_tokens: 256,
    stream: true,
    incomingApiType: 'messages',
    originalBody: body,
  } as any;
}

function nonStreamingChatRequest(): UnifiedChatRequest {
  const body = {
    model: 'test-alias',
    stream: false,
    messages: [{ role: 'user', content: 'hi' }],
  };
  return {
    model: 'test-alias',
    messages: body.messages,
    stream: false,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

async function drainBytes(stream: ReadableStream): Promise<string> {
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

/** Extracts every SSE frame's JSON `data:` payload, dropping the `[DONE]` sentinel. */
function parseSseDataPayloads(text: string): any[] {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => !!line)
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data));
}

describe('Dispatcher OAuth pass-through — cross-format Anthropic response translation (regression)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      'sk-ant-oat-fake-token-for-test'
    );
    fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(
      new Response(UPSTREAM_ANTHROPIC_SSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  /**
   * Mirrors the standard dispatch pipeline in response-handler.ts (~lines
   * 274-284): raw provider SSE -> providerTransformer.transformStream ->
   * unified chunks -> clientTransformer.formatStream -> client SSE bytes.
   * The dispatcher itself never runs this pipeline (it only decides, via
   * `bypassTransformation`, whether response-handler.ts should) so the test
   * replicates it to prove cross-format clients actually get a well-formed,
   * translated stream rather than just checking the boolean flag.
   */
  async function translatedClientBytes(
    response: UnifiedChatResponse,
    incomingApiType: string
  ): Promise<string> {
    const providerTransformer = TransformerFactory.getTransformer('messages');
    const clientTransformer = TransformerFactory.getTransformer(incomingApiType);
    const unifiedStream = providerTransformer.transformStream!(response.stream!);
    const clientStream = clientTransformer.formatStream!(unifiedStream);
    return drainBytes(clientStream);
  }

  test('chat-inbound + oauth-anthropic target, streaming: translates to OpenAI chunks, no raw Anthropic frames', async () => {
    setConfigForTesting(oauthAnthropicCrossFormatConfig());
    const response = await new Dispatcher().dispatch(chatStreamingRequest());

    // Sanity: the upstream leg always speaks native Anthropic Messages.
    expect(response.plexus?.apiType).toBe('messages');
    // The actual fix: response leg must NOT bypass for a chat-inbound client.
    expect(response.bypassTransformation).toBe(false);
    expect(response.stream).toBeDefined();

    const clientBytes = await translatedClientBytes(response, 'chat');
    const payloads = parseSseDataPayloads(clientBytes);

    const contentChunk = payloads.find((p) => p.choices?.[0]?.delta?.content);
    expect(contentChunk?.choices[0].delta.content).toBe('Hello from Claude');

    const finishChunk = payloads.find((p) => p.choices?.[0]?.finish_reason);
    expect(finishChunk?.choices[0].finish_reason).toBe('stop');

    expect(clientBytes.trim().endsWith('data: [DONE]')).toBe(true);
    // No raw Anthropic SSE frames leaked to the client (OpenAI chunks never
    // use a named `event:` line).
    expect(clientBytes).not.toMatch(/^event:/m);
    expect(clientBytes).not.toContain('message_start');
    expect(clientBytes).not.toContain('content_block_delta');
  });

  test('responses-inbound + oauth-anthropic target, streaming: translates to Responses events, no raw Anthropic frames', async () => {
    setConfigForTesting(oauthAnthropicCrossFormatConfig());
    const response = await new Dispatcher().dispatch(responsesStreamingRequest());

    expect(response.plexus?.apiType).toBe('messages');
    expect(response.bypassTransformation).toBe(false);
    expect(response.stream).toBeDefined();

    const clientBytes = await translatedClientBytes(response, 'responses');
    const payloads = parseSseDataPayloads(clientBytes);

    const deltaEvent = payloads.find((p) => p.type === 'response.output_text.delta');
    expect(deltaEvent?.delta).toBe('Hello from Claude');
    expect(payloads.some((p) => p.type === 'response.completed')).toBe(true);

    expect(clientBytes).toContain('event: response.output_text.delta');
    expect(clientBytes).not.toContain('event: message_start');
    expect(clientBytes).not.toContain('event: content_block_delta');
    expect(clientBytes).not.toContain('event: message_delta');
    expect(clientBytes).not.toContain('event: message_stop');
  });

  test('messages-inbound + oauth-anthropic target, streaming: raw Anthropic SSE passthrough unchanged (regression guard)', async () => {
    setConfigForTesting(oauthAnthropicCrossFormatConfig());
    const response = await new Dispatcher().dispatch(messagesStreamingRequest());

    expect(response.bypassTransformation).toBe(true);
    expect(response.stream).toBeDefined();

    const clientBytes = await drainBytes(response.stream!);
    // Byte-for-byte: Claude Code traffic depends on zero re-serialization.
    expect(clientBytes).toBe(UPSTREAM_ANTHROPIC_SSE);
  });

  test('chat-inbound + oauth-anthropic target, non-streaming: same scoping applies (bypass disabled, JSON translated)', async () => {
    setConfigForTesting(oauthAnthropicCrossFormatConfig());
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'msg_test123',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'Hello from Claude' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const response = await new Dispatcher().dispatch(nonStreamingChatRequest());

    // Non-streaming's non-bypass branch (dispatcher.ts handleNonStreamingResponse)
    // returns transformer.transformResponse(...) as-is without stamping an
    // explicit `bypassTransformation: false` (only the bypass=true branch stamps
    // it). response-handler.ts only ever does a truthy check on this flag, so
    // `undefined` and `false` are behaviorally identical — assert falsy rather
    // than a stricter equality the surrounding code doesn't actually guarantee.
    expect(response.bypassTransformation).toBeFalsy();

    const formatted = await TransformerFactory.getTransformer('chat').formatResponse(response);
    expect(formatted.choices[0].message.content).toBe('Hello from Claude');
  });

  // End-to-end lock for the scenario the manual `translatedClientBytes` tests
  // above only approximate: drive `handleResponse` ITSELF (the code that runs
  // in production) with the dispatcher's real cross-format result and let it
  // resolve the REAL provider transformer (AnthropicTransformer, via the
  // un-mocked TransformerFactory) and the REAL client transformer
  // (OpenAITransformer). Asserts the exact bytes a chat client receives.
  test('chat-inbound + oauth-anthropic target, streaming: END-TO-END through handleResponse yields OpenAI chunks', async () => {
    setConfigForTesting(oauthAnthropicCrossFormatConfig());
    const response = await new Dispatcher().dispatch(chatStreamingRequest());

    // Preconditions (same dispatcher decisions the manual tests assert).
    expect(response.plexus?.apiType).toBe('messages');
    expect(response.bypassTransformation).toBe(false);
    expect(response.stream).toBeDefined();

    const clientTransformer = TransformerFactory.getTransformer('chat');
    const usageRecord: Partial<UsageRecord> = { requestId: 'req-e2e-cross-format' };
    const usageStorage = {
      saveRequest: vi.fn(),
      saveError: vi.fn(),
      updatePerformanceMetrics: vi.fn(),
    } as unknown as UsageStorageService;
    const sentBodies: any[] = [];
    const reply = {
      header: vi.fn(function (this: any) {
        return this;
      }),
      code: vi.fn(function (this: any) {
        return this;
      }),
      send: vi.fn(function (this: any, body: any) {
        sentBodies.push(body);
        return this;
      }),
    } as unknown as FastifyReply;
    const fastifyRequest = { id: 'req-e2e-cross-format', headers: {} } as unknown as FastifyRequest;

    await handleResponse(
      fastifyRequest,
      reply,
      response,
      clientTransformer,
      usageRecord,
      usageStorage,
      Date.now(),
      'chat'
    );

    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'text/event-stream');

    // handleResponse sends a Node Readable pipeline — collect the exact bytes
    // a client would receive over the wire.
    const pipeline = sentBodies.at(-1);
    expect(pipeline).toBeDefined();
    const clientBytes: string = await new Promise((resolve, reject) => {
      let out = '';
      pipeline.on('data', (chunk: any) => {
        out += chunk.toString();
      });
      pipeline.once('end', () => resolve(out));
      pipeline.once('error', reject);
    });
    // Let fire-and-forget completion work (UsageInspector flush) settle.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Structured SSE parsing: every data frame must be an OpenAI chat chunk.
    const payloads = parseSseDataPayloads(clientBytes);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(payload.object).toBe('chat.completion.chunk');
    }

    const contentChunk = payloads.find((p) => p.choices?.[0]?.delta?.content);
    expect(contentChunk?.choices[0].delta.content).toBe('Hello from Claude');

    const finishChunk = payloads.find((p) => p.choices?.[0]?.finish_reason);
    expect(finishChunk?.choices[0].finish_reason).toBe('stop');

    expect(clientBytes.trim().endsWith('data: [DONE]')).toBe(true);

    // No raw Anthropic SSE frames may leak through the real pipeline.
    expect(clientBytes).not.toMatch(/^event:/m);
    expect(clientBytes).not.toContain('message_start');
    expect(clientBytes).not.toContain('content_block_delta');

    // Pipeline bookkeeping: the stream had visible output and was transformed.
    expect(usageRecord.responseStatus).toBe('success');
    expect(usageRecord.isPassthrough).toBe(false);
    expect(usageStorage.saveRequest).toHaveBeenCalled();
  });
});
