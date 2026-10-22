import { beforeEach, describe, expect, it, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';

// Shared handles registered globally by the preload. mockLogger is asserted on for
// the warn the normalize_anthropic_tool_ids adapter emits when it rewrites ids;
// mockComplete backs the pi-ai executor.
import { mockComplete, mockLogger } from '../../../test/mocks';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';

// @earendil-works/pi-ai is mocked globally in bun-test.setup.ts — do not add a
// per-file mock.module() call here. Dispatcher is imported dynamically so it
// resolves after that registration, mirroring dispatcher-claude-masking.test.ts.
const { Dispatcher } = await import('../dispatch/dispatcher');

const fetchMock: any = mock(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
});

// ---------------------------------------------------------------------------
// Wire-level proof for the `normalize_anthropic_tool_ids` adapter.
//
// The adapter is injected implicitly by adapter-resolver.ts for routes that
// satisfy BOTH halves of its gate: the FINAL outbound wire type is Anthropic
// Messages AND the target looks like Anthropic (anthropic.com base URL,
// Anthropic OAuth, or Claude masking). A provider/model `adapter` entry
// overrides that either way. These tests drive the REAL Dispatcher end to end
// and read the outbound bytes off `fetch`, so they prove the injection point,
// the ordering relative to Claude-Code masking, and the per-attempt behaviour —
// not just the pure function.
//
// `functions.WebSearch:3` is the real Moonshot/Kimi id shape that makes
// Anthropic hard-400 with
//   `messages.N.content.M.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`.
// ---------------------------------------------------------------------------

/** A tool id outside Anthropic's `^[a-zA-Z0-9_-]+$` charset (dot + colon). */
const POISONED_ID = 'functions.WebSearch:3';
/**
 * What the sanitizer must produce: every offending char replaced with `_`,
 * suffixed with the first 8 hex chars of sha256 OVER THE ORIGINAL id, hashed
 * as UTF-16 code units (see the adapter — UTF-8 would collapse lone surrogates).
 * Pinned as a literal so a silent change to the derivation fails loudly here.
 */
const SANITIZED_ID = 'functions_WebSearch_3_0ad6c974';
/** An Anthropic-native id that is already charset-valid — must be untouched. */
const VALID_ID = 'toolu_01GoodId';

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

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { type: 'api_error', message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * An Anthropic Messages body carrying TWO tool pairs:
 *   - a poisoned pair (`tool_use.id` + the `tool_result.tool_use_id` that
 *     references it) that must be rewritten consistently, and
 *   - a already-valid `toolu_` pair that must survive byte-identical.
 */
function poisonedMessagesBody(model: string) {
  return {
    model,
    max_tokens: 1024,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'search please' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: POISONED_ID, name: 'web_search', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: POISONED_ID, content: 'ok' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: VALID_ID, name: 'read_file', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: VALID_ID, content: 'ok' }],
      },
    ],
  };
}

/** The same two tool pairs in CHAT wire shape (message-level, not content blocks). */
function poisonedChatBody(model: string) {
  return {
    model,
    messages: [
      { role: 'user', content: 'search please' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: POISONED_ID, type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: POISONED_ID, content: 'ok' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: VALID_ID, type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: VALID_ID, content: 'ok' },
    ],
  };
}

/**
 * Collects every tool id out of an Anthropic body's `messages[].content[]`, in
 * document order. Position-independent so it also works on a body the
 * Claude-Code masking pipeline has restructured.
 */
function collectAnthropicToolIds(body: any): { toolUseIds: unknown[]; toolResultIds: unknown[] } {
  const toolUseIds: unknown[] = [];
  const toolResultIds: unknown[] = [];
  for (const message of body?.messages ?? []) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool_use') toolUseIds.push(block.id);
      if (block?.type === 'tool_result') toolResultIds.push(block.tool_use_id);
    }
  }
  return { toolUseIds, toolResultIds };
}

/** Parses the JSON body of the Nth `fetch` call. */
function outboundBody(callIndex: number): any {
  const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

/** The signed CCH field inside the Claude Code billing header block. */
const CCH_PATTERN = /cch=([0-9a-f]{5});/;

/**
 * Recomputes the Claude-Code billing signature (CCH) over a transmitted body,
 * replaying `transformers/oauth/masking/sign-billing.ts` exactly:
 * `sha256(JSON.stringify(body-with-the-cch=00000-placeholder)).slice(0, 5)`.
 *
 * The recompute is possible because that algorithm is a pure function of the
 * transmitted body — no salt, no clock, no secret. Restoring the placeholder
 * (same length as the signature it replaced) reconstructs the exact bytes that
 * were hashed: `signBillingHeader` rebuilds the body by spreading, which
 * preserves key order, and `JSON.parse`/`JSON.stringify` round-trip that order
 * too, so `JSON.stringify(unsigned)` here is byte-identical to what was signed.
 */
function recomputeCch(transmittedBody: any): string {
  const [firstBlock, ...restSystem] = transmittedBody.system as any[];
  const unsigned = {
    ...transmittedBody,
    system: [
      { ...firstBlock, text: String(firstBlock.text).replace(CCH_PATTERN, 'cch=00000;') },
      ...restSystem,
    ],
  };
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex').slice(0, 5);
}

/**
 * A plain (no masking, no OAuth) Anthropic-Messages provider. `api_base_url`
 * uses the record/map form so getProviderTypes() resolves the 'messages' API
 * type explicitly — the string-URL inference path only recognizes 'messages'
 * for URLs containing "anthropic.com" (see config.ts's getProviderTypes()).
 * The hosts are anthropic.com gateways so the routes also satisfy the second
 * half of the injection gate; keeping the record form means these tests
 * wire-prove the record branch of `isAnthropicTargetProvider` at the same time.
 */
function makeMessagesConfig(options?: { targetCount?: number }) {
  const targetCount = options?.targetCount ?? 1;

  const providers: Record<string, any> = {
    p1: {
      type: 'messages',
      api_base_url: { messages: 'https://gw1.anthropic.com/v1' },
      api_key: 'test-key-p1',
      useClaudeMasking: false,
      models: { 'model-1': {} },
    },
    p2: {
      type: 'messages',
      api_base_url: { messages: 'https://gw2.anthropic.com/v1' },
      api_key: 'test-key-p2',
      useClaudeMasking: false,
      models: { 'model-2': {} },
    },
  };

  const orderedTargets = [
    { provider: 'p1', model: 'model-1' },
    { provider: 'p2', model: 'model-2' },
  ].slice(0, targetCount);

  return {
    providers,
    models: {
      'claude-alias': {
        selector: 'in_order',
        targets: orderedTargets,
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

/**
 * A Messages-format provider that is NOT Anthropic: same record/map shape as
 * `makeMessagesConfig`, but hosted on a plain proxy domain. The route's outbound
 * wire type is still Anthropic Messages, so it isolates the second half of the
 * injection gate. `adapter` optionally sets the provider-level override.
 */
function makeProxyMessagesConfig(adapter?: any[]) {
  return {
    providers: {
      p1: {
        type: 'messages',
        api_base_url: { messages: 'https://p1.example.com/v1' },
        api_key: 'test-key-p1',
        useClaudeMasking: false,
        ...(adapter ? { adapter } : {}),
        models: { 'model-1': {} },
      },
    },
    models: {
      'proxy-alias': {
        selector: 'in_order',
        targets: [{ provider: 'p1', model: 'model-1' }],
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

/** An OpenAI-compatible chat provider — the negative control. */
function makeChatConfig() {
  return {
    providers: {
      p1: {
        type: 'chat',
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'test-key-p1',
        models: { 'model-1': {} },
      },
    },
    models: {
      'chat-alias': {
        selector: 'in_order',
        targets: [{ provider: 'p1', model: 'model-1' }],
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

/**
 * Verbatim copy of dispatcher-claude-masking.test.ts's masked-route config.
 * The provider SLUG is a parameter because `useClaudeMasking` is
 * provider-name-agnostic: any static provider can carry it, including one whose
 * name collides with a native-OAuth provider id.
 */
function maskedAnthropicConfig(providerSlug = 'claude_masked') {
  return {
    providers: {
      [providerSlug]: {
        type: 'messages',
        api_base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-api03-masked-test-key',
        useClaudeMasking: true,
        models: {
          'claude-test': {
            pricing: { source: 'simple', input: 0, output: 0 },
          },
        },
      },
    },
    models: {
      'test-model': {
        targets: [{ provider: providerSlug, model: 'claude-test' }],
      },
    },
    keys: {},
  } as any;
}

/** The masked-route client request (same-format Messages, poisoned tool ids). */
function makeMaskedRequest(): UnifiedChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'search please' }],
    incomingApiType: 'messages',
    stream: false,
    originalBody: poisonedMessagesBody('test-model'),
  } as any;
}

/** A same-format (messages -> messages) client request: the pass-through path. */
function makeMessagesRequest(alias: string): UnifiedChatRequest {
  return {
    model: alias,
    // Unified `messages` is required by the type but unused on the pass-through
    // path — the bypass path clones `originalBody` verbatim.
    messages: [{ role: 'user', content: 'search please' }],
    incomingApiType: 'messages',
    stream: false,
    originalBody: poisonedMessagesBody(alias),
  } as any;
}

/**
 * A cross-format client request: chat in, Anthropic Messages out. No
 * `originalBody`, so `shouldUsePassThrough` is false and the real
 * `transformers/anthropic/request-builder.ts` runs, carrying `tool_calls[].id`
 * / `tool_call_id` straight into `tool_use` / `tool_result` blocks.
 */
function makeChatToAnthropicRequest(alias: string): UnifiedChatRequest {
  return {
    model: alias,
    messages: [
      { role: 'user', content: 'search please' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: POISONED_ID, type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: POISONED_ID, content: 'ok' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: VALID_ID, type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: VALID_ID, content: 'ok' },
    ],
    incomingApiType: 'chat',
    stream: false,
  } as UnifiedChatRequest;
}

/** The adapter's own operator-visible trace, used to prove it was injected. */
function normalizeWarns(): string[] {
  return mockLogger.warn.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.includes('normalize_anthropic_tool_ids'));
}

describe('Dispatcher Anthropic tool-id normalization', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    CooldownManager.resetForTesting();
    // Re-apply since mockReset: true clears mock() state between tests. No
    // assertion depends on the value; it only keeps the pi-ai executor from
    // throwing if a route were ever misrouted onto it.
    mockComplete.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      provider: 'anthropic',
      model: 'claude-test',
    } as any);
  });

  test('the pinned sanitized id is <replaced>_<first 8 hex of sha256(ORIGINAL id as utf16le)>', () => {
    // Documents where the literal above comes from, independently of the
    // adapter module, so the exact-match assertions below stay readable.
    // `update(<string>)` would encode UTF-8, which is lossy for lone
    // surrogates; the adapter hashes the UTF-16 code units instead.
    const hash8 = createHash('sha256')
      .update(Buffer.from(POISONED_ID, 'utf16le'))
      .digest('hex')
      .slice(0, 8);
    expect(SANITIZED_ID).toBe(`functions_WebSearch_3_${hash8}`);
    expect(SANITIZED_ID).toMatch(/^functions_WebSearch_3_[0-9a-f]{8}$/);
  });

  test('messages -> messages pass-through: poisoned tool ids are rewritten on the wire, valid ids untouched', async () => {
    setConfigForTesting(makeMessagesConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    // Dispatch THIS instance and assert against a snapshot of its own
    // originalBody afterwards — inspecting a freshly built request instead
    // would inspect a pristine copy the dispatcher never saw.
    const request = makeMessagesRequest('claude-alias');
    const originalBodyBefore = structuredClone((request as any).originalBody);

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(request);

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gw1.anthropic.com/v1/messages');

    const body = outboundBody(0);
    // Pass-through rewrites the alias to the target's real model id.
    expect(body.model).toBe('model-1');

    // BOTH halves of the poisoned pair land on the SAME sanitized value —
    // that consistency is what keeps the conversation referentially intact.
    expect(body.messages[1].content[1]).toEqual({
      type: 'tool_use',
      id: SANITIZED_ID,
      name: 'web_search',
      input: {},
    });
    expect(body.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: SANITIZED_ID,
      content: 'ok',
    });
    expect(SANITIZED_ID).toMatch(/^functions_WebSearch_3_[0-9a-f]{8}$/);

    // The already-valid Anthropic pair is byte-identical.
    expect(body.messages[3].content[0]).toEqual({
      type: 'tool_use',
      id: VALID_ID,
      name: 'read_file',
      input: {},
    });
    expect(body.messages[4].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: VALID_ID,
      content: 'ok',
    });

    // Non-tool content is left completely alone.
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'search please' }]);
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: 'searching' });

    // The adapter really ran (implicit injection for the messages wire format),
    // and rewrote exactly the two offending ids — not the two valid ones.
    const warns = normalizeWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('rewrote 2 tool id(s)');

    // The client's own body must not be mutated — the payload the adapter
    // rewrites is an attempt-local deep clone. Compared against a snapshot of
    // the DISPATCHED request's body, taken before dispatch.
    const originalBodyAfter = (request as any).originalBody;
    expect(originalBodyAfter).toEqual(originalBodyBefore);
    expect(originalBodyAfter.messages[1].content[1].id).toBe(POISONED_ID);
    expect(originalBodyAfter.messages[2].content[0].tool_use_id).toBe(POISONED_ID);
  });

  test('Claude-masking route: tool ids are sanitized BEFORE masking/CCH signing wraps the body', async () => {
    setConfigForTesting(maskedAnthropicConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('claude-test'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMaskedRequest());

    expect(response).toBeDefined();
    // The masked API-key route goes NATIVE (real fetch, x-api-key), not pi-ai.
    expect(mockComplete).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-api03-masked-test-key');
    expect(headers.Authorization).toBeUndefined();
    expect(headers['anthropic-beta']).toBeTruthy();

    const body = outboundBody(0);
    // Masking markers: identity system block rebuilt + billing header signed.
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].text).toContain('x-anthropic-billing-header');

    // ...and the tool ids inside that SIGNED body are the sanitized ones.
    const { toolUseIds, toolResultIds } = collectAnthropicToolIds(body);
    expect(toolUseIds).toEqual([SANITIZED_ID, VALID_ID]);
    expect(toolResultIds).toEqual([SANITIZED_ID, VALID_ID]);

    // Ordering proof, not just co-presence: recompute the CCH over the body as
    // transmitted (sanitized ids and all) and require it to match the signature
    // actually emitted. Had normalization run AFTER signing, the emitted
    // signature would cover the POISONED body and this would not match — the
    // exact silent-corruption mode this adapter's placement exists to avoid.
    const emittedCch = CCH_PATTERN.exec(body.system[0].text)?.[1];
    expect(emittedCch).toBeDefined();
    expect(emittedCch).not.toBe('00000');
    expect(recomputeCch(body)).toBe<unknown>(emittedCch);

    // The recompute is genuinely id-sensitive: putting the poisoned ids back
    // changes the hash, so the match above cannot be an accident.
    const poisonedBody = JSON.parse(JSON.stringify(body).replaceAll(SANITIZED_ID, POISONED_ID));
    expect(recomputeCch(poisonedBody)).not.toBe(emittedCch);

    expect(normalizeWarns()).toHaveLength(1);
  });

  test('Claude-masking route whose provider slug collides with a native-OAuth id still dispatches as Messages', async () => {
    // `useClaudeMasking` is provider-name-agnostic, so nothing stops an operator
    // from naming a masked provider 'openai-codex'. The masked route carries no
    // oauth_provider, so the slug used to fall through to nativeOAuthApiType()
    // and resolve the wire type to 'responses' — which would drop the native
    // Anthropic path (no masking, no x-api-key, wrong endpoint) AND, because the
    // effective wire type was no longer 'messages', skip the tool-id normalizer.
    setConfigForTesting(maskedAnthropicConfig('openai-codex'));
    fetchMock.mockImplementation(async () => messagesSuccessResponse('claude-test'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMaskedRequest());

    expect(response).toBeDefined();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-api03-masked-test-key');
    expect(headers.Authorization).toBeUndefined();
    expect(headers['anthropic-beta']).toBeTruthy();

    const body = outboundBody(0);
    // Masking markers: identity system block rebuilt + billing header signed.
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].text).toContain('x-anthropic-billing-header');

    const { toolUseIds, toolResultIds } = collectAnthropicToolIds(body);
    expect(toolUseIds).toEqual([SANITIZED_ID, VALID_ID]);
    expect(toolResultIds).toEqual([SANITIZED_ID, VALID_ID]);

    expect(normalizeWarns()).toHaveLength(1);
  });

  test('chat -> messages transform: ids carried across by the Anthropic request-builder are sanitized', async () => {
    setConfigForTesting(makeMessagesConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatToAnthropicRequest('claude-alias'));

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = outboundBody(0);
    // No pass-through: the real request-builder produced these content blocks
    // from `tool_calls[].id` / `tool_call_id`.
    const { toolUseIds, toolResultIds } = collectAnthropicToolIds(body);
    expect(toolUseIds).toEqual([SANITIZED_ID, VALID_ID]);
    expect(toolResultIds).toEqual([SANITIZED_ID, VALID_ID]);
    // Same value on both halves of the poisoned pair, again.
    expect(toolUseIds[0]).toBe(toolResultIds[0]);

    expect(normalizeWarns()).toHaveLength(1);
  });

  test('chat -> chat target: the adapter is NOT injected and message-level tool ids are byte-identical', async () => {
    setConfigForTesting(makeChatConfig());
    fetchMock.mockImplementation(async () => chatSuccessResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      model: 'chat-alias',
      messages: [{ role: 'user', content: 'search please' }],
      incomingApiType: 'chat',
      stream: false,
      originalBody: poisonedChatBody('chat-alias'),
    } as any);

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = outboundBody(0);
    // The OpenAI wire has no tool-id charset rule — rewriting here would
    // silently corrupt ids the client will match against on the next turn.
    expect(body.messages[1].tool_calls[0].id).toBe(POISONED_ID);
    expect(body.messages[2].tool_call_id).toBe(POISONED_ID);
    expect(body.messages[3].tool_calls[0].id).toBe(VALID_ID);
    expect(body.messages[4].tool_call_id).toBe(VALID_ID);
    expect(body.messages).toEqual(poisonedChatBody('chat-alias').messages);

    // Not merely a no-op rewrite — the adapter was never in the chain.
    expect(normalizeWarns()).toHaveLength(0);
  });

  test('non-Anthropic messages proxy: the adapter is NOT injected and tool ids pass through verbatim', async () => {
    setConfigForTesting(makeProxyMessagesConfig());
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMessagesRequest('proxy-alias'));

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://p1.example.com/v1/messages'
    );

    const body = outboundBody(0);
    // Only the alias -> target model rewrite; every message is byte-identical,
    // poisoned ids included. A Messages-speaking proxy does not enforce
    // Anthropic's charset, and rewriting here would break the ids the client
    // matches against on its next turn.
    expect(body.model).toBe('model-1');
    expect(body.messages).toEqual(poisonedMessagesBody('proxy-alias').messages);

    // Not merely a no-op rewrite — the adapter was never in the chain.
    expect(normalizeWarns()).toHaveLength(0);
  });

  test('non-Anthropic messages proxy: an explicit provider adapter entry force-enables normalization', async () => {
    setConfigForTesting(
      makeProxyMessagesConfig([
        { name: 'normalize_anthropic_tool_ids', options: {}, enabled: true },
      ])
    );
    fetchMock.mockImplementation(async () => messagesSuccessResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMessagesRequest('proxy-alias'));

    expect(response).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Still the proxy host — the escape hatch is the only thing that changed.
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://p1.example.com/v1/messages'
    );

    const body = outboundBody(0);
    const { toolUseIds, toolResultIds } = collectAnthropicToolIds(body);
    expect(toolUseIds).toEqual([SANITIZED_ID, VALID_ID]);
    expect(toolResultIds).toEqual([SANITIZED_ID, VALID_ID]);

    expect(normalizeWarns()).toHaveLength(1);
  });

  test('failover: every attempt gets its own freshly sanitized body', async () => {
    setConfigForTesting(makeMessagesConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'upstream boom'))
      .mockImplementationOnce(async () => messagesSuccessResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMessagesRequest('claude-alias'));
    const meta = (response as any).plexus;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');

    // Each attempt re-clones `originalBody` and re-runs the adapter. The
    // sanitizer being pure and deterministic is what makes the second attempt
    // land on the SAME ids as the first — no cross-attempt id bookkeeping.
    for (const callIndex of [0, 1]) {
      const body = outboundBody(callIndex);
      const { toolUseIds, toolResultIds } = collectAnthropicToolIds(body);
      expect(toolUseIds).toEqual([SANITIZED_ID, VALID_ID]);
      expect(toolResultIds).toEqual([SANITIZED_ID, VALID_ID]);
    }
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe(
      'https://gw1.anthropic.com/v1/messages'
    );
    expect(String((fetchMock.mock.calls[1] as any[])[0])).toBe(
      'https://gw2.anthropic.com/v1/messages'
    );

    // One warn per attempt — the rewrite genuinely re-ran, it was not carried
    // over from a mutated shared payload.
    expect(normalizeWarns()).toHaveLength(2);
  });
});
