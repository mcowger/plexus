import { describe, expect, test } from 'vitest';
import {
  createLiteToolStripState,
  matchLiteUnsupportedToolsError,
  planLiteToolStrip,
  stripLiteUnsupportedTools,
  MAX_LITE_TOOL_STRIP_RETRIES,
} from '../dispatch/dispatcher-auto-compat';
import {
  LITE_MIXED_TOOLS_PAYLOAD,
  LITE_UNSUPPORTED_TOOLS_ERROR_BODY,
} from './dispatcher-auto-compat.fixtures';

describe('matchLiteUnsupportedToolsError', () => {
  test('matches the responses:lite tool-type-restriction 400', () => {
    expect(matchLiteUnsupportedToolsError(LITE_UNSUPPORTED_TOOLS_ERROR_BODY)).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(
      matchLiteUnsupportedToolsError(
        'x-openai-internal-codex-RESPONSES-LITE only supports function tools, custom tools, and client-executed tool search.'
      )
    ).toBe(true);
  });

  test('does not match unrelated 400 bodies', () => {
    expect(matchLiteUnsupportedToolsError('{"error":{"message":"Invalid request"}}')).toBe(false);
  });

  test('does not match the empty string', () => {
    expect(matchLiteUnsupportedToolsError('')).toBe(false);
  });
});

describe('stripLiteUnsupportedTools', () => {
  test('removes tools whose type is not function/custom/tool_search', () => {
    const payload = LITE_MIXED_TOOLS_PAYLOAD;

    const result = stripLiteUnsupportedTools(payload);
    expect(result.strippedCount).toBe(2);
    expect(result.payload.tools).toEqual([
      { type: 'function', name: 'exec_command' },
      { type: 'custom', name: 'apply_patch' },
      { type: 'tool_search' },
    ]);
  });

  test('is a no-op (same payload reference) when there is no tools array', () => {
    const payload = { model: 'gpt-5.6-luna', input: [] };
    const result = stripLiteUnsupportedTools(payload);
    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
  });

  test('is a no-op when every declared tool is already an allowed type', () => {
    const payload = { model: 'gpt-5.6-luna', tools: [{ type: 'function', name: 'exec_command' }] };
    const result = stripLiteUnsupportedTools(payload);
    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
  });

  test('copy-on-write: does not mutate the input payload or its tools array', () => {
    const originalTools = [{ type: 'function', name: 'a' }, { type: 'web_search' }];
    const payload = { model: 'gpt-5.6-luna', tools: originalTools };

    const result = stripLiteUnsupportedTools(payload);

    expect(payload.tools).toBe(originalTools);
    expect(originalTools.length).toBe(2);
    expect(result.payload).not.toBe(payload);
    expect(result.payload.tools).not.toBe(originalTools);
  });
});

describe('planLiteToolStrip', () => {
  const liteToolsErrorBody = LITE_UNSUPPORTED_TOOLS_ERROR_BODY;

  test('MAX_LITE_TOOL_STRIP_RETRIES is exactly 1 (one strip-retry per target)', () => {
    expect(MAX_LITE_TOOL_STRIP_RETRIES).toBe(1);
  });

  test('plans a strip-retry on the first matching 400', () => {
    const state = createLiteToolStripState();
    expect(planLiteToolStrip(liteToolsErrorBody, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('does not plan a retry when the body does not name the restriction', () => {
    const state = createLiteToolStripState();
    expect(planLiteToolStrip('{"error":{"message":"Invalid request"}}', state)).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('retry bound: a second matching 400 on the same target does not plan a second strip-retry', () => {
    const state = createLiteToolStripState();

    expect(planLiteToolStrip(liteToolsErrorBody, state)).toBe(true);
    // The one-per-target bound is already used up — a repeat 400 after the
    // strip means something else is wrong, so normal failover must proceed
    // instead of stripping again.
    expect(planLiteToolStrip(liteToolsErrorBody, state)).toBe(false);
    expect(state.attempts).toBe(1);
  });
});
