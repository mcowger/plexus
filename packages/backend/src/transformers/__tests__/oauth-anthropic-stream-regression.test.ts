import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnthropicTransformer } from '../anthropic';
import { piAiEventToChunk } from '../oauth/type-mappers';

interface ToolCallExpectation {
  id: string;
  arguments: string;
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseTrace(fileName: string): {
  events: any[];
  expectedToolCalls: ToolCallExpectation[];
} {
  const tracePath = new URL(`../../../../../tshooting/${fileName}`, import.meta.url);
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));

  const events = String(trace.rawResponse)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const expectedToolCalls: ToolCallExpectation[] = (trace.rawResponseSnapshot?.tool_calls || [])
    .filter((toolCall: any) => toolCall && toolCall.type === 'function')
    .map((toolCall: any) => ({
      id: toolCall.id,
      arguments: toolCall.function.arguments,
    }));

  return { events, expectedToolCalls };
}

function toReadableStream(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

function parseSse(output: string): Array<{ event: string; data: any }> {
  const records: Array<{ event: string; data: any }> = [];
  let currentEvent = '';

  for (const line of output.split('\n')) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice('event: '.length);
      continue;
    }

    if (line.startsWith('data: ')) {
      records.push({
        event: currentEvent,
        data: JSON.parse(line.slice('data: '.length)),
      });
      currentEvent = '';
    }
  }

  return records;
}

describe('OAuth -> Anthropic stream regression', () => {
  test('piAiEventToChunk handles done events without usage payload', () => {
    const doneEvent = {
      type: 'done',
      reason: 'stop',
      message: {
        role: 'assistant',
        content: [],
      },
    };

    const chunk = piAiEventToChunk(doneEvent as any, 'claude-sonnet-4-6', 'anthropic');

    expect(chunk).toBeDefined();
    expect(chunk?.finish_reason).toBe('stop');
    expect(chunk?.usage?.input_tokens).toBe(0);
    expect(chunk?.usage?.output_tokens).toBe(0);
    expect(chunk?.usage?.total_tokens).toBe(0);
  });

  test('piAiEventToChunk ignores toolcall_end chunks', () => {
    const toolcallEndEvent = {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: {
        id: 'toolu_123',
        name: 'bash',
        arguments: { command: 'ls' },
      },
    };

    const chunk = piAiEventToChunk(toolcallEndEvent as any, 'claude-sonnet-4-6', 'anthropic');
    expect(chunk).toBeNull();
  });

  // Regression for issue #719 (Codex). pi-ai emits a `toolcall_start` (identity)
  // then N `toolcall_delta`s (arg fragments). The OpenAI/Codex streaming contract
  // requires the id + function name to appear EXACTLY ONCE, on the first chunk;
  // repeating them on every delta made clients re-accumulate the name into an
  // over-length string that Codex rejected. This asserts identity lands on the
  // start chunk and every delta is args-only. See toolCallIdentityChannel() in
  // ../oauth/type-mappers.ts for the full cross-provider rationale.
  test('piAiEventToChunk emits tool identity once before argument deltas', () => {
    const partial = {
      content: [
        { type: 'thinking', thinking: 'I should run a command' },
        {
          type: 'toolCall',
          id: 'call_1|fc_1',
          name: 'execute',
          arguments: {},
        },
      ],
    };

    const startChunk = piAiEventToChunk(
      { type: 'toolcall_start', contentIndex: 1, partial } as any,
      'gpt-5.6-sol',
      'openai-codex'
    );
    const firstDelta = piAiEventToChunk(
      {
        type: 'toolcall_delta',
        contentIndex: 1,
        delta: '{\"command\":',
        partial,
      } as any,
      'gpt-5.6-sol',
      'openai-codex'
    );
    const secondDelta = piAiEventToChunk(
      {
        type: 'toolcall_delta',
        contentIndex: 1,
        delta: '\"printf hello\"}',
        partial,
      } as any,
      'gpt-5.6-sol',
      'openai-codex'
    );

    expect(startChunk?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'execute', arguments: '' },
    });
    expect(firstDelta?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      function: { arguments: '{\"command\":' },
    });
    expect(secondDelta?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      function: { arguments: '\"printf hello\"}' },
    });
  });

  // Anthropic uses the SAME 'start' channel as Codex — this is the row that a
  // naive #719 fix broke. anthropic/stream-formatter.ts opens a tool_use block
  // only on a chunk carrying a truthy `tc.id` (`if (!toolCallId) continue;`); if
  // identity never arrives on any chunk, the whole tool call is silently dropped.
  // So Anthropic must get identity on the start chunk (NOT stripped from deltas
  // with nothing to replace it). This guards against regressing back to that.
  test('piAiEventToChunk emits Anthropic tool identity on the start event, args-only on deltas', () => {
    const partial = {
      content: [
        { type: 'thinking', thinking: 'I should list files' },
        { type: 'toolCall', id: 'toolu_123', name: 'bash', arguments: {} },
      ],
    };

    const startChunk = piAiEventToChunk(
      { type: 'toolcall_start', contentIndex: 1, partial } as any,
      'claude-sonnet-4-6',
      'anthropic'
    );
    const delta = piAiEventToChunk(
      { type: 'toolcall_delta', contentIndex: 1, delta: '{"cmd": "ls"}', partial } as any,
      'claude-sonnet-4-6',
      'anthropic'
    );

    // Identity travels on the start chunk so the Anthropic formatter can open the
    // tool_use block (it drops tool calls whose id is missing).
    expect(startChunk?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      id: 'toolu_123',
      type: 'function',
      function: { name: 'bash', arguments: '' },
    });
    // Deltas are args-only so the name is not re-accumulated per chunk.
    expect(delta?.delta.tool_calls?.[0]).toEqual({
      index: 0,
      function: { arguments: '{"cmd": "ls"}' },
    });
  });

  test('piAiEventToChunk uses 0-based sequential indices for tool calls when thinking is present', () => {
    // Simulate a partial message state from pi-ai where:
    // Index 0: thinking block
    // Index 1: toolCall block
    const event: any = {
      type: 'toolcall_delta',
      contentIndex: 1, // The toolCall is the second block in the Anthropic content array
      delta: '{"cmd": "ls"}',
      partial: {
        content: [
          { type: 'thinking', thinking: 'I should list files' },
          { type: 'toolCall', id: 'toolu_123', name: 'bash', arguments: {} },
        ],
      },
    };

    const chunk = piAiEventToChunk(event, 'claude-sonnet-4-6', 'anthropic');

    expect(chunk).toBeDefined();
    expect(chunk!.delta.tool_calls).toBeDefined();
    expect(chunk!.delta.tool_calls).toHaveLength(1);
    const toolCalls = chunk!.delta.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      throw new Error('Expected a tool call payload');
    }

    expect(toolCalls[0]!.index).toBe(0); // MUST be 0 for OpenAI compatibility, even if it's block 1 in Anthropic
    // id and name are intentionally absent on Anthropic DELTAS — they were emitted
    // once on the toolcall_start chunk (see the "start event" test above). This is
    // the 'start' channel contract, NOT a bug: repeating them here would re-trigger
    // the #719 name-accumulation problem. For Gemini the opposite holds (identity
    // lives on the delta); that is covered in oauth-gemini-stream-error-regression.
    expect(toolCalls[0]!.id).toBeUndefined();
    expect(toolCalls[0]!.function?.name).toBeUndefined();
  });
});
