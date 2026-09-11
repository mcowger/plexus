import { describe, expect, test } from 'vitest';
import {
  createAdvisorResultStripState,
  matchAdvisorResultError,
  planAdvisorResultStrip,
  refundAdvisorResultStrip,
  stripAdvisorResultBlocks,
  MAX_ADVISOR_RESULT_STRIP_RETRIES,
} from '../dispatch/dispatcher-auto-compat';
import {
  ADVISOR_DROP_PAYLOAD,
  ADVISOR_INVOCATION,
  ADVISOR_NO_RESULT_PAYLOAD,
  ADVISOR_PLACEHOLDER_PAYLOAD,
  ADVISOR_RESULT,
  ADVISOR_RESULT_ERROR_RESPONSE_BODY,
  ADVISOR_RESULT_PLAN_ERROR_BODY,
  ADVISOR_SEPARATE_MESSAGES_PAYLOAD,
  ADVISOR_SINGLE_MESSAGE_PAYLOAD,
  ADVISOR_UNRELATED_TOOL_PAYLOAD,
  ANTHROPIC_MESSAGES_PAYLOAD,
  RESPONSES_API_PAYLOAD,
} from './dispatcher-auto-compat.fixtures';

describe('matchAdvisorResultError', () => {
  test('matches the exact production error body', () => {
    const body = ADVISOR_RESULT_ERROR_RESPONSE_BODY;
    expect(matchAdvisorResultError(body)).toBe(true);
  });

  test('matches regardless of case', () => {
    expect(matchAdvisorResultError('ADVISOR TOOL RESULT CONTENT COULD NOT BE PROCESSED')).toBe(
      true
    );
  });

  test('returns false for an unrelated 400 body', () => {
    expect(matchAdvisorResultError('{"error":{"message":"Invalid request: missing model"}}')).toBe(
      false
    );
  });

  test('returns false for an advisor-adjacent but unrelated error', () => {
    expect(matchAdvisorResultError('{"error":{"message":"advisor tool is not enabled"}}')).toBe(
      false
    );
  });

  test('returns false for an empty body', () => {
    expect(matchAdvisorResultError('')).toBe(false);
  });
});

describe('stripAdvisorResultBlocks', () => {
  // Mirrors the echoed on-wire shape: an assistant `server_tool_use` advisor
  // invocation followed by its account-bound (encrypted) `advisor_tool_result`.
  const advisorInvocation = ADVISOR_INVOCATION;
  const advisorResult = ADVISOR_RESULT;

  test('strips the advisor result and its paired invocation, preserving sibling text', () => {
    const payload: Record<string, any> = ADVISOR_SINGLE_MESSAGE_PAYLOAD;
    const snapshot = structuredClone(payload);

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'let me consult' }] },
    ]);
    // Copy-on-write: the ORIGINAL payload argument is never mutated.
    expect(payload).toEqual(snapshot);
  });

  test('pairs invocation and result by id even when they sit in separate messages', () => {
    const payload: Record<string, any> = ADVISOR_SEPARATE_MESSAGES_PAYLOAD;

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(1);
    // Invocation removed from message 0 (paired by id), leaving its text.
    expect(result.payload.messages[0].content).toEqual([{ type: 'text', text: 'thinking' }]);
    // Result removed from message 1, leaving its text.
    expect(result.payload.messages[1].content).toEqual([{ type: 'text', text: 'the answer' }]);
  });

  test('leaves an unrelated server_tool_use (no matching advisor result) untouched', () => {
    const payload: Record<string, any> = ADVISOR_UNRELATED_TOOL_PAYLOAD;

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(1);
    // Only the advisor pair is gone; the web_search server tool use remains.
    expect(result.payload.messages[0].content).toEqual([
      { type: 'server_tool_use', id: 'srvtoolu_web', name: 'web_search', input: {} },
    ]);
  });

  test('drops a message emptied by the strip when doing so keeps alternation valid', () => {
    const payload: Record<string, any> = ADVISOR_PLACEHOLDER_PAYLOAD;

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(1);
    // The emptied assistant message is dropped; but that would leave two
    // consecutive user messages, so a placeholder is substituted instead.
    expect(result.payload.messages).toHaveLength(3);
    expect(result.payload.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[advisor result elided]' }],
    });
  });

  test('drops an emptied message entirely when alternation stays valid without it', () => {
    const payload: Record<string, any> = ADVISOR_DROP_PAYLOAD;

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(1);
    // Nothing follows the emptied assistant message, so it is dropped outright.
    expect(result.payload.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
    ]);
  });

  test('returns the payload unchanged (0 strips) when there is no advisor result', () => {
    const payload: Record<string, any> = ADVISOR_NO_RESULT_PAYLOAD;

    const result = stripAdvisorResultBlocks(payload);

    expect(result.strippedCount).toBe(0);
    // Same reference back — nothing to rebuild.
    expect(result.payload).toBe(payload);
  });

  test('returns 0 strips for a non-Anthropic (Responses API) payload', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5', input: 'hi' };
    const result = stripAdvisorResultBlocks(payload);
    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
  });
});

describe('planAdvisorResultStrip', () => {
  const advisorBody = ADVISOR_RESULT_PLAN_ERROR_BODY;
  const anthropicPayload = ANTHROPIC_MESSAGES_PAYLOAD;

  test('MAX_ADVISOR_RESULT_STRIP_RETRIES is exactly 1 (one strip-retry per target)', () => {
    expect(MAX_ADVISOR_RESULT_STRIP_RETRIES).toBe(1);
  });

  test('plans a strip-retry on the first matching 400 for an Anthropic messages payload', () => {
    const state = createAdvisorResultStripState();
    expect(planAdvisorResultStrip(advisorBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('does not plan a retry when the body does not name an advisor-result error', () => {
    const state = createAdvisorResultStripState();
    expect(
      planAdvisorResultStrip('{"error":{"message":"Invalid request"}}', anthropicPayload, state)
    ).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('does not plan a retry when the outbound payload is not Anthropic-messages-shaped', () => {
    const state = createAdvisorResultStripState();
    const responsesPayload = RESPONSES_API_PAYLOAD;
    expect(planAdvisorResultStrip(advisorBody, responsesPayload, state)).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('retry bound: a second advisor 400 on the same target does not plan a second strip-retry', () => {
    const state = createAdvisorResultStripState();
    expect(planAdvisorResultStrip(advisorBody, anthropicPayload, state)).toBe(true);
    expect(planAdvisorResultStrip(advisorBody, anthropicPayload, state)).toBe(false);
    expect(state.attempts).toBe(1);
  });

  test('refundAdvisorResultStrip returns the budget after a 0-strip plan, so a later genuine advisor 400 can still strip-retry', () => {
    const state = createAdvisorResultStripState();

    expect(planAdvisorResultStrip(advisorBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);

    refundAdvisorResultStrip(state);
    expect(state.attempts).toBe(0);

    expect(planAdvisorResultStrip(advisorBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('refundAdvisorResultStrip never drives attempts below zero', () => {
    const state = createAdvisorResultStripState();
    refundAdvisorResultStrip(state);
    expect(state.attempts).toBe(0);
  });
});
