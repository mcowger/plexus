import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../openai';
import { parseAnthropicRequest } from '../anthropic/request-parser';
import { buildAnthropicRequest } from '../anthropic/request-builder';
import type { UnifiedChatRequest } from '../../types/unified';

/**
 * Regression tests for unsigned `thinking` blocks in the Anthropic request
 * builder.
 *
 * Anthropic requires every `thinking` content block to carry the `signature`
 * it issued with it; a block without one is rejected outright:
 *
 *   400 invalid_request_error
 *   "messages.N.content.0.thinking.signature: Field required"
 *
 * That signature has nowhere to live on the OpenAI chat-completions wire
 * (prior reasoning is exposed only as `reasoning_content` text), so a chat ->
 * messages translation that replays history from another model — or from
 * Claude via a translating proxy — used to emit an unsigned thinking block
 * and 400 on every turn of the session. New sessions worked; old ones broke
 * the moment the client switched to a Claude target.
 */

const SIGNED = {
  content: 'Signed reasoning',
  signature: 'EqQBCkYIBBgCKkD5vY3f6QTn5v1h8+examplesignature==',
};

function unified(messages: UnifiedChatRequest['messages']): UnifiedChatRequest {
  return { model: 'claude-fable-5-1', messages } as UnifiedChatRequest;
}

describe('Anthropic request builder — unsigned thinking blocks', () => {
  it('drops a thinking block that has no signature and keeps the rest of the turn', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'hello',
          thinking: { content: 'Unsigned reasoning from another model' },
        },
        { role: 'user', content: 'again' },
      ])
    );

    const assistant = built.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content.some((b: any) => b.type === 'thinking')).toBe(false);
    expect(assistant.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('treats an empty-string signature as unsigned', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', thinking: { content: 'x', signature: '' } },
      ])
    );

    expect(built.messages[1].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('still forwards a signed thinking block untouched', async () => {
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
    expect(built.messages[1].content[1]).toEqual({ type: 'text', text: 'hello' });
  });

  it('preserves tool_use when the unsigned thinking block is dropped', async () => {
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

    const assistant = built.messages[1];
    expect(assistant.content).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.ts' } },
    ]);
  });

  it('omits an assistant message whose only content was an unsigned thinking block', async () => {
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        // A turn that reasoned but produced neither text nor a tool call.
        { role: 'assistant', content: null, thinking: { content: 'only thinking' } },
        { role: 'user', content: 'again' },
      ])
    );

    // The two user turns now sit next to each other and are merged by the
    // existing same-role merge, so alternation stays valid for Anthropic.
    expect(built.messages).toHaveLength(1);
    expect(built.messages[0].role).toBe('user');
    expect(built.messages[0].content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'text', text: 'again' },
    ]);
    expect(built.messages.every((m: any) => m.content.length > 0)).toBe(true);
  });

  it('does not touch a message with empty content that never had a thinking block', async () => {
    // Guard is scoped to the drop; pre-existing behaviour for other empty
    // assistant messages is unchanged.
    const built = await buildAnthropicRequest(
      unified([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null },
        { role: 'user', content: 'again' },
      ])
    );

    expect(built.messages).toHaveLength(3);
    expect(built.messages[1]).toEqual({ role: 'assistant', content: [] });
  });

  it('end-to-end: chat-completions history with reasoning_content no longer yields an unsigned thinking block', async () => {
    // Reproduces the real failure: a client speaking OpenAI chat-completions
    // replays a prior assistant turn whose reasoning arrived as
    // `reasoning_content`. The OpenAI parser lifts that into a unified
    // `thinking` block with no signature (there is none on the wire).
    const chatRequest = {
      model: 'claude-fable-5-1',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'hello',
          reasoning_content: 'Reasoning produced by a different model',
        },
        { role: 'user', content: 'again' },
      ],
    };

    const parsed = await new OpenAITransformer().parseRequest(chatRequest);
    expect(parsed.messages[1]?.thinking).toEqual({
      content: 'Reasoning produced by a different model',
    });

    const built = await buildAnthropicRequest(parsed);
    const thinkingBlocks = built.messages.flatMap((m: any) =>
      m.content.filter((b: any) => b.type === 'thinking')
    );
    expect(thinkingBlocks).toHaveLength(0);
    expect(built.messages[1].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('messages -> messages round-trip keeps a signed thinking block from a real Anthropic history', async () => {
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

    expect(built.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: SIGNED.content,
      signature: SIGNED.signature,
    });
  });
});
