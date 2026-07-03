import { describe, it, expect } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import {
  messageToAnthropicResponse,
  eventToAnthropicSSE,
  makeAnthropicChunkSerialiserState,
} from '../context-to-anthropic';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    api: 'anthropic-messages' as any,
    provider: 'anthropic' as any,
    model: 'claude-opus-4-6',
    stopReason: 'stop',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
    ...overrides,
  } as AssistantMessage;
}

describe('messageToAnthropicResponse', () => {
  it('produces a message object with correct structure', () => {
    const msg = makeMessage();
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.stop_sequence).toBeNull();
  });

  it('maps stop reason correctly', () => {
    const msg = makeMessage({ stopReason: 'stop' });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('maps toolUse stop reason to tool_use', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c1', name: 'fn', arguments: { x: 1 } } as any],
    });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    expect(result.stop_reason).toBe('tool_use');
  });

  it('includes text content block', () => {
    const msg = makeMessage({ content: [{ type: 'text', text: 'Answer' }] });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    const textBlock = result.content.find((b: any) => b.type === 'text');
    expect(textBlock).toMatchObject({ type: 'text', text: 'Answer' });
  });

  it('includes thinking block', () => {
    const msg = makeMessage({
      content: [
        { type: 'thinking', thinking: 'Deep thought' } as any,
        { type: 'text', text: 'Conclusion' },
      ],
    });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    const thinkBlock = result.content.find((b) => b.type === 'thinking') as
      | { type: 'thinking'; thinking: string }
      | undefined;
    expect(thinkBlock?.thinking).toBe('Deep thought');
  });

  it('includes tool_use content block', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'toolu_1', name: 'search', arguments: { q: 'hi' } } as any],
    });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    const toolBlock = result.content.find((b) => b.type === 'tool_use') as
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | undefined;
    expect(toolBlock).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'search' });
    expect(toolBlock?.input).toEqual({ q: 'hi' });
  });

  it('maps usage to Anthropic shape', () => {
    const msg = makeMessage({
      usage: {
        input: 100,
        output: 50,
        cacheRead: 20,
        cacheWrite: 5,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    expect(result.usage.input_tokens).toBe(100);
    expect(result.usage.output_tokens).toBe(50);
    expect(result.usage.cache_read_input_tokens).toBe(20);
    expect(result.usage.cache_creation_input_tokens).toBe(5);
  });

  it('surfaces errorMessage as text content when stopReason is error', () => {
    const msg = makeMessage({ stopReason: 'error', errorMessage: 'Upstream failed' } as any);
    const result = messageToAnthropicResponse(msg, 'claude-opus-4-6');
    const textBlock = result.content.find((b) => b.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(textBlock?.text).toBe('Upstream failed');
  });
});

describe('eventToAnthropicSSE', () => {
  it('start event alone defers message_start (no usage known yet)', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    const frames = eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    expect(frames.some((f) => f.includes('message_start'))).toBe(false);
    expect(state.pendingStart).toBe(true);
  });

  it('REGRESSION: message_start usage reflects the real usage from the first content event, not the zeroed usage on "start"', () => {
    // Reproduces the bug from debug trace 216ce9bf-bdd9-4bc9-9806-14eb345faecd:
    // pi-ai emits 'start' before reading any upstream bytes, so partial.usage is
    // always {input:0, output:0, cacheRead:0, cacheWrite:0} at that point. The
    // real usage (e.g. cache_read_input_tokens from a cached system prompt) only
    // lands in partial.usage once the upstream message_start SSE has been
    // processed — which happens before the *next* pi-ai event. The old code sent
    // message_start immediately on 'start' and permanently lost that usage.
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');

    // 'start' fires with zero usage, exactly like the real upstream stream.
    const startFrames = eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    expect(startFrames.some((f) => f.includes('message_start'))).toBe(false);

    // The next event (thinking_start) carries the real usage merged in by pi-ai
    // after processing the upstream message_start event.
    const realUsage = {
      input: 2,
      output: 7,
      cacheRead: 8441,
      cacheWrite: 0,
      totalTokens: 8450,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const thinkingStartFrames = eventToAnthropicSSE(
      {
        type: 'thinking_start',
        contentIndex: 0,
        partial: {
          content: [{ type: 'thinking', thinking: '', thinkingSignature: '' }],
          usage: realUsage,
        },
      } as any,
      state
    );

    const messageStartFrame = thinkingStartFrames.find((f) => f.includes('message_start'));
    expect(messageStartFrame).toBeDefined();
    const data = JSON.parse(messageStartFrame!.split('\ndata: ')[1]!);
    expect(data.message.usage.input_tokens).toBe(2);
    expect(data.message.usage.output_tokens).toBe(7);
    expect(data.message.usage.cache_read_input_tokens).toBe(8441);
  });

  it('emits signature_delta for a thinking block before content_block_stop', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    eventToAnthropicSSE(
      {
        type: 'thinking_start',
        contentIndex: 0,
        partial: {
          content: [{ type: 'thinking', thinking: '', thinkingSignature: '' }],
          usage: zeroUsage(),
        },
      } as any,
      state
    );
    eventToAnthropicSSE(
      {
        type: 'thinking_delta',
        contentIndex: 0,
        delta: 'Hmm',
        partial: { content: [], usage: zeroUsage() },
      } as any,
      state
    );
    // Closing the thinking block (by starting a text block) should emit the
    // accumulated signature before content_block_stop.
    const frames = eventToAnthropicSSE(
      {
        type: 'text_start',
        contentIndex: 1,
        partial: {
          content: [
            { type: 'thinking', thinking: 'Hmm', thinkingSignature: 'sig-abc' },
            { type: 'text', text: '' },
          ],
          usage: zeroUsage(),
        },
      } as any,
      state
    );
    const allFrames = frames.join('\n---\n');
    const sigIndex = allFrames.indexOf('signature_delta');
    const stopIndex = allFrames.indexOf('content_block_stop');
    expect(sigIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(-1);
    expect(sigIndex).toBeLessThan(stopIndex);
    expect(allFrames).toContain('sig-abc');
  });

  it('message_delta on done includes full usage breakdown, not just output_tokens', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const message = makeMessage({
      stopReason: 'toolUse',
      usage: {
        input: 2,
        output: 81,
        cacheRead: 8441,
        cacheWrite: 0,
        totalTokens: 8524,
        reasoning: 23,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      } as any,
    });
    const frames = eventToAnthropicSSE({ type: 'done', reason: 'toolUse', message } as any, state);
    const deltaFrame = frames.find((f) => f.includes('message_delta'))!;
    const data = JSON.parse(deltaFrame.split('\ndata: ')[1]!);
    expect(data.usage.input_tokens).toBe(2);
    expect(data.usage.output_tokens).toBe(81);
    expect(data.usage.cache_read_input_tokens).toBe(8441);
    expect(data.usage.output_tokens_details.thinking_tokens).toBe(23);
  });

  it('text_delta emits content_block_start + content_block_delta', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    // Trigger start first
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const frames = eventToAnthropicSSE(
      {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
        partial: { content: [], usage: zeroUsage() },
      } as any,
      state
    );
    const allFrames = frames.join('\n');
    expect(allFrames).toContain('text_delta');
    expect(allFrames).toContain('Hello');
  });

  it('thinking_delta emits thinking block delta', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const frames = eventToAnthropicSSE(
      {
        type: 'thinking_delta',
        contentIndex: 0,
        delta: 'Thinking...',
        partial: {
          content: [{ type: 'thinking', thinking: 'Thinking...', thinkingSignature: '' }],
          usage: zeroUsage(),
        },
      } as any,
      state
    );
    const allFrames = frames.join('\n');
    expect(allFrames).toContain('thinking');
    expect(allFrames).toContain('Thinking...');
  });

  it('toolcall_start emits tool_use block start', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const partial = {
      content: [{ type: 'toolCall', id: 'c1', name: 'fn', arguments: {} }],
      usage: zeroUsage(),
    };
    const frames = eventToAnthropicSSE(
      { type: 'toolcall_start', contentIndex: 0, partial } as any,
      state
    );
    expect(frames.join('\n')).toContain('tool_use');
  });

  it('done event emits message_delta and message_stop', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const message = makeMessage({ stopReason: 'stop' });
    const frames = eventToAnthropicSSE({ type: 'done', reason: 'stop', message } as any, state);
    const allFrames = frames.join('\n');
    expect(allFrames).toContain('message_delta');
    expect(allFrames).toContain('message_stop');
  });

  it('SSE frames start with "event: " or "data: "', () => {
    const state = makeAnthropicChunkSerialiserState('claude-opus-4-6');
    eventToAnthropicSSE(
      { type: 'start', partial: { content: [], usage: zeroUsage() } } as any,
      state
    );
    const frames = eventToAnthropicSSE(
      {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hi',
        partial: { content: [], usage: zeroUsage() },
      } as any,
      state
    );
    for (const frame of frames) {
      // Each frame is event:/data: lines separated by \n
      const lines = frame.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        expect(line).toMatch(/^(event:|data:)/);
      }
    }
  });
});
