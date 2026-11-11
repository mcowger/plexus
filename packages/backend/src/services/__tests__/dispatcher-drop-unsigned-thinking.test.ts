import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

// Shared handles registered globally by the preload. mockLogger is asserted on
// for the warn `drop_unsigned_thinking` emits when it removes a block;
// mockComplete backs the pi-ai executor.
import { mockComplete, mockLogger } from '../../../test/mocks';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';

// @earendil-works/pi-ai is mocked globally in bun-test.setup.ts — do not add a
// per-file mock.module() call here. Dispatcher is imported dynamically so it
// resolves after that registration, mirroring
// dispatcher-anthropic-tool-id-normalization.test.ts.
const { Dispatcher } = await import('../dispatch/dispatcher');

const fetchMock: any = mock(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
});

// ---------------------------------------------------------------------------
// Wire-level proof for the `drop_unsigned_thinking` adapter.
//
// Anthropic rejects a `thinking` block with no `signature`
// (`messages.N.content.0.thinking.signature: Field required`), yet a
// Messages-speaking upstream such as Kimi/Moonshot accepts — and expects — the
// unsigned block, and `transformers/anthropic/request-builder.ts` is shared by
// both. So the shared builder stays target-neutral and the drop is
// target-scoped: injected by `adapter-resolver.ts` only when the outbound wire
// type is Messages AND the target looks like Anthropic.
//
// These tests drive the REAL Dispatcher end to end and read the outbound bytes
// off `fetch`, so they prove the injection point, both payload paths
// (messages -> messages pass-through and chat -> messages transform) and the
// role-alternation repair — not just the pure function.
// ---------------------------------------------------------------------------

function messagesSuccessResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function chatSuccessResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** `api_base_url` in record form so the 'messages' wire type is explicit. */
function makeMessagesConfig(options: { baseUrl: string; providerType?: string }) {
  return {
    providers: {
      p1: {
        ...(options.providerType ? { type: options.providerType } : {}),
        api_base_url: { messages: options.baseUrl },
        api_key: 'test-key-p1',
        useClaudeMasking: false,
        models: { 'model-1': {} },
      },
    },
    models: {
      'msgs-alias': { selector: 'in_order', targets: [{ provider: 'p1', model: 'model-1' }] },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

/** A non-Anthropic Messages-speaking proxy (the Kimi/Moonshot shape). */
function makeProxyMessagesConfig() {
  return makeMessagesConfig({ baseUrl: 'https://p1.example.com/v1', providerType: 'messages' });
}

/** The Anthropic-shaped target: an anthropic.com host on the Messages wire. */
function makeAnthropicMessagesConfig() {
  return makeMessagesConfig({ baseUrl: 'https://gw1.anthropic.com/v1', providerType: 'messages' });
}

/** The reasoning fallback target the unsigned thinking came from. */
function makeDeepseekChatConfig() {
  return {
    providers: {
      ds: {
        type: 'chat',
        api_base_url: 'https://api.deepseek.com/v1',
        api_key: 'test-key-ds',
        models: { 'deepseek-reasoner': {} },
      },
    },
    models: {
      'reasoner-alias': {
        selector: 'in_order',
        targets: [{ provider: 'ds', model: 'deepseek-reasoner' }],
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

/** A same-format (messages -> messages) body: the pass-through path. */
function makeMessagesRequest(alias: string, messages: any[]): UnifiedChatRequest {
  return {
    model: alias,
    // Unified `messages` is required by the type but unused on the pass-through
    // path — the bypass path clones `originalBody` verbatim.
    messages: [{ role: 'user', content: 'placeholder' }],
    incomingApiType: 'messages',
    stream: false,
    originalBody: { model: alias, max_tokens: 1024, messages },
  } as any;
}

/** A chat -> messages request: no `originalBody`, so the builder really runs. */
function makeChatToMessagesRequest(alias: string, messages: any[]): UnifiedChatRequest {
  return {
    model: alias,
    messages,
    incomingApiType: 'chat',
    stream: false,
  } as any;
}

/** Parses the JSON body of the Nth `fetch` call. */
function outboundBody(callIndex: number): any {
  const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

/** Every content block type in the body, in document order. */
function blockTypes(body: any): string[] {
  return (body.messages ?? []).flatMap((message: any) =>
    Array.isArray(message.content) ? message.content.map((block: any) => block.type) : []
  );
}

function hasConsecutiveSameRole(body: any): boolean {
  const messages: any[] = body.messages ?? [];
  return messages.some((message, index) => index > 0 && messages[index - 1]!.role === message.role);
}

/** The adapter's own operator-visible trace, used to prove it ran. */
function dropWarns(): string[] {
  return mockLogger.warn.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.includes('drop_unsigned_thinking'));
}

describe('Dispatcher unsigned-thinking drop', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    CooldownManager.resetForTesting();
    mockComplete.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      provider: 'anthropic',
      model: 'claude-test',
    } as any);
  });

  test('messages -> messages pass-through: the unsigned block never reaches the wire, and the emptied turn is merged', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    // The broken shape: a deepseek turn that carried reasoning and no text sits
    // between two user turns.
    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(
      makeMessagesRequest('msgs-alias', [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'deepseek reasoning' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ])
    );

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://gw1.anthropic.com/v1/messages'
    );

    const body = outboundBody(0);
    expect(blockTypes(body)).toEqual(['text', 'text']);
    // Dropping the assistant turn alone would leave two `user` turns back to
    // back, which Anthropic rejects just as hard as the unsigned signature.
    expect(hasConsecutiveSameRole(body)).toBe(false);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);

    expect(dropWarns()).toHaveLength(1);
    expect(dropWarns()[0]).toContain('dropped 1 unsigned thinking block(s)');
  });

  test('messages -> messages pass-through: a signed Claude history is forwarded byte-identical', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'claude reasoning', signature: 'EqQB...sig' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: 'answer' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    ];

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeMessagesRequest('msgs-alias', messages));

    const body = outboundBody(0);
    // Nothing dropped: signed thinking and redacted_thinking are valid input.
    expect(body.messages).toEqual(messages);
    expect(dropWarns()).toHaveLength(0);
  });

  test('chat -> messages transform: the builder emits the block neutrally and the adapter drops it for the Anthropic target', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    // No `originalBody`, so `transformers/anthropic/request-builder.ts` really
    // runs: it must keep the unsigned block (a Kimi/Moonshot target needs it),
    // and the target-scoped adapter is what removes it here.
    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(
      makeChatToMessagesRequest('msgs-alias', [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'hello',
          thinking: { content: 'deepseek reasoning' },
        },
        { role: 'user', content: 'again' },
      ])
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = outboundBody(0);
    expect(blockTypes(body)).toEqual(['text', 'text', 'text']);
    // `cache_control` markers are added by the cache-control behavior for
    // Anthropic targets, so assert the block shape, not the whole object.
    expect(body.messages[1].content.map((block: any) => [block.type, block.text])).toEqual([
      ['text', 'hello'],
    ]);
    expect(dropWarns()).toHaveLength(1);
  });

  test('chat -> messages transform: a turn with nothing but unsigned thinking is merged into its neighbours', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(
      makeChatToMessagesRequest('msgs-alias', [
        { role: 'user', content: 'hi' },
        // Reasoning-only turn: the builder emits `content: [thinking]`, which
        // the drop empties completely.
        { role: 'assistant', thinking: { content: 'deepseek reasoning' } },
        { role: 'user', content: 'following' },
      ])
    );

    const body = outboundBody(0);
    expect(hasConsecutiveSameRole(body)).toBe(false);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    // `cache_control` markers are added by the cache-control behavior for
    // Anthropic targets, so assert the blocks' text, not the whole object.
    expect(body.messages[0].content.map((block: any) => [block.type, block.text])).toEqual([
      ['text', 'hi'],
      ['text', 'following'],
    ]);
  });

  test('non-Anthropic messages proxy: unsigned thinking is preserved verbatim', async () => {
    setConfigForTesting(makeProxyMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    // Kimi/Moonshot requires the unsigned block to stay present on historical
    // assistant turns; dropping it there would be the regression the earlier
    // shared-builder approach introduced.
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'deepseek reasoning' },
          { type: 'text', text: 'answer' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    ];

    const dispatcher = new Dispatcher();
    await dispatcher.dispatch(makeMessagesRequest('msgs-alias', messages));

    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://p1.example.com/v1/messages'
    );
    expect(outboundBody(0).messages).toEqual(messages);
    // Not merely a no-op rewrite: the adapter was never in the chain.
    expect(dropWarns()).toHaveLength(0);
  });

  test('100% deepseek history on the reasoning target: reasoning_content is untouched', async () => {
    setConfigForTesting(makeDeepseekChatConfig());
    fetchMock.mockImplementation(async () => chatSuccessResponse('deepseek-reasoner'));

    // Same session as above, before any Anthropic target entered it: every
    // assistant turn carries `reasoning_content` and no signature. The chat wire
    // type never gets the adapter, so the history is forwarded as-is.
    const dispatcher = new Dispatcher();
    await dispatcher.dispatch({
      model: 'reasoner-alias',
      messages: [{ role: 'user', content: 'placeholder' }],
      incomingApiType: 'chat',
      stream: false,
      originalBody: {
        model: 'reasoner-alias',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'answer', reasoning_content: 'deepseek reasoning' },
          { role: 'user', content: 'follow up' },
        ],
      },
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
    const body = outboundBody(0);
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: 'answer',
      reasoning_content: 'deepseek reasoning',
    });
    expect(dropWarns()).toHaveLength(0);
  });
});
