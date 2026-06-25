import { describe, expect, test, vi } from 'vitest';
import type { Context, UserMessage, AssistantMessage } from '@earendil-works/pi-ai';
import { CompactionService } from '../compaction-service';
import type {
  CompactionResult,
  CompactionSettings,
  CompactionStrategy,
  ResolvedCompactionSettings,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
}

function makeAssistantMsg(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
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

const originalMessages = [makeUserMsg('hello'), makeAssistantMsg('world')];
const compactedMessages = [makeUserMsg('compact')];

const baseContext: Context = { messages: [...originalMessages] };

/** Resolved settings wired for "enabled, threshold will be met by a 9000-token context with 10000 contextLength". */
const enabledSettings: CompactionSettings = {
  enabled: true,
  strategy: 'native',
  triggerRatio: 0.8,
  absoluteTriggerTokens: null,
  minTokens: 2000,
};

/**
 * Build a fake CompactionStrategy whose compact() returns `messages` and
 * records how many times it was called.
 */
function makeFakeStrategy(
  messages: Context['messages'],
  throws?: Error
): CompactionStrategy & { callCount: number } {
  const obj = {
    name: 'native' as const,
    callCount: 0,
    compact: vi.fn(async (_ctx: Context, _settings: ResolvedCompactionSettings, _stratCtx: any) => {
      obj.callCount++;
      if (throws) throw throws;
      return messages;
    }),
  };
  return obj;
}

/**
 * A makeEstimate function that returns values from a queue.
 * Each call pops the first value; last value is repeated if the queue empties.
 */
function makeEstimateQueue(...values: number[]): (ctx: Context) => number {
  const queue = [...values];
  return (_ctx: Context): number => {
    if (queue.length > 1) return queue.shift()!;
    return queue[0]!;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompactionService.maybeCompact', () => {
  test('1. disabled: returns reason=disabled, strategy NOT called', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(5000),
      () => ({ enabled: false })
    );
    const memo = new Map<string, CompactionResult>();

    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.context).toBe(baseContext);
    expect(result.tokensBefore).toBe(0);
    expect(result.tokensAfter).toBe(0);
    expect(result.strategy).toBeNull();
    expect(fakeStrategy.callCount).toBe(0);
  });

  test('2. below-min: estimate < minTokens, strategy NOT called', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(100), // well below minTokens:2000
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('below-min');
    expect(result.context).toBe(baseContext);
    expect(result.tokensBefore).toBe(100);
    expect(result.tokensAfter).toBe(100);
    expect(result.strategy).toBeNull();
    expect(fakeStrategy.callCount).toBe(0);
  });

  test('3. under-threshold: tokens >= minTokens but < triggerRatio*contextLength', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    // triggerRatio=0.8, contextLength=10000 → fire threshold = 8000; estimate = 3000
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(3000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('under-threshold');
    expect(result.context).toBe(baseContext);
    expect(result.tokensBefore).toBe(3000);
    expect(result.tokensAfter).toBe(3000);
    expect(result.strategy).toBeNull();
    expect(fakeStrategy.callCount).toBe(0);
  });

  test('4. compacted (tokens drop): strategy returns compacted messages, tokens drop', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    // before=9000 (>= 8000 threshold), after=3000 → real compaction
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000, 3000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.tokensBefore).toBe(9000);
    expect(result.tokensAfter).toBe(3000);
    expect(result.context).not.toBe(baseContext);
    expect(result.context.messages).toBe(compactedMessages);
    expect(result.strategy).toBe('native');
    expect(fakeStrategy.callCount).toBe(1);
  });

  test('5. no-reduction: tokensAfter >= tokensBefore, reverts to original context', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    // before=9000, after=9500 (tokens grew or no reduction)
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000, 9500),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('no-reduction');
    expect(result.context).toBe(baseContext); // original returned
    expect(result.tokensBefore).toBe(9000);
    expect(result.tokensAfter).toBe(9500);
    expect(result.strategy).toBe('native');
    expect(fakeStrategy.callCount).toBe(1);
  });

  test('6. error (fail-open): strategy throws → reason=error, no rethrow, original context', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages, new Error('strategy exploded'));
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    // Must NOT throw
    const result = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(result.compacted).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.context).toBe(baseContext);
    expect(result.tokensBefore).toBe(9000);
    expect(result.strategy).toBe('native');
  });

  test('6b. error NOT memoized: second call re-invokes strategy', async () => {
    let callCount = 0;
    const throwOnFirst: CompactionStrategy = {
      name: 'native',
      compact: async () => {
        callCount++;
        if (callCount === 1) throw new Error('first call fails');
        return compactedMessages;
      },
    };
    // First call: tokensBefore=9000, then throws (no tokensAfter call)
    // Second call: tokensBefore=9000, tokensAfter=3000
    const estimates = makeEstimateQueue(9000, 9000, 3000);
    const service = new CompactionService(
      { native: throwOnFirst, headroom: throwOnFirst },
      estimates,
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result1 = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );
    expect(result1.reason).toBe('error');

    const result2 = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );
    expect(result2.reason).toBe('ok');
    expect(callCount).toBe(2);
  });

  test('7. memo: same model+contextLength → strategy called only once', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000, 3000, 9000, 3000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    const result1 = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );
    const result2 = await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000 },
      memo
    );

    expect(fakeStrategy.callCount).toBe(1);
    expect(result2).toBe(result1); // exact same object from memo
  });

  test('7b. memo key differentiates model+contextLength', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000, 3000, 9000, 3000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    // Different model → different memo key → strategy called twice
    await service.maybeCompact(baseContext, { model: 'gpt-4', contextLength: 10000 }, memo);
    await service.maybeCompact(baseContext, { model: 'gpt-3.5', contextLength: 10000 }, memo);

    expect(fakeStrategy.callCount).toBe(2);
  });

  test('7c. memo key differentiates provider (failover candidates with different overrides recompute)', async () => {
    const fakeStrategy = makeFakeStrategy(compactedMessages);
    const service = new CompactionService(
      { native: fakeStrategy, headroom: fakeStrategy },
      makeEstimateQueue(9000, 3000, 9000, 3000),
      () => enabledSettings
    );
    const memo = new Map<string, CompactionResult>();

    // Same model+contextLength but different provider → different memo key →
    // strategy recomputes (so a per-provider override is honored on failover).
    await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000, provider: 'openai' },
      memo
    );
    await service.maybeCompact(
      baseContext,
      { model: 'gpt-4', contextLength: 10000, provider: 'azure' },
      memo
    );

    expect(fakeStrategy.callCount).toBe(2);
  });

  test('singleton: getInstance() returns the same instance', () => {
    // We do NOT reset the private static — just verify identity
    const a = CompactionService.getInstance();
    const b = CompactionService.getInstance();
    expect(a).toBe(b);
  });
});
