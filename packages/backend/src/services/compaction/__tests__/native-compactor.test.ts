import { describe, expect, test } from 'vitest';
import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
} from '@earendil-works/pi-ai';
import { NativeCompactor } from '../native-compactor';
import { COMPACTION_DEFAULTS } from '../types';

const settings = {
  ...COMPACTION_DEFAULTS,
  protectRecent: 1,
  native: { maxArrayItems: 2, maxStringChars: 20 },
};

const ctx = { model: 'test-model' };

// Helper to build a minimal AssistantMessage
function makeAssistantMessage(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function makeUserMessage(content: UserMessage['content']): UserMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

function makeToolResultMessage(content: ToolResultMessage['content']): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'tc-1',
    toolName: 'myTool',
    content,
    isError: false,
    timestamp: Date.now(),
  };
}

describe('NativeCompactor', () => {
  test('1. toolResult with verbose JSON array is truncated with sentinel', async () => {
    const compactor = new NativeCompactor();

    const bigArray = [1, 2, 3, 4, 5];
    const toolResult = makeToolResultMessage([{ type: 'text', text: JSON.stringify(bigArray) }]);
    // put a dummy protected message last
    const protected_ = makeUserMessage('keep me');
    const context: Context = { messages: [toolResult, protected_] };

    const result = await compactor.compact(context, settings, ctx);

    expect(result).toHaveLength(2);
    // protected message unchanged
    expect(result[1]).toBe(protected_);

    // compacted first message: parse the text and check
    const compactedMsg = result[0] as ToolResultMessage;
    const compactedText = (compactedMsg.content[0] as { type: 'text'; text: string }).text;
    const parsed = JSON.parse(compactedText);
    expect(parsed).toHaveLength(3); // 2 items + sentinel
    expect(typeof parsed[2]).toBe('string');
    expect(parsed[2]).toContain('items omitted');
  });

  test('2. protected (most-recent protectRecent) messages returned byte-identical', async () => {
    const compactor = new NativeCompactor();

    const older = makeToolResultMessage([{ type: 'text', text: 'A'.repeat(50) }]);
    const recent = makeUserMessage('recent message');
    const context: Context = { messages: [older, recent] };

    const result = await compactor.compact(context, settings, ctx);

    // recent (index 1) must be the exact same object reference
    expect(result[result.length - 1]).toBe(recent);
    // deep equality too
    expect(result[result.length - 1]).toEqual(recent);
  });

  test('3. user message with long plain-text block is truncated with marker', async () => {
    const compactor = new NativeCompactor();

    const longText = 'A'.repeat(50); // > maxStringChars=20
    const userMsg = makeUserMessage([{ type: 'text', text: longText }]);
    const protected_ = makeUserMessage('keep');
    const context: Context = { messages: [userMsg, protected_] };

    const result = await compactor.compact(context, settings, ctx);

    const compactedMsg = result[0] as UserMessage;
    expect(Array.isArray(compactedMsg.content)).toBe(true);
    const textBlock = (compactedMsg.content as Array<{ type: string; text?: string }>)[0];
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain('truncated');
    expect(textBlock!.text).toContain('30 chars'); // 50-20=30
    expect(textBlock!.text?.startsWith('A'.repeat(20))).toBe(true);
  });

  test('4. user message with string content is handled without crash', async () => {
    const compactor = new NativeCompactor();

    const longString = 'hello world this is a very long string for testing purposes';
    const userMsg = makeUserMessage(longString);
    const protected_ = makeUserMessage('keep');
    const context: Context = { messages: [userMsg, protected_] };

    let result: Context['messages'];
    await expect(async () => {
      result = await compactor.compact(context, settings, ctx);
    }).not.toThrow();

    result = await compactor.compact(context, settings, ctx);
    const compactedMsg = result[0] as UserMessage;
    // string content compacted via compactText
    expect(typeof compactedMsg.content).toBe('string');
    expect((compactedMsg.content as string).length).toBeLessThanOrEqual(
      settings.native.maxStringChars + 50 // marker adds some chars
    );
    expect(compactedMsg.content as string).toContain('truncated');
  });

  test('5. input is NOT mutated', async () => {
    const compactor = new NativeCompactor();

    const bigArray = [1, 2, 3, 4, 5];
    const toolResult = makeToolResultMessage([{ type: 'text', text: JSON.stringify(bigArray) }]);
    const protected_ = makeUserMessage('keep me');
    const originalMessages: Context['messages'] = [toolResult, protected_];
    const originalText = (toolResult.content[0] as { type: 'text'; text: string }).text;

    // Deep-clone snapshots before calling
    const snapshotMessages = JSON.parse(JSON.stringify(originalMessages));

    const context: Context = { messages: originalMessages };
    await compactor.compact(context, settings, ctx);

    // Original array reference still intact
    expect(originalMessages).toHaveLength(2);
    expect(originalMessages[0]).toBe(toolResult);
    // Original nested block text unchanged
    expect((toolResult.content[0] as { type: 'text'; text: string }).text).toBe(originalText);
    // Deep equality to pre-call snapshot
    expect(originalMessages).toEqual(snapshotMessages);
  });

  test('6. assistant toolCall with big-array arguments is compacted; id/name preserved', async () => {
    const compactor = new NativeCompactor();

    const toolCall = {
      type: 'toolCall' as const,
      id: 'call-abc',
      name: 'searchFiles',
      arguments: { paths: ['a', 'b', 'c', 'd', 'e'], limit: 10 },
    };
    const assistantMsg = makeAssistantMessage([toolCall]);
    const protected_ = makeUserMessage('keep');
    const context: Context = { messages: [assistantMsg, protected_] };

    const result = await compactor.compact(context, settings, ctx);

    const compactedMsg = result[0] as AssistantMessage;
    const compactedCall = compactedMsg.content[0] as {
      type: 'toolCall';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(compactedCall.type).toBe('toolCall');
    expect(compactedCall.id).toBe('call-abc');
    expect(compactedCall.name).toBe('searchFiles');
    // paths array was length 5 > maxArrayItems=2, should now be 3 (2 + sentinel)
    expect(Array.isArray(compactedCall.arguments.paths)).toBe(true);
    const paths = compactedCall.arguments.paths as unknown[];
    expect(paths).toHaveLength(3);
    expect(typeof paths[2]).toBe('string');
    expect(paths[2] as string).toContain('items omitted');
    // limit (scalar) preserved
    expect(compactedCall.arguments.limit).toBe(10);
    // arguments object is a new reference (not mutated original)
    expect(compactedCall.arguments).not.toBe(toolCall.arguments);
  });
});
