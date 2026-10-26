import { describe, expect, it } from 'bun:test';

import type { UnifiedChatRequest } from '../../../types/unified';
import { hoistMidConversationEntries } from '../request-payload-builder';

/**
 * Cross-format egress has no in-conversation system concept, so Anthropic
 * mid-conversation `role: 'system'` entries are deliberately hoisted into the
 * request's system prompt instead of being dropped by accident. Contentless
 * entries (the per-turn `output_config`-only shape) carry nothing to hoist —
 * their effort already travels on `request.reasoning`.
 */
describe('hoistMidConversationEntries', () => {
  const request = (messages: UnifiedChatRequest['messages']): UnifiedChatRequest =>
    ({ model: 'some-model', messages }) as UnifiedChatRequest;

  it('returns the request untouched when it carries no mid-conversation entries', () => {
    const original = request([{ role: 'user', content: 'hello' }]);
    expect(hoistMidConversationEntries(original)).toBe(original);
  });

  it('appends the entries to an existing system prompt and drops them from the list', () => {
    const original = request([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first' },
      { role: 'system', content: 'Answer briefly.', mid_conversation: true },
      { role: 'assistant', content: 'ok' },
    ]);

    const result = hoistMidConversationEntries(original);

    expect(result.messages).toEqual([
      { role: 'system', content: 'You are helpful.\n\nAnswer briefly.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('appends to array-shaped system content without losing existing blocks', () => {
    const original = request([
      {
        role: 'system',
        content: [{ type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: 'first' },
      { role: 'system', content: 'Answer briefly.', mid_conversation: true },
    ]);

    const result = hoistMidConversationEntries(original);

    expect(result.messages[0]!.content).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Answer briefly.' },
    ]);
  });

  it('creates a system prompt when the request has none', () => {
    const original = request([
      { role: 'user', content: 'first' },
      { role: 'system', content: 'Be concise.\n\nPrefer tables.', mid_conversation: true },
      { role: 'assistant', content: 'ok' },
    ]);

    const result = hoistMidConversationEntries(original);

    expect(result.messages).toEqual([
      { role: 'system', content: 'Be concise.\n\nPrefer tables.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('drops contentless entries without creating a system prompt', () => {
    const original = request([
      { role: 'user', content: 'first' },
      { role: 'system', content: '', mid_conversation: true },
      { role: 'assistant', content: 'ok' },
    ]);

    const result = hoistMidConversationEntries(original);

    expect(result.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
    ]);
  });
});
