import { describe, expect, it } from 'bun:test';

import {
  createEncryptedReasoningStripState,
  planEncryptedReasoningStrip,
  refundEncryptedReasoningStrip,
  stripEncryptedReasoningItems,
} from '../dispatcher-auto-compat';

const PRODUCTION_BODY = JSON.stringify({
  error: {
    message:
      'The encrypted content for item rs_1a0ccd22a0a3e5d2032f537e25630d84 could not be verified. Reason: Encrypted content could not be decrypted or parsed.',
  },
});

const encrypted = (id: string) => ({ type: 'reasoning', id, encrypted_content: 'old' });
const functionCall = (id?: string) => ({
  type: 'function_call',
  ...(id ? { id } : {}),
  call_id: 'call_1',
  name: 'lookup',
  arguments: '{}',
});

function strip(input: unknown[], rejectedId = 'rs_1') {
  return stripEncryptedReasoningItems({ model: 'model-1', input }, rejectedId);
}

describe('planEncryptedReasoningStrip', () => {
  it('extracts the rejected item id from the production error body', () => {
    const state = createEncryptedReasoningStripState();
    expect(planEncryptedReasoningStrip(PRODUCTION_BODY, state)).toBe(
      'rs_1a0ccd22a0a3e5d2032f537e25630d84'
    );
  });

  it('ignores errors that do not name an unverifiable reasoning item', () => {
    const state = createEncryptedReasoningStripState();
    expect(
      planEncryptedReasoningStrip('{"error":{"message":"bad request"}}', state)
    ).toBeUndefined();
    expect(
      planEncryptedReasoningStrip('The encrypted content for item rs_1 is missing.', state)
    ).toBeUndefined();
    expect(state.attempts).toBe(0);
  });

  it('allows one retry per target and restores it on refund', () => {
    const state = createEncryptedReasoningStripState();
    expect(planEncryptedReasoningStrip(PRODUCTION_BODY, state)).toBeDefined();
    expect(planEncryptedReasoningStrip(PRODUCTION_BODY, state)).toBeUndefined();

    refundEncryptedReasoningStrip(state, 'rs_1a0ccd22a0a3e5d2032f537e25630d84');
    expect(state.attempts).toBe(0);
    expect(planEncryptedReasoningStrip(PRODUCTION_BODY, state)).toBeDefined();
  });
});

describe('stripEncryptedReasoningItems', () => {
  it('removes every encrypted reasoning item in one pass and keeps the rest', () => {
    const plain = { type: 'reasoning', id: 'rs_3', summary: [] };
    const result = strip([encrypted('rs_1'), encrypted('rs_2'), plain]);

    expect(result.strippedCount).toBe(2);
    expect(result.payload.input).toEqual([plain]);
  });

  it('does not mutate the input payload', () => {
    const input = [encrypted('rs_1'), functionCall('fc_1')];
    const snapshot = structuredClone(input);

    strip(input);
    expect(input).toEqual(snapshot);
  });

  it('returns the payload untouched when the rejected item is absent', () => {
    const payload = { model: 'model-1', input: [encrypted('rs_other')] };
    const result = stripEncryptedReasoningItems(payload, 'rs_1');

    expect(result.strippedCount).toBe(0);
    expect(result.payload).toBe(payload);
  });

  it('ends the span at a bare shorthand user message', () => {
    const webSearch = { type: 'web_search_call', id: 'ws_1', status: 'completed' };
    const result = strip([
      encrypted('rs_1'),
      functionCall('fc_1'),
      { role: 'user', content: 'next' },
      webSearch,
    ]);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.input).toEqual([
      functionCall(),
      { role: 'user', content: 'next' },
      webSearch,
    ]);
  });

  it('ends the span at a typed user message', () => {
    const webSearch = { type: 'web_search_call', id: 'ws_1', status: 'completed' };
    const result = strip([
      encrypted('rs_1'),
      { type: 'message', role: 'user', content: 'next' },
      webSearch,
    ]);

    expect(result.payload.input).toEqual([
      { type: 'message', role: 'user', content: 'next' },
      webSearch,
    ]);
  });

  it('replays an assistant output message as an id-less input message without output-only fields', () => {
    const result = strip([
      encrypted('rs_1'),
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        phase: 'final_answer',
        status: 'completed',
        content: [
          { type: 'output_text', text: 'Hello, ', annotations: [] },
          { type: 'output_text', text: 'world', annotations: [] },
          { type: 'refusal', refusal: '!' },
        ],
      },
    ]);

    expect(result.payload.input).toEqual([
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: 'Hello, world!',
      },
    ]);
  });

  it('refuses to retry when an assistant message has a part with no text form', () => {
    const result = strip([
      encrypted('rs_1'),
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'a' }, { type: 'output_image' }],
      },
    ]);

    expect(result.strippedCount).toBe(0);
  });

  it.each([
    ['computer_call_output', { call_id: 'call_1', output: { type: 'computer_screenshot' } }],
    ['mcp_approval_response', { approval_request_id: 'mcpr_1', approve: true }],
    ['shell_call_output', { call_id: 'call_1', output: [] }],
    ['apply_patch_call_output', { call_id: 'call_1', status: 'completed' }],
    ['additional_tools', { role: 'developer', tools: [] }],
    ['configuration_update', { reasoning: { effort: 'low' } }],
    ['compaction', { encrypted_content: 'opaque' }],
    ['compaction_trigger', {}],
  ])('detaches the optional id of %s and keeps its other fields', (type, fields) => {
    const result = strip([encrypted('rs_1'), { type, id: 'x_1', ...fields }]);

    expect(result.strippedCount).toBe(1);
    expect(result.payload.input).toEqual([{ type, ...fields }]);
  });

  it.each(['web_search_call', 'local_shell_call', 'mcp_list_tools', 'constructor'])(
    'refuses to retry when %s requires its id',
    (type) => {
      const result = strip([encrypted('rs_1'), { type, id: 'x_1' }]);

      expect(result.strippedCount).toBe(0);
    }
  );

  it('refuses to retry when an item_reference names a detached item', () => {
    const result = strip([
      encrypted('rs_1'),
      functionCall('fc_1'),
      { type: 'item_reference', id: 'fc_1' },
    ]);

    expect(result.strippedCount).toBe(0);
  });

  it('refuses to retry when a typeless reference names a removed reasoning item', () => {
    const result = strip([encrypted('rs_1'), { id: 'rs_1' }]);

    expect(result.strippedCount).toBe(0);
  });

  it('keeps references to items the retry does not touch', () => {
    const reference = { type: 'item_reference', id: 'msg_other' };
    const result = strip([reference, encrypted('rs_1'), functionCall('fc_1')]);

    expect(result.payload.input).toEqual([reference, functionCall()]);
  });
});
