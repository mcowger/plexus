import { describe, it, expect } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import {
  messageToResponsesObject,
  eventToResponsesSSE,
  makeResponsesChunkSerialiserState,
} from '../context-to-responses';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    api: 'openai-responses' as any,
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

describe('messageToResponsesObject', () => {
  it('produces a response object with correct top-level shape', () => {
    const msg = makeMessage();
    const result = messageToResponsesObject(msg, 'gpt-4');
    expect(result.object).toBe('response');
    expect(result.status).toBe('completed');
    expect(result.model).toBe('gpt-4');
    expect(Array.isArray(result.output)).toBe(true);
  });

  it('includes a message output item with text', () => {
    const msg = makeMessage({ content: [{ type: 'text', text: 'Answer' }] });
    const result = messageToResponsesObject(msg, 'gpt-4');
    const output = result.output as any[];
    const msgItem = output.find((o: any) => o.type === 'message');
    expect(msgItem).toBeDefined();
    expect(msgItem!.content[0].text).toBe('Answer');
  });

  it('includes function_call output items for tool calls', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c1', name: 'search', arguments: { q: 'cats' } } as any],
    });
    const result = messageToResponsesObject(msg, 'gpt-4');
    const output = result.output as any[];
    const fcItem = output.find((o: any) => o.type === 'function_call');
    expect(fcItem).toBeDefined();
    expect(fcItem!.name).toBe('search');
    expect(fcItem!.call_id).toBe('c1');
    expect(JSON.parse(fcItem!.arguments)).toEqual({ q: 'cats' });
  });

  it('includes reasoning item when wantsSummary is true and thinking present', () => {
    const msg = makeMessage({
      content: [
        { type: 'thinking', thinking: 'Deep thought' } as any,
        { type: 'text', text: 'Answer' },
      ],
    });
    const result = messageToResponsesObject(msg, 'gpt-4', undefined, true);
    const output = result.output as any[];
    const reasoningItem = output.find((o: any) => o.type === 'reasoning');
    expect(reasoningItem).toBeDefined();
  });

  it('omits reasoning item when wantsSummary is false', () => {
    const msg = makeMessage({
      content: [
        { type: 'thinking', thinking: 'Deep thought' } as any,
        { type: 'text', text: 'Answer' },
      ],
    });
    const result = messageToResponsesObject(msg, 'gpt-4', undefined, false);
    const output = result.output as any[];
    const reasoningItem = output.find((o: any) => o.type === 'reasoning');
    expect(reasoningItem).toBeUndefined();
  });

  it('maps usage correctly', () => {
    const msg = makeMessage({
      usage: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 5,
        totalTokens: 150,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const result = messageToResponsesObject(msg, 'gpt-4');
    const usage = result.usage as any;
    expect(usage.input_tokens).toBe(115); // input + cacheRead + cacheWrite
    expect(usage.output_tokens).toBe(50);
    expect(usage.total_tokens).toBe(150);
  });

  it('uses provided responseId', () => {
    const msg = makeMessage();
    const result = messageToResponsesObject(msg, 'gpt-4', 'resp_custom');
    expect(result.id).toBe('resp_custom');
  });

  it('surfaces errorMessage on error stopReason', () => {
    const msg = makeMessage({ stopReason: 'error', errorMessage: 'Bad upstream' } as any);
    const result = messageToResponsesObject(msg, 'gpt-4');
    const output = result.output as any[];
    const msgItem = output.find((o: any) => o.type === 'message');
    expect(msgItem!.content[0].text).toBe('Bad upstream');
  });
});

describe('eventToResponsesSSE', () => {
  it('start event emits response.created and response.in_progress frames', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    const frames = eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    const all = frames.join('\n');
    expect(all).toContain('response.created');
    expect(all).toContain('response.in_progress');
  });

  it('text_delta emits output_item.added on first delta, then output_text.delta', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    const frames = eventToResponsesSSE({ type: 'text_delta', delta: 'Hi' } as any, state);
    const all = frames.join('\n');
    expect(all).toContain('response.output_item.added');
    expect(all).toContain('response.output_text.delta');
    expect(all).toContain('Hi');
  });

  it('subsequent text_delta only emits output_text.delta (no duplicate output_item.added)', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    eventToResponsesSSE({ type: 'text_delta', delta: 'Hello' } as any, state);
    const frames2 = eventToResponsesSSE({ type: 'text_delta', delta: ' world' } as any, state);
    const all2 = frames2.join('\n');
    expect(all2).not.toContain('response.output_item.added');
    expect(all2).toContain('response.output_text.delta');
  });

  it('done event emits response.completed', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    const message = makeMessage({ stopReason: 'stop' });
    const frames = eventToResponsesSSE({ type: 'done', reason: 'stop', message } as any, state);
    expect(frames.join('\n')).toContain('response.completed');
  });

  it('thinking_delta emits reasoning events', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    const frames = eventToResponsesSSE({ type: 'thinking_delta', delta: 'Thought' } as any, state);
    expect(frames.join('\n')).toContain('reasoning');
  });

  it('SSE frames contain data: lines', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    const frames = eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    // Each frame may contain event: and data: lines; verify at least one data: line exists
    const allLines = frames.join('\n').split('\n');
    expect(allLines.some((l) => l.startsWith('data: '))).toBe(true);
  });

  it('sequence numbers are monotonically increasing', () => {
    const state = makeResponsesChunkSerialiserState('gpt-4');
    eventToResponsesSSE({ type: 'start', partial: { content: [] } } as any, state);
    const frames1 = eventToResponsesSSE({ type: 'text_delta', delta: 'A' } as any, state);
    const frames2 = eventToResponsesSSE({ type: 'text_delta', delta: 'B' } as any, state);
    const seqs: number[] = [];
    for (const frame of [...frames1, ...frames2]) {
      try {
        const payload = JSON.parse(frame.replace('data: ', ''));
        if (typeof payload.sequence_number === 'number') seqs.push(payload.sequence_number);
      } catch {
        // ignore non-JSON lines
      }
    }
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });
});
