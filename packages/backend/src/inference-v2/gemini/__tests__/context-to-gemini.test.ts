import { describe, it, expect } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import {
  messageToGeminiResponse,
  eventToGeminiNDJSON,
  makeGeminiChunkSerialiserState,
} from '../context-to-gemini';

// @earendil-works/pi-ai and utils/logger are globally mocked in test/vitest.setup.ts

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    api: 'google-generative-ai' as any,
    provider: 'google' as any,
    model: 'gemini-2.5-pro',
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

describe('messageToGeminiResponse', () => {
  it('produces correct top-level Gemini response structure', () => {
    const msg = makeMessage();
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates[0]!.content.role).toBe('model');
    expect(result.candidates[0]!.index).toBe(0);
  });

  it('maps text content to text part', () => {
    const msg = makeMessage({ content: [{ type: 'text', text: 'Answer' }] });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    const parts = result.candidates[0]!.content.parts;
    expect(parts).toContainEqual({ text: 'Answer' });
  });

  it('maps thinking content to thought:true part', () => {
    const msg = makeMessage({
      content: [
        { type: 'thinking', thinking: 'Deep thought' } as any,
        { type: 'text', text: 'Answer' },
      ],
    });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    const parts = result.candidates[0]!.content.parts as any[];
    const thinkPart = parts.find((p) => p.thought === true);
    expect(thinkPart?.text).toBe('Deep thought');
  });

  it('maps tool calls to functionCall parts', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c1', name: 'search', arguments: { q: 'cats' } } as any],
    });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    const parts = result.candidates[0]!.content.parts as any[];
    const fcPart = parts.find((p) => p.functionCall);
    expect(fcPart?.functionCall).toMatchObject({ name: 'search', args: { q: 'cats' } });
  });

  it('emits thoughtSignature on functionCall parts when present', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [
        {
          type: 'toolCall',
          id: 'c1',
          name: 'bash',
          arguments: { command: 'ls' },
          thoughtSignature: 'SIG_A',
        } as any,
      ],
    });
    const result = messageToGeminiResponse(msg, 'gemini-3.5-flash');
    const fcPart = (result.candidates[0]!.content.parts as any[]).find((p) => p.functionCall);
    expect(fcPart?.thoughtSignature).toBe('SIG_A');
  });

  it('emits thoughtSignature on thought parts from thinkingSignature', () => {
    const msg = makeMessage({
      content: [{ type: 'thinking', thinking: 'reasoning', thinkingSignature: 'THINK_SIG' } as any],
    });
    const result = messageToGeminiResponse(msg, 'gemini-3.5-flash');
    const thinkPart = (result.candidates[0]!.content.parts as any[]).find(
      (p) => p.thought === true
    );
    expect(thinkPart?.thoughtSignature).toBe('THINK_SIG');
  });

  it('omits thoughtSignature when thinkingSignature is a pi-ai field-name placeholder', () => {
    // Same underlying pi-ai bug as the Anthropic path: thinkingSignature can be
    // left holding the matched JSON field name ("reasoning", "reasoning_content",
    // "reasoning_text") instead of a real signature when the provider's
    // reasoning_details shape isn't recognized. Must not be forwarded as a
    // thoughtSignature.
    const msg = makeMessage({
      content: [{ type: 'thinking', thinking: 'reasoning', thinkingSignature: 'reasoning' } as any],
    });
    const result = messageToGeminiResponse(msg, 'gemini-3.5-flash');
    const thinkPart = (result.candidates[0]!.content.parts as any[]).find(
      (p) => p.thought === true
    );
    expect(thinkPart?.thoughtSignature).toBeUndefined();
  });

  it('emits thoughtSignature on text parts from textSignature', () => {
    const msg = makeMessage({
      content: [{ type: 'text', text: 'answer', textSignature: 'TEXT_SIG' } as any],
    });
    const result = messageToGeminiResponse(msg, 'gemini-3.5-flash');
    const textPart = (result.candidates[0]!.content.parts as any[]).find(
      (p) => p.text && !p.thought
    );
    expect(textPart?.thoughtSignature).toBe('TEXT_SIG');
  });

  it('sets finishReason to STOP for regular stop', () => {
    const msg = makeMessage({ stopReason: 'stop' });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    expect(result.candidates[0]!.finishReason).toBe('STOP');
  });

  it('sets finishReason to STOP for toolUse (Gemini does not use TOOL_CALLS)', () => {
    const msg = makeMessage({
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'c1', name: 'fn', arguments: {} } as any],
    });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    expect(result.candidates[0]!.finishReason).toBe('STOP');
  });

  it('sets finishReason to OTHER for error stopReason', () => {
    const msg = makeMessage({ stopReason: 'error' } as any);
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    expect(result.candidates[0]!.finishReason).toBe('OTHER');
  });

  it('includes usageMetadata', () => {
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
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    expect(result.usageMetadata).toMatchObject({
      promptTokenCount: 110, // input + cacheRead
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
  });

  it('produces an empty text part when content is empty', () => {
    const msg = makeMessage({ content: [] });
    const result = messageToGeminiResponse(msg, 'gemini-2.5-pro');
    const parts = result.candidates[0]!.content.parts;
    expect(parts.length).toBeGreaterThanOrEqual(1);
    // Should have at least an empty text part
    expect(parts[0]).toHaveProperty('text');
  });
});

describe('eventToGeminiNDJSON', () => {
  function parseGeminiDataFrame(frame: string) {
    expect(frame).toMatch(/^data: /);
    expect(frame).toMatch(/\n\n$/);
    return JSON.parse(frame.slice('data: '.length).trim());
  }

  it('start event emits no output', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const lines = eventToGeminiNDJSON({ type: 'start', partial: { content: [] } } as any, state);
    expect(lines).toHaveLength(0);
  });

  it('text_delta emits one data frame with text part', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const lines = eventToGeminiNDJSON({ type: 'text_delta', delta: 'Hello' } as any, state);
    expect(lines).toHaveLength(1);
    const obj = parseGeminiDataFrame(lines[0]!);
    const parts = obj.candidates[0].content.parts;
    expect(parts[0].text).toBe('Hello');
  });

  it('thinking_delta emits one data frame with thought:true part', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const lines = eventToGeminiNDJSON({ type: 'thinking_delta', delta: 'Thinking' } as any, state);
    expect(lines).toHaveLength(1);
    const obj = parseGeminiDataFrame(lines[0]!);
    const part = obj.candidates[0].content.parts[0];
    expect(part.thought).toBe(true);
    expect(part.text).toBe('Thinking');
  });

  it('toolcall_start+delta+end emits one functionCall data frame at end', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const partial = { content: [{ type: 'toolCall', id: 'c1', name: 'search', arguments: {} }] };

    const startLines = eventToGeminiNDJSON(
      { type: 'toolcall_start', contentIndex: 0, partial } as any,
      state
    );
    expect(startLines).toHaveLength(0); // buffering — no output yet

    const deltaLines = eventToGeminiNDJSON(
      { type: 'toolcall_delta', delta: '{"q":"cats"}' } as any,
      state
    );
    expect(deltaLines).toHaveLength(0); // still buffering

    const endLines = eventToGeminiNDJSON({ type: 'toolcall_end' } as any, state);
    expect(endLines).toHaveLength(1);
    const obj = parseGeminiDataFrame(endLines[0]!);
    const fc = obj.candidates[0].content.parts[0].functionCall;
    expect(fc.name).toBe('search');
    expect(fc.args).toEqual({ q: 'cats' });
  });

  it('emits thoughtSignature on the streamed functionCall frame', () => {
    const state = makeGeminiChunkSerialiserState('gemini-3.5-flash');
    // pi-ai attaches thoughtSignature to the ToolCall in the partial at toolcall_start.
    const partial = {
      content: [
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: {}, thoughtSignature: 'STREAM_SIG' },
      ],
    };

    eventToGeminiNDJSON({ type: 'toolcall_start', contentIndex: 0, partial } as any, state);
    eventToGeminiNDJSON({ type: 'toolcall_delta', delta: '{"command":"ls"}' } as any, state);
    const endLines = eventToGeminiNDJSON({ type: 'toolcall_end' } as any, state);

    expect(endLines).toHaveLength(1);
    const obj = parseGeminiDataFrame(endLines[0]!);
    const part = obj.candidates[0].content.parts[0];
    expect(part.functionCall.name).toBe('bash');
    expect(part.thoughtSignature).toBe('STREAM_SIG');
  });

  it('done event emits data frame with usageMetadata and finishReason', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const message = makeMessage({ stopReason: 'stop' });
    const lines = eventToGeminiNDJSON({ type: 'done', reason: 'stop', message } as any, state);
    expect(lines).toHaveLength(1);
    const obj = parseGeminiDataFrame(lines[0]!);
    expect(obj.candidates[0].finishReason).toBe('STOP');
    expect(obj.usageMetadata).toBeDefined();
    expect(obj.usageMetadata.candidatesTokenCount).toBe(5);
  });

  it('each data frame is prefixed with data and ends with a blank line', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const lines = eventToGeminiNDJSON({ type: 'text_delta', delta: 'x' } as any, state);
    expect(lines[0]).toMatch(/^data: /);
    expect(lines[0]).toMatch(/\n\n$/);
  });

  it('error event emits data frame with OTHER finishReason', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    const lines = eventToGeminiNDJSON(
      { type: 'error', error: { errorMessage: 'Upstream error' } } as any,
      state
    );
    expect(lines).toHaveLength(1);
    const obj = parseGeminiDataFrame(lines[0]!);
    expect(obj.candidates[0].finishReason).toBe('OTHER');
  });

  it('text_end, thinking_start, text_start emit no output', () => {
    const state = makeGeminiChunkSerialiserState('gemini-2.5-pro');
    for (const type of ['text_start', 'text_end', 'thinking_start', 'thinking_end']) {
      const lines = eventToGeminiNDJSON({ type } as any, state);
      expect(lines).toHaveLength(0);
    }
  });
});
