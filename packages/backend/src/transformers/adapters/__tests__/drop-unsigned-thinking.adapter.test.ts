import { describe, expect, it } from 'bun:test';

import {
  dropUnsignedThinkingAdapter,
  dropUnsignedThinkingBlocks,
  isUnsignedThinkingBlock,
} from '../drop-unsigned-thinking.adapter';

function makePayload(messages: any[]): Record<string, any> {
  return { model: 'claude-sonnet-4', max_tokens: 1024, messages };
}

/** Every consecutive pair of messages, so an alternation break is a one-liner. */
function hasConsecutiveSameRole(messages: any[]): boolean {
  return messages.some((message, index) => {
    const previous = messages[index - 1];
    return !!previous && previous.role === message.role;
  });
}

function run(payload: any): any {
  return dropUnsignedThinkingAdapter.preDispatch(payload);
}

describe('isUnsignedThinkingBlock', () => {
  it('matches a thinking block with no usable signature', () => {
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'a' })).toBe(true);
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'b', signature: undefined })).toBe(
      true
    );
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'c', signature: '' })).toBe(true);
    expect(isUnsignedThinkingBlock({ type: 'thinking', thinking: 'd', signature: 42 })).toBe(true);
  });

  it('leaves a signed thinking block, redacted_thinking and other blocks alone', () => {
    expect(
      isUnsignedThinkingBlock({ type: 'thinking', thinking: 'a', signature: 'EqQB...sig' })
    ).toBe(false);
    expect(isUnsignedThinkingBlock({ type: 'redacted_thinking', data: 'opaque' })).toBe(false);
    expect(isUnsignedThinkingBlock({ type: 'text', text: 'hi' })).toBe(false);
    expect(isUnsignedThinkingBlock(null)).toBe(false);
    expect(isUnsignedThinkingBlock('thinking')).toBe(false);
  });
});

describe('dropUnsignedThinkingBlocks', () => {
  it('drops a thinking block whose signature is undefined (openai reasoning_content replay)', () => {
    const payload = makePayload([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'deepseek reasoning', signature: undefined },
          { type: 'text', text: 'hello' },
        ],
      },
    ]);

    const { payload: out, droppedBlockCount } = dropUnsignedThinkingBlocks(payload);

    expect(out.messages[1].content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(droppedBlockCount).toBe(1);
  });

  it('drops thinking blocks with a missing, empty or non-string signature', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'a' },
          { type: 'thinking', thinking: 'b', signature: '' },
          { type: 'thinking', thinking: 'c', signature: 42 },
          { type: 'text', text: 'ok' },
        ],
      },
    ]);

    expect(dropUnsignedThinkingBlocks(payload).payload.messages[0].content).toEqual([
      { type: 'text', text: 'ok' },
    ]);
  });

  it('keeps a signed thinking block untouched and returns the payload reference unchanged', () => {
    const signed = { type: 'thinking', thinking: 'claude reasoning', signature: 'EqQB...sig' };
    const payload = makePayload([
      { role: 'assistant', content: [signed, { type: 'text', text: 'hello' }] },
    ]);

    const { payload: out, droppedBlockCount } = dropUnsignedThinkingBlocks(payload);

    expect(out).toBe(payload);
    expect(droppedBlockCount).toBe(0);
    expect(out.messages[0].content[0]).toBe(signed);
  });

  it('keeps redacted_thinking and tool_use blocks', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'x', signature: undefined },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} },
        ],
      },
    ]);

    expect(
      dropUnsignedThinkingBlocks(payload).payload.messages[0].content.map((b: any) => b.type)
    ).toEqual(['redacted_thinking', 'tool_use']);
  });

  it('never mutates the input payload, its messages array or its messages', () => {
    const thinking = { type: 'thinking', thinking: 'x' };
    const messages = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'ok' }] },
    ];
    const payload = makePayload(messages);
    const before = structuredClone(payload);

    dropUnsignedThinkingBlocks(payload);

    expect(payload).toEqual(before);
    expect(payload.messages).toBe(messages);
    expect(payload.messages[1]!.content[0]).toBe(thinking);
  });

  describe('role alternation after an emptied turn', () => {
    // Anthropic rejects two consecutive `user` (or `assistant`) turns, so the
    // emptied turn cannot simply be omitted: the neighbours are merged.
    it('assistant(thinking only) -> user following: merges the two user turns instead of leaving them adjacent', () => {
      const payload = makePayload([
        { role: 'user', content: [{ type: 'text', text: 'one' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
        { role: 'user', content: [{ type: 'text', text: 'two' }] },
      ]);

      const { payload: out, droppedTurnCount } = dropUnsignedThinkingBlocks(payload);
      const roles = out.messages.map((m: any) => m.role);

      expect(droppedTurnCount).toBe(1);
      expect(hasConsecutiveSameRole(out.messages)).toBe(false);
      expect(roles).toEqual(['user']);
      expect(out.messages[0].content).toEqual([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]);
    });

    it('merges two string-content turns into text blocks', () => {
      const payload = makePayload([
        { role: 'user', content: 'one' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
        { role: 'user', content: 'two' },
      ]);

      const out = dropUnsignedThinkingBlocks(payload).payload;

      expect(out.messages).toHaveLength(1);
      expect(out.messages[0]).toMatchObject({
        role: 'user',
        content: [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ],
      });
    });

    it('merges an emptied assistant turn separating two assistant turns', () => {
      // Not a shape Anthropic accepts as input, but the repair must not leave it
      // broken in a new way: the emptied turn disappears and its neighbours merge.
      const payload = makePayload([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
        { role: 'user', content: 'q2' },
      ]);

      const out = dropUnsignedThinkingBlocks(payload).payload;

      expect(out.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(out.messages[1].content).toEqual([{ type: 'text', text: 'a1' }]);
    });

    it('collapses several emptied turns in a row into one merge', () => {
      const payload = makePayload([
        { role: 'user', content: 'one' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'a' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'b' }] },
        { role: 'user', content: 'two' },
      ]);

      const out = dropUnsignedThinkingBlocks(payload).payload;

      expect(out.messages.map((m: any) => m.role)).toEqual(['user']);
      expect(out.messages[0].content).toEqual([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]);
    });

    it('drops an emptied trailing assistant turn without merging anything', () => {
      const payload = makePayload([
        { role: 'user', content: 'one' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
      ]);

      const out = dropUnsignedThinkingBlocks(payload).payload;

      expect(out.messages.map((m: any) => m.role)).toEqual(['user']);
    });

    it('keeps the tool_result turn adjacent to the tool_use it answers', () => {
      // The emptied turn carried no tool_use, so dropping it cannot orphan a
      // tool_result — the merged user turn still holds the result block first.
      const payload = makePayload([
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'search', input: {} }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only' }] },
        { role: 'user', content: 'thanks' },
      ]);

      const out = dropUnsignedThinkingBlocks(payload).payload;

      expect(out.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(out.messages[2].content).toEqual([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
        { type: 'text', text: 'thanks' },
      ]);
    });

    it('keeps a strictly alternating history alternating when every turn carries text', () => {
      // The 100%-deepseek replay shape: every assistant turn has unsigned
      // reasoning AND content, so only the blocks go and no merge is needed.
      const payload = makePayload([
        { role: 'user', content: 'one' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'r1' },
            { type: 'text', text: 'a1' },
          ],
        },
        { role: 'user', content: 'two' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'r2' },
            { type: 'text', text: 'a2' },
          ],
        },
      ]);

      const {
        payload: out,
        droppedBlockCount,
        droppedTurnCount,
      } = dropUnsignedThinkingBlocks(payload);

      expect(droppedBlockCount).toBe(2);
      expect(droppedTurnCount).toBe(0);
      expect(out.messages.map((m: any) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(out.messages[1].content).toEqual([{ type: 'text', text: 'a1' }]);
      expect(out.messages[3].content).toEqual([{ type: 'text', text: 'a2' }]);
    });
  });

  it('tolerates payloads without a messages array', () => {
    expect(dropUnsignedThinkingBlocks({}).payload).toEqual({});
    expect(dropUnsignedThinkingBlocks(null as any).payload).toBe(null as any);
    expect(dropUnsignedThinkingBlocks({ messages: 'nope' } as any).payload).toEqual({
      messages: 'nope',
    });
  });

  it('leaves non-array content untouched and does not count it as a drop', () => {
    const payload = makePayload([
      { role: 'user', content: 'plain' },
      { role: 'assistant', content: null },
    ]);

    const { payload: out, droppedBlockCount } = dropUnsignedThinkingBlocks(payload);

    expect(droppedBlockCount).toBe(0);
    expect(out).toBe(payload);
  });

  it('is idempotent', () => {
    const payload = makePayload([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'x' },
          { type: 'text', text: 'ok' },
        ],
      },
    ]);

    const once = dropUnsignedThinkingBlocks(payload).payload;
    const twice = dropUnsignedThinkingBlocks(once);

    expect(once.messages[0].content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(twice.payload).toBe(once);
    expect(twice.droppedBlockCount).toBe(0);
  });
});

describe('dropUnsignedThinkingAdapter', () => {
  it('exposes the registry name', () => {
    expect(dropUnsignedThinkingAdapter.name).toBe('drop_unsigned_thinking');
  });

  it('preDispatch returns the payload with unsigned thinking gone', () => {
    const out = run(
      makePayload([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }])
    );
    expect(out.messages).toEqual([]);
  });

  it('postDispatch is the identity', () => {
    const response = { content: [{ type: 'thinking', thinking: 'x' }] };
    expect(dropUnsignedThinkingAdapter.postDispatch(response)).toBe(response);
  });
});
