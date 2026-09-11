import { describe, expect, test } from 'vitest';
import {
  createThinkingSignatureStripState,
  isAnthropicMessagesPayload,
  matchThinkingSignatureError,
  planThinkingSignatureStrip,
  refundThinkingSignatureStrip,
  stripThinkingSignatureBlocks,
  MAX_THINKING_SIGNATURE_STRIP_RETRIES,
} from '../dispatch/dispatcher-auto-compat';
import {
  ANTHROPIC_MESSAGES_PAYLOAD,
  ARRAY_CONTENT_NO_THINKING_PAYLOAD,
  MULTIPLE_THINKING_BLOCKS_PAYLOAD,
  PLAIN_STRING_MESSAGES_PAYLOAD,
  REDACTED_THINKING_PAYLOAD,
  THINKING_COPY_ON_WRITE_PAYLOAD,
  THINKING_COPY_ON_WRITE_UNTOUCHED_MESSAGE,
  THINKING_ONLY_ALTERNATION_PAYLOAD,
  THINKING_ONLY_END_PAYLOAD,
  THINKING_ORPHAN_TOOL_RESULT_PAYLOAD,
  THINKING_PAIRED_TOOL_RESULT_PAYLOAD,
  THINKING_SIGNATURE_ERROR_RESPONSE_BODY,
  THINKING_SIGNATURE_PLAN_ERROR_BODY,
  THINKING_TEXT_PAYLOAD,
  THINKING_TOOL_USE_PAYLOAD,
} from './dispatcher-auto-compat.fixtures';

// ---------------------------------------------------------------------------
// T3: thinking-signature failover recovery
// ---------------------------------------------------------------------------
//
// Alias-level failover can replay a conversation containing `thinking` /
// `redacted_thinking` blocks signed by one Claude model against a different
// Claude model (e.g. cc/claude-opus-5 -> cc/claude-opus-4-8). Anthropic
// rejects the stale signature with a 400 naming it specifically; every
// remaining target would reject the same replayed signature the same way, so
// failing over doesn't help — strip the thinking blocks and retry the SAME
// target instead.

describe('matchThinkingSignatureError', () => {
  test('matches the exact production error body', () => {
    const body = THINKING_SIGNATURE_ERROR_RESPONSE_BODY;
    expect(matchThinkingSignatureError(body)).toBe(true);
  });

  test('matches without backtick quoting around signature/thinking', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"Invalid signature in thinking block"}}')
    ).toBe(true);
  });

  test('matches regardless of case', () => {
    expect(matchThinkingSignatureError('INVALID SIGNATURE IN THINKING BLOCK')).toBe(true);
  });

  test('returns false for an unrelated 400 body', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"Invalid request: missing model"}}')
    ).toBe(false);
  });

  test('returns false for a thinking-adjacent but unrelated error', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"thinking.budget_tokens must be positive"}}')
    ).toBe(false);
  });

  test('returns false for an empty body', () => {
    expect(matchThinkingSignatureError('')).toBe(false);
  });
});

describe('isAnthropicMessagesPayload', () => {
  test('true when the payload has a messages array', () => {
    expect(isAnthropicMessagesPayload({ model: 'claude-x', messages: [] })).toBe(true);
  });

  test('false when messages is missing (e.g. a Responses API payload)', () => {
    expect(isAnthropicMessagesPayload({ model: 'gpt-5.5', input: 'hi' })).toBe(false);
  });

  test('false when messages is present but not an array', () => {
    expect(isAnthropicMessagesPayload({ messages: 'not-an-array' })).toBe(false);
  });

  test('false for null, undefined, and non-object payloads', () => {
    expect(isAnthropicMessagesPayload(null)).toBe(false);
    expect(isAnthropicMessagesPayload(undefined)).toBe(false);
    expect(isAnthropicMessagesPayload('a string')).toBe(false);
  });
});

describe('stripThinkingSignatureBlocks', () => {
  test('removes a thinking block preceding text, preserving ordering', () => {
    const payload: Record<string, any> = THINKING_TEXT_PAYLOAD;
    const snapshot = structuredClone(payload);

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
    ]);
    // Copy-on-write: the ORIGINAL payload argument is never mutated.
    expect(payload).toEqual(snapshot);
  });

  test('removes a thinking block preceding a tool_use, preserving ordering', () => {
    const payload: Record<string, any> = THINKING_TOOL_USE_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages[1].content).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
    ]);
    // Ordering/other messages untouched.
    expect(result.payload.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'do the thing' }],
    });
  });

  test('removes a redacted_thinking block, preserving sibling content', () => {
    const payload: Record<string, any> = REDACTED_THINKING_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
    ]);
  });

  test('removes both thinking and redacted_thinking blocks in the same message', () => {
    const payload: Record<string, any> = MULTIPLE_THINKING_BLOCKS_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(2);
    expect(result.payload.messages[0].content).toEqual([{ type: 'text', text: 'the answer' }]);
  });

  test('leaves non-array content (plain string messages) untouched and returns the SAME payload reference', () => {
    const payload: Record<string, any> = PLAIN_STRING_MESSAGES_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
    expect(payload.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  test('is a no-op (same payload reference) when the payload has no messages array', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5', input: 'hi' };

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
    expect(payload).toEqual({ model: 'gpt-5.5', input: 'hi' });
  });

  test('no-op contract: an Anthropic-shaped payload with array content but no thinking blocks returns strippedCount 0 and the SAME reference', () => {
    // The structural isAnthropicMessagesPayload check also matches OpenAI
    // chat-completions payloads (they have a `messages` array too). This is
    // the known false-positive shape the dispatch loop must NOT retry on:
    // strippedCount 0 + identical payload reference is the signal.
    const payload: Record<string, any> = ARRAY_CONTENT_NO_THINKING_PAYLOAD;
    const snapshot = structuredClone(payload);

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
    expect(payload).toEqual(snapshot);
  });

  test('copy-on-write: never mutates the input payload, its messages array, or untouched message objects', () => {
    const untouchedMessage = THINKING_COPY_ON_WRITE_UNTOUCHED_MESSAGE;
    const payload: Record<string, any> = THINKING_COPY_ON_WRITE_PAYLOAD;
    const originalMessages = payload.messages;
    const snapshot = structuredClone(payload);

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    // A NEW root object with a NEW messages array is returned...
    expect(result.payload).not.toBe(payload);
    expect(result.payload.messages).not.toBe(originalMessages);
    // ...while the input payload keeps its original array and full content.
    expect(payload.messages).toBe(originalMessages);
    expect(payload).toEqual(snapshot);
    // Untouched messages are shared (not cloned), mirroring deleteDottedPath's
    // "untouched sibling branches are shared" copy-on-write behavior.
    expect(result.payload.messages[0]).toBe(untouchedMessage);
  });

  test('drops a thinking-only assistant message at the end of the conversation (no alternation break, nothing to orphan)', () => {
    const payload: Record<string, any> = THINKING_ONLY_END_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  test('replaces a thinking-only assistant message with a placeholder when dropping it would break user/assistant alternation', () => {
    const payload: Record<string, any> = THINKING_ONLY_ALTERNATION_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'text', text: '[reasoning elided]' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ]);
  });

  test('replaces a thinking-only message with a placeholder when dropping it would orphan a tool_result (no matching tool_use adjacent)', () => {
    // Deliberately constructed so the alternation check alone would NOT catch
    // this (prev='assistant', next='user' — different roles) — isolating the
    // tool_result-orphan guard: `next` carries a tool_result but `prev` does
    // NOT carry the tool_use it would need to correspond to, so dropping the
    // thinking-only message would leave that tool_result dangling.
    const payload: Record<string, any> = THINKING_ORPHAN_TOOL_RESULT_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages[2]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[reasoning elided]' }],
    });
    // Everything else is untouched.
    expect(result.payload.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'q' }],
    });
    expect(result.payload.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial answer, no tool call' }],
    });
    expect(result.payload.messages[3]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
    });
  });

  test('drops a thinking-only message when the next tool_result correctly pairs with a preceding tool_use', () => {
    // Here dropping the empty message actually restores correct adjacency
    // between the tool_use and its tool_result, so it is safe to drop.
    const payload: Record<string, any> = THINKING_PAIRED_TOOL_RESULT_PAYLOAD;

    const result = stripThinkingSignatureBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'search', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
      },
    ]);
  });
});

describe('planThinkingSignatureStrip', () => {
  const signatureBody = THINKING_SIGNATURE_PLAN_ERROR_BODY;
  const anthropicPayload = ANTHROPIC_MESSAGES_PAYLOAD;

  test('MAX_THINKING_SIGNATURE_STRIP_RETRIES is exactly 1 (one strip-retry per target)', () => {
    expect(MAX_THINKING_SIGNATURE_STRIP_RETRIES).toBe(1);
  });

  test('plans a strip-retry on the first matching 400 for an Anthropic messages payload', () => {
    const state = createThinkingSignatureStripState();
    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('does not plan a retry when the body does not name a signature error', () => {
    const state = createThinkingSignatureStripState();
    expect(
      planThinkingSignatureStrip('{"error":{"message":"Invalid request"}}', anthropicPayload, state)
    ).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('does not plan a retry when the outbound payload is not Anthropic-messages-shaped', () => {
    const state = createThinkingSignatureStripState();
    const responsesPayload = { model: 'gpt-5.5', input: 'hi' };
    expect(planThinkingSignatureStrip(signatureBody, responsesPayload, state)).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('retry bound: a second signature 400 on the same target does not plan a second strip-retry', () => {
    const state = createThinkingSignatureStripState();

    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    // Upstream 400s again with the SAME (or another) signature error — the
    // one-per-target bound is already used up, so normal failover must
    // proceed instead of stripping again.
    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(false);
    expect(state.attempts).toBe(1);
  });

  test('refundThinkingSignatureStrip returns the budget after a 0-strip plan, so a later genuine signature 400 can still strip-retry', () => {
    // Sequence mirrors the dispatch loop's false-positive path: the plan
    // fires (structural check matched an OpenAI-shaped payload), the strip
    // turns out to be a no-op (0 blocks), NO retry happens — so the attempt
    // is refunded and the one-per-target budget stays available.
    const state = createThinkingSignatureStripState();

    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);

    refundThinkingSignatureStrip(state);
    expect(state.attempts).toBe(0);

    // The budget is intact: a later signature 400 on the same target still
    // gets its strip-and-retry.
    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('refundThinkingSignatureStrip never drives attempts below zero', () => {
    const state = createThinkingSignatureStripState();
    refundThinkingSignatureStrip(state);
    expect(state.attempts).toBe(0);
  });
});
