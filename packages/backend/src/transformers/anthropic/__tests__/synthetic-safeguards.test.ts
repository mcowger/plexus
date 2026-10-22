import { describe, expect, it } from 'bun:test';

import { formatAnthropicStream } from '../stream-formatter';
import {
  buildSyntheticSafeguardResults,
  collectStreamToolIds,
  collectUnifiedToolIds,
  getRequestedSafeguardTypes,
  shouldSynthesizeSafeguards,
  SYNTHETIC_SAFEGUARD_EXPLANATION,
  wrapUnifiedStreamWithSyntheticSafeguards,
} from '../synthetic-safeguards';

function safeguardsBody() {
  return {
    model: 'luna-alias',
    messages: [{ role: 'user', content: 'hi' }],
    safeguards: [{ type: 'dangerous_tool_use', classifier_context: { v: 1 } }],
  };
}

async function drain(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof value === 'string') text += value;
    else text += decoder.decode(value as Uint8Array, { stream: true });
  }
  return text;
}

function chunk(data: unknown): unknown {
  return data;
}

describe('synthetic safeguards', () => {
  it('reads requested safeguard types only from a safeguards array', () => {
    expect(getRequestedSafeguardTypes(safeguardsBody())).toEqual(['dangerous_tool_use']);
    expect(getRequestedSafeguardTypes({ model: 'x' })).toEqual([]);
    expect(getRequestedSafeguardTypes(null)).toEqual([]);
  });

  it('builds evaluated/not_flagged verdicts with the synthetic explanation', () => {
    const results = buildSyntheticSafeguardResults(['toolu_a', 'toolu_b'], ['dangerous_tool_use']);
    expect(results).toHaveLength(1);
    const status = (
      results[0] as {
        status: {
          type: string;
          tool_uses: Record<string, { type: string; outcome: string; explanation: string }>;
        };
      }
    ).status;
    expect(status.type).toBe('available');
    expect(status.tool_uses['toolu_a']).toMatchObject({
      type: 'evaluated',
      outcome: 'not_flagged',
      explanation: SYNTHETIC_SAFEGUARD_EXPLANATION,
    });
    expect(status.tool_uses['toolu_b']?.outcome).toBe('not_flagged');
  });

  it('emits an empty tool_uses map for turns without tool calls', () => {
    const results = buildSyntheticSafeguardResults([], ['dangerous_tool_use']);
    expect((results[0] as { status: { tool_uses: object } }).status.tool_uses).toEqual({});
  });

  it('collects unified and stream tool ids without duplicates', () => {
    expect(collectUnifiedToolIds([{ id: 'a' }, { id: 'a' }, { id: '' }])).toEqual(['a']);
    expect(
      collectStreamToolIds([
        { delta: { tool_calls: [{ id: 'a' }] } },
        { delta: { tool_calls: [{ id: 'b' }] } },
      ])
    ).toEqual(['a', 'b']);
  });

  it('gates synthesis on messages ingress, toggle, translation target, and request safeguards', () => {
    const base = {
      incomingApiType: 'messages',
      originalBody: safeguardsBody(),
      aliasToggle: true,
      outgoingApiType: 'responses',
      bypassTransformation: false,
      hasClientError: false,
      hasExistingResults: false,
    };
    expect(shouldSynthesizeSafeguards(base)).toBe(true);
    expect(shouldSynthesizeSafeguards({ ...base, aliasToggle: false })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, originalBody: { model: 'x' } })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: 'messages' })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, bypassTransformation: true })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, hasClientError: true })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, hasExistingResults: true })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, incomingApiType: 'chat' })).toBe(false);
  });

  it('refuses synthesis when the outgoing target type is missing, blank, or native', () => {
    const base = {
      incomingApiType: 'messages',
      originalBody: safeguardsBody(),
      aliasToggle: true,
      bypassTransformation: false,
      hasClientError: false,
      hasExistingResults: false,
    };
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: undefined })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: '' })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: '   ' })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: null })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: 'MESSAGES' })).toBe(false);
    expect(shouldSynthesizeSafeguards({ ...base, outgoingApiType: 'responses:lite' })).toBe(true);
  });

  it('never overwrites an early real verdict with a synthetic terminal injection', async () => {
    const real = buildSyntheticSafeguardResults(['toolu_a'], ['dangerous_tool_use']);
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(
          chunk({
            id: 'm',
            model: 'luna',
            created: 1,
            delta: { tool_calls: [{ id: 'toolu_a' }] },
            safeguard_results: real,
          })
        );
        controller.enqueue(
          chunk({ id: 'm', model: 'luna', created: 1, delta: {}, finish_reason: 'tool_calls' })
        );
        controller.close();
      },
    });
    const wrapped = wrapUnifiedStreamWithSyntheticSafeguards(source, ['dangerous_tool_use']);
    const reader = wrapped.getReader();
    const seen: Array<{ safeguard_results?: unknown }> = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(value as { safeguard_results?: unknown });
    }
    expect(seen).toHaveLength(2);
    // Early real verdict passes through untouched.
    expect(seen[0]!.safeguard_results).toEqual(real);
    // Terminal chunk must not gain a synthetic verdict once a real one was seen.
    expect(seen[1]!.safeguard_results).toBeUndefined();
  });

  it('keeps the first-seen (real) verdict when a later synthetic chunk arrives', async () => {
    const real = buildSyntheticSafeguardResults(['toolu_a'], ['dangerous_tool_use']);
    const synthetic = buildSyntheticSafeguardResults(['toolu_a'], ['dangerous_tool_use']);
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(
          chunk({
            id: 'm',
            model: 'luna',
            created: 1,
            delta: { tool_calls: [{ id: 'toolu_a' }] },
            safeguard_results: real,
          })
        );
        controller.enqueue(
          chunk({
            id: 'm',
            model: 'luna',
            created: 1,
            delta: {},
            finish_reason: 'tool_calls',
            safeguard_results: synthetic,
          })
        );
        controller.close();
      },
    });
    const text = await drain(formatAnthropicStream(source));
    const deltaLine = text
      .split('\n')
      .find((line) => line.startsWith('data: ') && line.includes('message_delta'));
    expect(deltaLine).toBeDefined();
    const delta = JSON.parse(deltaLine!.slice('data: '.length));
    expect(delta.delta.safeguard_results).toEqual(real);
  });

  it('attaches the synthetic verdict to the terminal unified chunk', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(
          chunk({ id: 'm', model: 'luna', created: 1, delta: { tool_calls: [{ id: 'toolu_x' }] } })
        );
        controller.enqueue(
          chunk({ id: 'm', model: 'luna', created: 1, delta: {}, finish_reason: 'tool_calls' })
        );
        controller.close();
      },
    });
    const wrapped = wrapUnifiedStreamWithSyntheticSafeguards(source, ['dangerous_tool_use']);
    const reader = wrapped.getReader();
    const seen: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(value);
    }
    const terminal = seen[seen.length - 1] as { safeguard_results: unknown };
    expect(terminal.safeguard_results).toBeDefined();
  });

  it('emits safeguard_results inside the Anthropic message_delta', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(
          chunk({ id: 'm', model: 'luna', created: 1, delta: { role: 'assistant' } })
        );
        controller.enqueue(
          chunk({
            id: 'm',
            model: 'luna',
            created: 1,
            delta: {},
            finish_reason: 'tool_calls',
            safeguard_results: buildSyntheticSafeguardResults(['toolu_x'], ['dangerous_tool_use']),
          })
        );
        controller.close();
      },
    });
    const text = await drain(formatAnthropicStream(source));
    const deltaLine = text
      .split('\n')
      .find((line) => line.startsWith('data: ') && line.includes('message_delta'));
    expect(deltaLine).toBeDefined();
    const delta = JSON.parse(deltaLine!.slice('data: '.length));
    expect(delta.delta.safeguard_results[0].status.tool_uses['toolu_x']).toMatchObject({
      type: 'evaluated',
      outcome: 'not_flagged',
      explanation: SYNTHETIC_SAFEGUARD_EXPLANATION,
    });
  });
});
