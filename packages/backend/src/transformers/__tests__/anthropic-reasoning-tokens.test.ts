import { describe, it, expect } from 'vitest';
import { AnthropicTransformer } from '../anthropic';
import { transformAnthropicResponse } from '../anthropic/response-transformer';
import { transformAnthropicStream } from '../anthropic/stream-transformer';
import { formatAnthropicResponse } from '../anthropic/response-formatter';
import { anthropicReasoningTokens, normalizeAnthropicUsage } from '../../utils/usage-normalizer';
import { extractUsageFromReconstructed } from '../../services/inspectors/usage-logging';

/**
 * Anthropic reports thinking usage under
 * `usage.output_tokens_details.thinking_tokens`. Every Anthropic usage reader
 * in Plexus used to look elsewhere (`usage.thinkingTokens`, or nothing at
 * all), so the recorded reasoning count for every real Anthropic request was 0
 * however much the model thought — invisible in the dashboard and excluded
 * from cost.
 *
 * The fixture below is a verbatim `usage` object from a live
 * claude-fable-5-1 response with adaptive thinking at effort xhigh.
 */
const LIVE_USAGE = {
  input_tokens: 79,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  output_tokens: 61,
  output_tokens_details: { thinking_tokens: 56 },
  service_tier: 'standard',
  inference_geo: 'global',
};

describe('anthropicReasoningTokens', () => {
  it("reads Anthropic's output_tokens_details.thinking_tokens", () => {
    expect(anthropicReasoningTokens(LIVE_USAGE)).toBe(56);
  });

  it("falls back to Plexus's flat thinkingTokens (Plexus-fronting-Plexus)", () => {
    expect(anthropicReasoningTokens({ output_tokens: 10, thinkingTokens: 7 })).toBe(7);
  });

  it('prefers the provider field when both are present', () => {
    expect(
      anthropicReasoningTokens({ output_tokens_details: { thinking_tokens: 5 }, thinkingTokens: 9 })
    ).toBe(5);
  });

  it('returns 0 when neither is present or usage is missing', () => {
    expect(anthropicReasoningTokens({ output_tokens: 10 })).toBe(0);
    expect(anthropicReasoningTokens(undefined)).toBe(0);
    expect(anthropicReasoningTokens({ output_tokens_details: {} })).toBe(0);
  });
});

describe('normalizeAnthropicUsage — reasoning tokens', () => {
  it('no longer hard-codes reasoning_tokens to 0', () => {
    const n = normalizeAnthropicUsage(LIVE_USAGE);
    expect(n.reasoning_tokens).toBe(56);
    expect(n.output_tokens).toBe(61);
    expect(n.input_tokens).toBe(79);
  });

  it('feeds the usage record for a same-format messages pass-through', () => {
    // This is the path the dashboard's `reason` column comes from for
    // messages -> messages traffic (usage-logging.ts -> normalizeAnthropicUsage).
    const observed = extractUsageFromReconstructed({ usage: LIVE_USAGE }, 'messages');
    expect(observed?.reasoningTokens).toBe(56);
  });
});

describe('AnthropicTransformer.extractUsage — reasoning tokens', () => {
  const t = new AnthropicTransformer();

  it('reads thinking_tokens from a final message_delta', () => {
    const usage = t.extractUsage(
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: LIVE_USAGE,
      })
    );
    expect(usage?.reasoning_tokens).toBe(56);
    expect(usage?.output_tokens).toBe(61);
  });

  it('reads thinking_tokens from message_start', () => {
    const usage = t.extractUsage(
      JSON.stringify({
        type: 'message_start',
        message: { usage: { ...LIVE_USAGE, output_tokens: 1 } },
      })
    );
    expect(usage?.reasoning_tokens).toBe(56);
  });

  it('still accepts the legacy flat thinkingTokens field', () => {
    const usage = t.extractUsage(
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 7, output_tokens: 325, thinkingTokens: 695 },
      })
    );
    expect(usage?.reasoning_tokens).toBe(695);
  });
});

describe('transformAnthropicResponse — reasoning tokens', () => {
  it('uses the reported thinking count and splits output_tokens accordingly', async () => {
    const unified = await transformAnthropicResponse({
      id: 'msg_1',
      model: 'claude-fable-5-1',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'Working it through…', signature: 'sig' },
        { type: 'text', text: '1.23' },
      ],
      usage: LIVE_USAGE,
    });

    expect(unified.usage?.reasoning_tokens).toBe(56);
    // output_tokens (61) already includes thinking; the visible share is the rest.
    expect(unified.usage?.output_tokens).toBe(5);
    expect(unified.usage?.total_tokens).toBe(79 + 61);
  });

  it('falls back to imputation when the upstream returns thinking text but no count', async () => {
    const unified = await transformAnthropicResponse({
      id: 'msg_2',
      model: 'some-compatible-model',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'a'.repeat(400) },
        { type: 'text', text: 'ok' },
      ],
      usage: { input_tokens: 10, output_tokens: 120 },
    });

    expect(unified.usage?.reasoning_tokens).toBeGreaterThan(0);
    expect((unified.usage?.output_tokens ?? 0) + (unified.usage?.reasoning_tokens ?? 0)).toBe(120);
  });

  it('reports 0 reasoning and untouched output when there was no thinking', async () => {
    const unified = await transformAnthropicResponse({
      id: 'msg_3',
      model: 'claude-fable-5-1',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { ...LIVE_USAGE, output_tokens: 4, output_tokens_details: { thinking_tokens: 0 } },
    });

    expect(unified.usage?.reasoning_tokens).toBe(0);
    expect(unified.usage?.output_tokens).toBe(4);
  });
});

describe('transformAnthropicStream — reasoning tokens', () => {
  async function runStream(events: Array<[string, any]>) {
    const encoder = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        for (const [event, data] of events) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        controller.close();
      },
    });
    // The unified stream yields already-parsed chunk objects.
    const reader = transformAnthropicStream(source).getReader();
    const chunks: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  it('reads thinking_tokens from the final message_delta', async () => {
    const chunks = await runStream([
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'msg_s',
            model: 'claude-fable-5-1',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 79, output_tokens: 1, cache_read_input_tokens: 0 },
          },
        },
      ],
      [
        'content_block_start',
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Working…' },
        },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'content_block_start',
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '1.23' } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      [
        'message_delta',
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: LIVE_USAGE,
        },
      ],
      ['message_stop', { type: 'message_stop' }],
    ]);

    const withUsage = chunks.filter((c) => c.usage);
    const final = withUsage[withUsage.length - 1];
    expect(final.usage.reasoning_tokens).toBe(56);
    expect(final.usage.output_tokens).toBe(5);
  });
});

describe('formatAnthropicResponse — reasoning tokens on the wire', () => {
  it("emits Anthropic's output_tokens_details.thinking_tokens and keeps thinkingTokens", async () => {
    const out = await formatAnthropicResponse({
      id: 'msg_1',
      model: 'claude-fable-5-1',
      content: '1.23',
      reasoning_content: 'Working it through…',
      finishReason: 'end_turn',
      usage: {
        input_tokens: 79,
        output_tokens: 5,
        total_tokens: 140,
        reasoning_tokens: 56,
        cached_tokens: 0,
        cache_creation_tokens: 0,
      },
    } as any);

    expect(out.usage.output_tokens_details).toEqual({ thinking_tokens: 56 });
    expect(out.usage.thinkingTokens).toBe(56);
    // Round-trips: what Plexus emits is what Plexus (or Anthropic tooling) can read back.
    expect(anthropicReasoningTokens(out.usage)).toBe(56);
  });
});
