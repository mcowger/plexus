import { describe, expect, test } from 'bun:test';
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
    expect(toolCalls[0]!.id).toBe('toolu_123');
  });
});
