import { describe, expect, it } from 'bun:test';

import type { UnifiedChatRequest } from '../../../types/unified';
import { buildAnthropicRequest } from '../request-builder';

/**
 * The builder is shared by every Messages-shaped egress, so it must stay
 * target-neutral about thinking-block signatures: Anthropic requires one,
 * Kimi/Moonshot requires the unsigned block to stay present. Signatures are
 * dropped target-side by the `drop_unsigned_thinking` adapter instead.
 */
function requestWithThinking(thinking: {
  content: string;
  signature?: string;
}): UnifiedChatRequest {
  return {
    model: 'upstream-A',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', thinking },
    ],
  };
}

describe('buildAnthropicRequest thinking blocks', () => {
  it('keeps an unsigned thinking block and never emits a signature key', async () => {
    const built = await buildAnthropicRequest(
      requestWithThinking({ content: 'deepseek reasoning' })
    );

    const block = built.messages[1].content[0];
    expect(block).toEqual({ type: 'thinking', thinking: 'deepseek reasoning' });
    expect(Object.keys(block)).not.toContain('signature');
  });

  it('treats an empty string signature as absent rather than forwarding it', async () => {
    const built = await buildAnthropicRequest(requestWithThinking({ content: 'r', signature: '' }));

    const block = built.messages[1].content[0];
    expect(block).toEqual({ type: 'thinking', thinking: 'r' });
    expect(Object.keys(block)).not.toContain('signature');
  });

  it('keeps the signature on a signed thinking block', async () => {
    const built = await buildAnthropicRequest(
      requestWithThinking({ content: 'claude reasoning', signature: 'EqQB...sig' })
    );

    expect(built.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: 'claude reasoning',
      signature: 'EqQB...sig',
    });
  });
});
