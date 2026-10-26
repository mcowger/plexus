import { describe, expect, it } from 'bun:test';

import type { UnifiedChatRequest } from '../../../types/unified';
import { dropMidConversationEntries } from '../request-payload-builder';

/**
 * Cross-format egress has no in-conversation system concept, and folding the
 * entries' content into the target's system prompt would rewrite the caller's
 * prompt. So non-Messages targets deliberately drop them instead. The per-turn
 * effort those entries carry is not lost — it already travels on
 * `request.reasoning`.
 */
describe('dropMidConversationEntries', () => {
  const request = (messages: UnifiedChatRequest['messages']): UnifiedChatRequest =>
    ({ model: 'some-model', messages }) as UnifiedChatRequest;

  it('returns the request untouched when it carries no mid-conversation entries', () => {
    const original = request([{ role: 'user', content: 'hello' }]);
    expect(dropMidConversationEntries(original)).toBe(original);
  });

  it('drops the entries without touching the system prompt or other messages', () => {
    const original = request([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first' },
      { role: 'system', content: 'Answer briefly.', mid_conversation: true },
      { role: 'assistant', content: 'ok' },
    ]);

    const result = dropMidConversationEntries(original);

    expect(result.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('drops contentless output_config-only entries', () => {
    const original = request([
      { role: 'user', content: 'first' },
      { role: 'system', content: '', mid_conversation: true },
      { role: 'assistant', content: 'ok' },
    ]);

    const result = dropMidConversationEntries(original);

    expect(result.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('leaves the rest of the request alone', () => {
    const original: UnifiedChatRequest = {
      ...request([
        { role: 'system', content: 'Be brief.', mid_conversation: true },
        { role: 'user', content: 'hi' },
      ]),
      reasoning: { effort: 'high', enabled: true },
    };

    const result = dropMidConversationEntries(original);

    expect(result.reasoning).toEqual({ effort: 'high', enabled: true });
    expect(result.model).toBe('some-model');
  });
});
