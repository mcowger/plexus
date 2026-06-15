import { describe, it, expect } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import {
  messageToCompletion,
  eventToChunks,
  chunkToSSE,
  makeChunkSerialiserState,
} from '../context-to-openai';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    api: 'openai-completions' as any,
    provider: 'openai' as any,
    model: 'gpt-4',
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

describe('messageToCompletion', () => {
  it('produces a chat.completion with text content', () => {
    const msg = makeMessage();
    const result = messageToCompletion(msg, 'gpt-4');
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('gpt-4');
    expect(result.choices[0]!.message.role).toBe('assistant');
    expect(result.choices[0]!.message.content).toBe('Hello!');
    expect(result.choices[0]!.finish_reason).toBe('stop');
  });

  it('maps toolUse stopReason to tool_calls finish_reason', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c1', name: 'fn', arguments: { a: 1 } } as any],
    });
    const result = messageToCompletion(msg, 'gpt-4');
    expect(result.choices[0]!.finish_reason).toBe('tool_calls');
    expect(result.choices[0]!.message.tool_calls).toHaveLength(1);
    expect(result.choices[0]!.message.tool_calls![0]!.function.name).toBe('fn');
    expect(result.choices[0]!.message.tool_calls![0]!.function.arguments).toBe('{"a":1}');
  });

  it('surfaces errorMessage when stopReason is error', () => {
    const msg = makeMessage({ stopReason: 'error', errorMessage: 'Upstream failed' } as any);
    const result = messageToCompletion(msg, 'gpt-4');
    expect(result.choices[0]!.message.content).toBe('Upstream failed');
    expect(result.choices[0]!.finish_reason).toBe('stop');
  });

  it('includes thinking content as reasoning_content', () => {
    const msg = makeMessage({
      content: [
        { type: 'thinking', thinking: 'I think...' } as any,
        { type: 'text', text: 'Answer' },
      ],
    });
    const result = messageToCompletion(msg, 'gpt-4');
    expect(result.choices[0]!.message.reasoning_content).toBe('I think...');
    expect(result.choices[0]!.message.content).toBe('Answer');
  });

  it('maps usage correctly', () => {
    const msg = makeMessage({
      usage: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const result = messageToCompletion(msg, 'gpt-4');
    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.usage.total_tokens).toBe(150);
    expect(result.usage.prompt_tokens_details?.cached_tokens).toBe(10);
  });

  it('uses provided completionId', () => {
    const msg = makeMessage();
    const result = messageToCompletion(msg, 'gpt-4', 'chatcmpl-custom123');
    expect(result.id).toBe('chatcmpl-custom123');
  });
});

describe('eventToChunks', () => {
  it('start event emits role chunk', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const chunks = eventToChunks({ type: 'start', partial: { content: [] } } as any, state);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.choices[0]!.delta.role).toBe('assistant');
  });

  it('text_delta emits content chunk', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const chunks = eventToChunks({ type: 'text_delta', delta: 'Hello' } as any, state);
    expect(chunks[0]!.choices[0]!.delta.content).toBe('Hello');
  });

  it('thinking_delta emits reasoning_content chunk', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const chunks = eventToChunks({ type: 'thinking_delta', delta: 'Thinking...' } as any, state);
    expect(chunks[0]!.choices[0]!.delta.reasoning_content).toBe('Thinking...');
  });

  it('toolcall_start emits tool_calls chunk with correct index 0', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const partial = {
      content: [{ type: 'toolCall', id: 'c1', name: 'fn', arguments: {} }],
    };
    const chunks = eventToChunks(
      { type: 'toolcall_start', contentIndex: 0, partial } as any,
      state
    );
    expect(chunks[0]!.choices[0]!.delta.tool_calls![0]!.index).toBe(0);
    expect(chunks[0]!.choices[0]!.delta.tool_calls![0]!.function!.name).toBe('fn');
  });

  it('toolcall_start increments index for second tool call', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const partial1 = { content: [{ type: 'toolCall', id: 'c1', name: 'fn1', arguments: {} }] };
    const partial2 = {
      content: [
        { type: 'toolCall', id: 'c1', name: 'fn1', arguments: {} },
        { type: 'toolCall', id: 'c2', name: 'fn2', arguments: {} },
      ],
    };
    eventToChunks({ type: 'toolcall_start', contentIndex: 0, partial: partial1 } as any, state);
    const chunks2 = eventToChunks(
      { type: 'toolcall_start', contentIndex: 1, partial: partial2 } as any,
      state
    );
    expect(chunks2[0]!.choices[0]!.delta.tool_calls![0]!.index).toBe(1);
  });

  it('toolcall_delta emits arguments fragment', () => {
    const state = makeChunkSerialiserState('gpt-4');
    state.toolCallArrayIndex = 0;
    const chunks = eventToChunks({ type: 'toolcall_delta', delta: '{"x":' } as any, state);
    expect(chunks[0]!.choices[0]!.delta.tool_calls![0]!.function!.arguments).toBe('{"x":');
  });

  it('done event emits usage and finish_reason', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const message = makeMessage({ stopReason: 'stop' });
    const chunks = eventToChunks({ type: 'done', reason: 'stop', message } as any, state);
    expect(chunks[0]!.choices[0]!.finish_reason).toBe('stop');
    expect(chunks[0]!.usage).toBeDefined();
  });

  it('unknown event types produce no chunks', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const chunks = eventToChunks({ type: 'text_start' } as any, state);
    expect(chunks).toHaveLength(0);
  });
});

describe('chunkToSSE', () => {
  it('formats chunk as data: ...\\n\\n', () => {
    const state = makeChunkSerialiserState('gpt-4');
    const chunks = eventToChunks({ type: 'text_delta', delta: 'hi' } as any, state);
    const frame = chunkToSSE(chunks[0]!);
    expect(frame).toMatch(/^data: /);
    expect(frame).toMatch(/\n\n$/);
    const payload = JSON.parse(frame.slice('data: '.length));
    expect(payload.choices[0].delta.content).toBe('hi');
  });
});
