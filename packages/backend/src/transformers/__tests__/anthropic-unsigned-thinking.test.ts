import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../openai';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildAnthropicRequest } from '../anthropic/request-builder';
import {
  isUnsignedThinkingBlock,
  stripUnsignedThinkingAdapter,
} from '../adapters/strip-unsigned-thinking.adapter';
import { resolveAdapters } from '../../services/dispatch/adapter-resolver';
import {
  createThinkingSignatureStripState,
  matchThinkingSignatureError,
  planThinkingSignatureStrip,
} from '../../services/dispatch/dispatcher-auto-compat';
import type { RouteResult } from '../../services/routing/router';
import type { UnifiedChatRequest } from '../../types/unified';

/**
 * Unsigned `thinking` blocks on the Anthropic Messages wire.
 *
 * Anthropic requires every `thinking` block to carry the `signature` it issued
 * with it and rejects one without:
 *
 *   400 invalid_request_error
 *   "messages.N.content.0.thinking.signature: Field required"
 *
 * The signature has nowhere to live on the OpenAI chat-completions wire (prior
 * reasoning is exposed only as `reasoning_content` text), so a chat -> messages
 * translation that replays history from another model — or from Claude via a
 * translating proxy — produces unsigned thinking and 400s on every turn of the
 * session. New sessions work; old sessions break on the first model switch.
 *
 * But the Messages wire format is not Anthropic's alone. Kimi's compatible
 * endpoint requires unsigned thinking to REMAIN on historical assistant
 * tool-call messages, so the shared builder must not drop it. The fix is split:
 *
 *   - shared builder:   preserve unsigned thinking, omit the `signature` key
 *   - adapter:          `strip_unsigned_thinking`, injected only for targets
 *                       known to be Anthropic (same gate as the tool-id
 *                       normalizer)
 *   - reactive fallback: the existing strip-and-retry also matches the
 *                       missing-signature 400, for strict or unknown gateways
 */

const SIGNED = {
  content: 'Signed reasoning',
  signature: 'EqQBCkYIBBgCKkD5vY3f6QTn5v1h8+examplesignature==',
};

function unified(messages: UnifiedChatRequest['messages']): UnifiedChatRequest {
  return { model: 'claude-fable-5-1', messages } as UnifiedChatRequest;
}

function route(configOverrides: Record<string, any>): RouteResult {
  return {
    provider: 'p',
    model: 'claude-fable-5-1',
    config: {
      api_key: 'key',
      enabled: true,
      disable_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      ...configOverrides,
    } as any,
    modelConfig: undefined,
  } as RouteResult;
}

/** Run every resolved adapter's preDispatch in order, like request-payload-builder does. */
function applyAdapters(routeResult: RouteResult, apiType: string, payload: Record<string, any>) {
  return resolveAdapters(routeResult, apiType).reduce(
    (p, { adapter, options }) => adapter.preDispatch(p, options),
    payload
  );
}

// ---------------------------------------------------------------------------
// Shared builder: preserve unsigned thinking, never emit `signature: undefined`
// ---------------------------------------------------------------------------

describe('buildAnthropicRequest — unsigned thinking is preserved', () => {
  it('emits an unsigned thinking block without a signature key', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', thinking: { content: 'Unsigned reasoning' } },
      ])
    );

    const [thinking, text] = built.messages[1].content;
    expect(thinking).toEqual({ type: 'thinking', thinking: 'Unsigned reasoning' });
    expect('signature' in thinking).toBe(false);
    expect(text).toEqual({ type: 'text', text: 'hello' });
  });

  it('treats an empty-string signature as absent', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', thinking: { content: 'x', signature: '' } },
      ])
    );

    expect('signature' in built.messages[1].content[0]).toBe(false);
  });

  it('forwards a signed thinking block untouched', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', thinking: SIGNED },
      ])
    );

    expect(built.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: SIGNED.content,
      signature: SIGNED.signature,
    });
  });

  it('keeps unsigned thinking on a historical tool-call message (the Kimi replay shape)', async () => {
    // Kimi's compatible endpoint requires this block to stay. The builder does
    // not know the target, so it must not strip it here.
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'read the file' },
        {
          role: 'assistant',
          content: null,
          thinking: { content: 'I should call the tool' },
          tool_calls: [
            {
              id: 'toolu_01',
              type: 'function',
              function: { name: 'Read', arguments: '{"path":"a.ts"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_01', content: 'file contents' },
      ])
    );

    expect(built.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'I should call the tool' },
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.ts' } },
    ]);
  });

  it('chat-completions reasoning_content becomes an unsigned thinking block', async () => {
    const parsed = await new OpenAITransformer().parseRequest({
      model: 'claude-fable-5-1',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', reasoning_content: 'From another model' },
        { role: 'user', content: 'again' },
      ],
    });
    const built = await buildAnthropicRequest(parsed);

    expect(built.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: 'From another model',
    });
  });
});

// ---------------------------------------------------------------------------
// Adapter: strip_unsigned_thinking
// ---------------------------------------------------------------------------

describe('isUnsignedThinkingBlock', () => {
  it('matches thinking blocks with a missing or empty signature', () => {
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'x' })).toBe(true);
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'x', signature: '' })).toBe(true);
  });

  it('does not match signed thinking, redacted_thinking, or non-thinking blocks', () => {
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'x', signature: 'sig' })).toBe(
      false
    );
    expect(isUnsignedThinkingBlock({ type: 'redacted_thinking', data: 'opaque' })).toBe(false);
    expect(isUnsignedThinkingBlock({ type: 'text', text: 'x' })).toBe(false);
    expect(isUnsignedThinkingBlock(null)).toBe(false);
  });
});

describe('strip_unsigned_thinking adapter', () => {
  it('removes unsigned thinking and keeps the rest of the turn', () => {
    const out = stripUnsignedThinkingAdapter.preDispatch({
      model: 'claude-fable-5-1',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'unsigned' },
            { type: 'text', text: 'hello' },
          ],
        },
      ],
    });

    expect(out.messages[1].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('leaves signed thinking and redacted_thinking alone', () => {
    const content = [
      { type: 'thinking', thinking: SIGNED.content, signature: SIGNED.signature },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'text', text: 'hello' },
    ];
    const payload = { model: 'm', messages: [{ role: 'assistant', content }] };

    const out = stripUnsignedThinkingAdapter.preDispatch(payload);

    expect(out).toBe(payload); // nothing stripped -> same reference
    expect(out.messages[0].content).toEqual(content);
  });

  it('preserves tool_use when stripping unsigned thinking from a tool-call turn', () => {
    const out = stripUnsignedThinkingAdapter.preDispatch({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'read' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'unsigned' },
            { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.ts' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' }],
        },
      ],
    });

    expect(out.messages[1].content).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.ts' } },
    ]);
  });

  it('drops a message emptied by the strip when alternation still holds', () => {
    const out = stripUnsignedThinkingAdapter.preDispatch({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only thinking' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('leaves a placeholder instead of breaking user/assistant alternation', () => {
    const out = stripUnsignedThinkingAdapter.preDispatch({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only thinking' }] },
        { role: 'user', content: [{ type: 'text', text: 'again' }] },
      ],
    });

    expect(out.messages).toHaveLength(3);
    expect(out.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[reasoning elided]' }],
    });
  });

  it('does not mutate the input payload', () => {
    const payload = {
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'unsigned' },
            { type: 'text', text: 'hello' },
          ],
        },
      ],
    };
    const snapshot = JSON.stringify(payload);

    stripUnsignedThinkingAdapter.preDispatch(payload);

    expect(JSON.stringify(payload)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Target-aware injection, end to end through the resolver
// ---------------------------------------------------------------------------

describe('unsigned thinking across the builder + resolved adapters', () => {
  const chatHistory = {
    model: 'claude-fable-5-1',
    messages: [
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'From another model',
        tool_calls: [
          { id: 'toolu_01', type: 'function', function: { name: 'Read', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_01', content: 'file contents' },
      { role: 'user', content: 'now what?' },
    ],
  };

  it('strict Anthropic target: the unsigned block is stripped before dispatch', async () => {
    const built = await buildAnthropicRequest(
      await new OpenAITransformer().parseRequest(chatHistory)
    );
    const out = applyAdapters(
      route({ api_base_url: { messages: 'https://api.anthropic.com/v1' } }),
      'messages',
      built
    );

    const thinking = out.messages.flatMap((m: any) =>
      m.content.filter((b: any) => b.type === 'thinking')
    );
    expect(thinking).toHaveLength(0);
    expect(out.messages[1].content).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
    ]);
  });

  it('Kimi-style Messages target: the unsigned block survives on the tool-call turn', async () => {
    const built = await buildAnthropicRequest(
      await new OpenAITransformer().parseRequest(chatHistory)
    );
    const out = applyAdapters(
      route({ api_base_url: { messages: 'https://api.moonshot.ai/anthropic' } }),
      'messages',
      built
    );

    expect(out.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'From another model' },
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
    ]);
  });

  it('native messages -> messages pass-through keeps a real signed block on an Anthropic target', async () => {
    const anthropicRequest = {
      model: 'claude-fable-5-1',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: SIGNED.content, signature: SIGNED.signature },
            { type: 'text', text: 'hello' },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'again' }] },
      ],
    };

    const parsed = await parseAnthropicRequest(anthropicRequest);
    const built = await buildAnthropicRequest({
      ...parsed,
      incomingApiType: 'messages',
      originalBody: anthropicRequest,
    });
    const out = applyAdapters(
      route({ api_base_url: 'https://api.anthropic.com/v1' }),
      'messages',
      built
    );

    expect(out.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: SIGNED.content,
      signature: SIGNED.signature,
    });
  });
});

// ---------------------------------------------------------------------------
// Reactive fallback: the missing-signature 400 also triggers strip-and-retry
// ---------------------------------------------------------------------------

describe('reactive strip-and-retry matches the missing-signature 400', () => {
  const MISSING = JSON.stringify({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'messages.1.content.0.thinking.signature: Field required',
    },
    request_id: 'req_011CepgBQF9GQEpZuJTr4rtb',
  });

  it('matchThinkingSignatureError recognises the production body', () => {
    expect(matchThinkingSignatureError(MISSING)).toBe(true);
  });

  it('still recognises the stale-signature body', () => {
    expect(
      matchThinkingSignatureError(
        '{"error":{"message":"messages.3.content.0: Invalid `signature` in `thinking` block"}}'
      )
    ).toBe(true);
  });

  it('does not match unrelated thinking-parameter 400s', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"thinking.budget_tokens: Field required"}}')
    ).toBe(false);
    expect(
      matchThinkingSignatureError('{"error":{"message":"thinking.type: Input should be adaptive"}}')
    ).toBe(false);
  });

  it('planThinkingSignatureStrip arms one retry for a messages-shaped payload', () => {
    const state = createThinkingSignatureStripState();
    const payload = {
      messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }],
    };

    expect(planThinkingSignatureStrip(MISSING, payload, state)).toBe(true);
    expect(state.attempts).toBe(1);
    // Bounded: a second identical 400 on the same target is not retried again.
    expect(planThinkingSignatureStrip(MISSING, payload, state)).toBe(false);
  });
});
