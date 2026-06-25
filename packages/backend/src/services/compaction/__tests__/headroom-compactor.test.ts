/**
 * headroom-compactor.test.ts
 *
 * TDD tests for HeadroomCompactor — all tests inject a fake compressFn,
 * so no real headroom-ai server is ever contacted.
 */
import { describe, expect, test, vi } from 'vitest';
import type {
  Context,
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai';
import type { CompressResult } from 'headroom-ai';
import { HeadroomCompactor, toOpenAI, fromOpenAI } from '../headroom-compactor';
import { COMPACTION_DEFAULTS } from '../types';
import type { CompactionStrategyContext } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makeAssistantMsg(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-4o',
    usage: makeUsage(),
    stopReason: 'stop',
    timestamp: 1000,
    ...overrides,
  };
}

function makeUserMsg(content: UserMessage['content']): UserMessage {
  return { role: 'user', content, timestamp: 1000 };
}

function makeToolResultMsg(overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'search',
    content: [{ type: 'text', text: 'result text' }],
    isError: false,
    timestamp: 1000,
    ...overrides,
  };
}

/** Minimal CompressResult that echoes the input messages back. */
function echoResult(messages: any[]): CompressResult {
  return {
    messages,
    tokensBefore: 100,
    tokensAfter: 80,
    tokensSaved: 20,
    compressionRatio: 0.8,
    transformsApplied: [],
    ccrHashes: [],
    compressed: true,
  };
}

const baseSettings = {
  ...COMPACTION_DEFAULTS,
  headroom: {
    baseUrl: 'http://localhost:8787',
    apiKey: 'test-key',
    targetRatio: null,
    timeoutMs: 5000,
  },
};

const baseCtx: CompactionStrategyContext = {
  model: 'gpt-4o',
  contextLength: 10000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeadroomCompactor', () => {
  // 1. Forward mapping
  describe('1. forward mapping — pi-ai → OpenAI shapes sent to compressFn', () => {
    test('user text, assistant with toolCall, toolResult map to correct OpenAI shapes', async () => {
      const capturedArgs: { messages: any[]; options: any } = { messages: [], options: {} };
      const fakeFn = vi.fn(async (messages: any[], options: any) => {
        capturedArgs.messages = messages;
        capturedArgs.options = options;
        return echoResult(messages);
      });

      const context: Context = {
        messages: [
          makeUserMsg('hello world'),
          makeAssistantMsg({
            content: [
              { type: 'text', text: 'I will search' },
              { type: 'toolCall', id: 'call_1', name: 'search', arguments: { q: 'test' } },
            ],
          }),
          makeToolResultMsg({
            toolCallId: 'call_1',
            toolName: 'search',
            content: [{ type: 'text', text: 'result text' }],
          }),
        ],
      };

      const compactor = new HeadroomCompactor(fakeFn);
      await compactor.compact(context, baseSettings, baseCtx);

      expect(fakeFn).toHaveBeenCalledOnce();

      const [userMsg, assistantMsg, toolMsg] = capturedArgs.messages;

      // User message
      expect(userMsg).toEqual({ role: 'user', content: 'hello world' });

      // Assistant message: text joined, tool_calls array
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('I will search');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls[0]).toEqual({
        id: 'call_1',
        type: 'function',
        function: { name: 'search', arguments: JSON.stringify({ q: 'test' }) },
      });

      // Tool result message
      expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'result text' });
    });

    test('options carry model, baseUrl, numeric tokenBudget (10000-4096=5904), and timeout', async () => {
      const capturedOptions: any = {};
      const fakeFn = vi.fn(async (messages: any[], options: any) => {
        Object.assign(capturedOptions, options);
        return echoResult(messages);
      });

      const context: Context = { messages: [makeUserMsg('hi')] };
      const compactor = new HeadroomCompactor(fakeFn);
      await compactor.compact(context, baseSettings, baseCtx);

      expect(capturedOptions.model).toBe('gpt-4o');
      expect(capturedOptions.baseUrl).toBe('http://localhost:8787');
      expect(capturedOptions.tokenBudget).toBe(5904); // 10000 - 4096
      expect(typeof capturedOptions.tokenBudget).toBe('number');
      expect(capturedOptions.timeout).toBe(5000);
      // Must NOT have a signal or targetRatio field
      expect(capturedOptions).not.toHaveProperty('signal');
      expect(capturedOptions).not.toHaveProperty('targetRatio');
    });

    test('options include the caller abort signal when provided', async () => {
      const controller = new AbortController();
      const capturedOptions: any = {};
      const fakeFn = vi.fn(async (messages: any[], options: any) => {
        Object.assign(capturedOptions, options);
        return echoResult(messages);
      });

      const context: Context = { messages: [makeUserMsg('hi')] };
      const compactor = new HeadroomCompactor(fakeFn);
      await compactor.compact(context, baseSettings, { ...baseCtx, signal: controller.signal });

      expect(capturedOptions.signal).toBe(controller.signal);
    });
  });

  // 2. Reverse mapping
  describe('2. reverse mapping — OpenAI output → pi-ai shapes', () => {
    test('toolName restored via toolNameById; assistant maps back with required fields', async () => {
      // compressFn returns compacted OpenAI messages
      const compressedOpenAI = [
        { role: 'tool', tool_call_id: 'call_1', content: 'compacted' },
        {
          role: 'assistant',
          content: 'hi',
          tool_calls: [
            { id: 'call_2', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
          ],
        },
      ];
      const fakeFn = vi.fn(async () => echoResult(compressedOpenAI));

      // Original context has toolCall id=call_1 (name='search') and id=call_2 (name='f')
      const context: Context = {
        messages: [
          makeAssistantMsg({
            content: [
              { type: 'toolCall', id: 'call_1', name: 'search', arguments: {} },
              { type: 'toolCall', id: 'call_2', name: 'f', arguments: {} },
            ],
          }),
          makeToolResultMsg({ toolCallId: 'call_1', toolName: 'search' }),
        ],
      };

      const compactor = new HeadroomCompactor(fakeFn);
      const result = await compactor.compact(context, baseSettings, baseCtx);

      expect(result).toHaveLength(2);

      // toolResult: role, toolCallId, toolName (restored), content, isError, timestamp
      const tr = result[0] as ToolResultMessage;
      expect(tr.role).toBe('toolResult');
      expect(tr.toolCallId).toBe('call_1');
      expect(tr.toolName).toBe('search'); // restored from toolNameById
      expect(tr.content).toEqual([{ type: 'text', text: 'compacted' }]);
      expect(tr.isError).toBe(false);
      expect(tr.timestamp).toBe(0);

      // assistant: role, content (TextContent + ToolCall), api/provider/model/usage/stopReason/timestamp
      const am = result[1] as AssistantMessage;
      expect(am.role).toBe('assistant');
      expect(am.content).toContainEqual({ type: 'text', text: 'hi' });
      expect(am.content).toContainEqual({
        type: 'toolCall',
        id: 'call_2',
        name: 'f',
        arguments: { a: 1 },
      });
      expect(am.api).toBeDefined();
      expect(am.provider).toBeDefined();
      expect(am.model).toBeDefined();
      expect(am.usage).toBeDefined();
      expect(am.stopReason).toBe('stop');
      expect(am.timestamp).toBe(0);
    });

    test('assistantTemplate taken from first AssistantMessage in original context', async () => {
      const compressedOpenAI = [{ role: 'assistant', content: 'hello', tool_calls: undefined }];
      const fakeFn = vi.fn(async () => echoResult(compressedOpenAI));

      const context: Context = {
        messages: [
          makeAssistantMsg({
            api: 'anthropic-messages',
            provider: 'anthropic',
            model: 'claude-3-5-sonnet',
            content: [{ type: 'text', text: 'hi' }],
          }),
        ],
      };

      const compactor = new HeadroomCompactor(fakeFn);
      const result = await compactor.compact(context, baseSettings, baseCtx);
      const am = result[0] as AssistantMessage;

      expect(am.api).toBe('anthropic-messages');
      expect(am.provider).toBe('anthropic');
      expect(am.model).toBe('claude-3-5-sonnet');
    });

    test('image content round-trips through data URI encoding', async () => {
      const userWithImage: UserMessage = {
        role: 'user',
        content: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
        timestamp: 0,
      };
      const openaiOut = toOpenAI(userWithImage);
      expect(openaiOut).toEqual({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }],
      });

      // Round-trip back
      const backMsg = fromOpenAI(openaiOut, new Map(), {
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
      });
      expect(backMsg.role).toBe('user');
      const um = backMsg as UserMessage;
      expect(um.content).toEqual([{ type: 'image', data: 'abc123', mimeType: 'image/png' }]);
    });
  });

  // 3. Error propagation
  describe('3. error propagation', () => {
    test('compressFn throw causes compact() to reject', async () => {
      const boom = new Error('network fail');
      const fakeFn = vi.fn(async () => {
        throw boom;
      });
      const context: Context = { messages: [makeUserMsg('hi')] };
      const compactor = new HeadroomCompactor(fakeFn);
      await expect(compactor.compact(context, baseSettings, baseCtx)).rejects.toThrow(
        'network fail'
      );
    });

    test.each([
      ['array', '[]'],
      ['null', 'null'],
      ['string', '"oops"'],
    ])('non-object tool-call arguments from headroom output reject: %s', async (_name, args) => {
      const compressedOpenAI = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: args } },
          ],
        },
      ];
      const fakeFn = vi.fn(async () => echoResult(compressedOpenAI));
      const context: Context = {
        messages: [
          makeAssistantMsg({
            content: [{ type: 'toolCall', id: 'call_1', name: 'search', arguments: {} }],
          }),
        ],
      };
      const compactor = new HeadroomCompactor(fakeFn);

      await expect(compactor.compact(context, baseSettings, baseCtx)).rejects.toThrow(
        'invalid tool arguments'
      );
    });
  });

  // 4. targetRatio path
  describe('4. targetRatio overrides tokenBudget when set', () => {
    test('targetRatio=0.5, contextLength=10000 → tokenBudget=5000', async () => {
      const capturedOptions: any = {};
      const fakeFn = vi.fn(async (messages: any[], options: any) => {
        Object.assign(capturedOptions, options);
        return echoResult(messages);
      });

      const settingsWithRatio = {
        ...baseSettings,
        headroom: { ...baseSettings.headroom, targetRatio: 0.5 },
      };

      const context: Context = { messages: [makeUserMsg('hi')] };
      const compactor = new HeadroomCompactor(fakeFn);
      await compactor.compact(context, settingsWithRatio, baseCtx);

      expect(capturedOptions.tokenBudget).toBe(5000); // floor(10000 * 0.5)
    });

    test('no contextLength → tokenBudget is undefined', async () => {
      const capturedOptions: any = {};
      const fakeFn = vi.fn(async (messages: any[], options: any) => {
        Object.assign(capturedOptions, options);
        return echoResult(messages);
      });

      const context: Context = { messages: [makeUserMsg('hi')] };
      const compactor = new HeadroomCompactor(fakeFn);
      await compactor.compact(context, baseSettings, { model: 'gpt-4o' }); // no contextLength

      expect(capturedOptions.tokenBudget).toBeUndefined();
    });
  });

  // 5. toOpenAI edge cases (unit tests for the exported pure function)
  describe('5. toOpenAI edge cases', () => {
    test('assistant with only thinking blocks → content:null, no tool_calls', () => {
      const msg = makeAssistantMsg({
        content: [{ type: 'thinking', thinking: 'some deep thought' }],
      });
      const result = toOpenAI(msg);
      expect(result).toEqual({ role: 'assistant', content: null });
    });

    test('assistant with no content blocks → content:null', () => {
      const msg = makeAssistantMsg({ content: [] });
      const result = toOpenAI(msg);
      expect(result).toEqual({ role: 'assistant', content: null });
    });

    test('user with array content maps text and image blocks', () => {
      const msg: UserMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
        ],
        timestamp: 0,
      };
      const result = toOpenAI(msg);
      expect(result).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } },
        ],
      });
    });
  });
});
