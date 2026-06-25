/**
 * Tests for compactContextForSend — the executor helper introduced in Task 5.
 *
 * Strategy: mock getConfig (the module at ../../../config, which compaction-service
 * imports as '../../config') so we control alias config + model architecture, then
 * call the real compactContextForSend and assert on the CompactionResult.
 *
 * We also reset CompactionService.instance between tests so each test gets a fresh
 * singleton that picks up the new getConfig mock.
 *
 * Cases:
 *  1. alias compaction:{enabled:false}  → reason='disabled'
 *  2. alias compaction:{enabled:true, minTokens:10_000_000} + small context → reason='below-min'
 *  3. alias compaction:{enabled:true, minTokens:0, triggerRatio:0, strategy:'native', ...}
 *     + context with a long toolResult text → compacted:true (real native strategy)
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { Context, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { RouteResult } from '../../router';

// ---------------------------------------------------------------------------
// Mock getConfig BEFORE importing the module under test so that both the
// compaction-service and resolve-settings pick up the stub on first import.
// ---------------------------------------------------------------------------

const mockGetConfig = vi.fn();

vi.mock('../../../config', () => ({
  getConfig: () => mockGetConfig(),
}));

// Also mock enforce-limits (resolveContextLength uses ModelMetadataManager which
// requires a database / file on disk; we short-circuit by returning undefined, which
// causes compactContextForSend to fall back to route.modelArchitecture?.context_length).
vi.mock('../../enforce-limits', () => ({
  resolveContextLength: (_aliasConfig: unknown) => undefined,
  enforceContextLimitForRoute: () => {},
}));

// Import AFTER mocks are registered
import { compactContextForSend, CompactionService } from '../compaction-service';

// ---------------------------------------------------------------------------
// Reset singleton between tests so each picks up the fresh getConfig mock.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Access and clear the private static instance
  (CompactionService as any).instance = undefined;
  mockGetConfig.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolResultMessage(text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'tc-1',
    toolName: 'myTool',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function makeUserMessage(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
}

function makeRoute(canonicalModel: string, contextLength?: number): RouteResult {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    config: { api_key: 'test-key' } as any,
    modelConfig: {} as any,
    canonicalModel,
    modelArchitecture:
      contextLength != null ? ({ context_length: contextLength } as any) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compactContextForSend', () => {
  test('1. disabled — alias compaction:{enabled:false} → reason=disabled, compacted=false', async () => {
    const canonicalModel = 'gpt-4o';
    mockGetConfig.mockReturnValue({
      models: {
        [canonicalModel]: {
          compaction: { enabled: false },
        },
      },
    });

    const context: Context = { messages: [makeUserMessage('hello')] };
    const route = makeRoute(canonicalModel);
    const memo = new Map();

    const result = await compactContextForSend(context, route, 'my-alias', memo);

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.context).toBe(context);
    expect(result.strategy).toBeNull();
  });

  test('2. below-min — enabled but minTokens very high → reason=below-min, compacted=false', async () => {
    const canonicalModel = 'gpt-4o';
    mockGetConfig.mockReturnValue({
      models: {
        [canonicalModel]: {
          compaction: { enabled: true, minTokens: 10_000_000 },
        },
      },
    });

    const context: Context = { messages: [makeUserMessage('short message')] };
    const route = makeRoute(canonicalModel, 128_000);
    const memo = new Map();

    const result = await compactContextForSend(context, route, 'my-alias', memo);

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('below-min');
    expect(result.context).toBe(context);
    expect(result.tokensBefore).toBeGreaterThan(0); // estimator ran
    expect(result.strategy).toBeNull();
  });

  test('3. native compaction fires — triggerRatio=0, minTokens=0 with a large toolResult', async () => {
    const canonicalModel = 'gpt-4o';
    mockGetConfig.mockReturnValue({
      models: {
        [canonicalModel]: {
          compaction: {
            enabled: true,
            minTokens: 0,
            triggerRatio: 0, // always fire
            protectRecent: 0, // every message eligible (deterministic)
            strategy: 'native',
            native: { maxArrayItems: 1, maxStringChars: 10 },
          },
        },
      },
    });

    // Build a context with a toolResult containing a large JSON array
    // (native compactor will truncate it → tokensAfter < tokensBefore)
    const bigArray = Array.from({ length: 50 }, (_, i) => i);
    const toolResult = makeToolResultMessage(JSON.stringify(bigArray));
    // Put a user message LAST so it is "protected" (protectRecent defaults to 4)
    // but include enough unprotected messages with heavy content
    const heavyMessages = Array.from({ length: 5 }, () =>
      makeToolResultMessage(JSON.stringify(bigArray))
    );
    const context: Context = {
      messages: [...heavyMessages, toolResult, makeUserMessage('final')],
    };
    const route = makeRoute(canonicalModel, 1000);
    const memo = new Map();

    const result = await compactContextForSend(context, route, 'my-alias', memo);

    // protectRecent:0 makes every heavy toolResult eligible, so the real
    // NativeCompactor truncates the big JSON arrays and the estimate drops —
    // a hard end-to-end assertion that compactContextForSend delegates to the
    // native strategy and applies its reduced context.
    expect(result.reason).toBe('ok');
    expect(result.compacted).toBe(true);
    expect(result.strategy).toBe('native');
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.context).not.toBe(context); // a NEW context is returned
  });
});
