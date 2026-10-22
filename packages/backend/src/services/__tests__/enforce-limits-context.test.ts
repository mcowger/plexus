import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Context } from '@earendil-works/pi-ai';

import type { ModelConfig } from '../../config';
import {
  ContextLengthExceededError,
  enforceContextLimitForContext,
  resolveContextLength,
} from '../models/enforce-limits';
import { ModelMetadataManager } from '../models/model-metadata-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aliasConfig(partial: Partial<ModelConfig> = {}): ModelConfig {
  return {
    targets: [{ provider: 'openai', model: 'gpt-4' }],
    priority: 'selector',
    ...partial,
  } as ModelConfig;
}

/** Build a minimal pi-ai Context with a single user text message. */
function makeContext(text: string): Context {
  return {
    messages: [
      {
        role: 'user' as const,
        content: text,
        timestamp: Date.now(),
      },
    ],
  };
}

/** Build a Context with a large user message (~charCount chars). */
function bigContext(charCount: number): Context {
  return makeContext('x'.repeat(charCount));
}

// ---------------------------------------------------------------------------
// resolveContextLength
// ---------------------------------------------------------------------------

describe('resolveContextLength', () => {
  beforeEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  afterEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  test('returns undefined when aliasConfig has no metadata', () => {
    const config = aliasConfig(); // no metadata
    expect(resolveContextLength(config)).toBeUndefined();
  });

  test('prefers top_provider.context_length over root context_length', () => {
    // top_provider.context_length = 4000, root context_length = 8000 → should return 4000
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 8_000,
          top_provider: { context_length: 4_000 },
        },
      },
    });
    expect(resolveContextLength(config)).toBe(4_000);
  });

  test('falls back to root context_length when top_provider is absent', () => {
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 8_000,
        },
      },
    });
    expect(resolveContextLength(config)).toBe(8_000);
  });

  test('returns undefined when context_length is 0 or missing', () => {
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          top_provider: { max_completion_tokens: 4096 },
          // no context_length
        },
      },
    });
    expect(resolveContextLength(config)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceContextLimitForContext
// ---------------------------------------------------------------------------

describe('enforceContextLimitForContext', () => {
  beforeEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  afterEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  // --- over-window: throws ContextLengthExceededError ---

  test('throws ContextLengthExceededError when estimate + reserved exceeds contextLength', () => {
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 100, // small window passed via metadata (but we also pass via opts below)
          top_provider: { context_length: 100, max_completion_tokens: 50 },
        },
      },
    });
    // ~4000 chars ≈ ~1000 raw tokens * 1.1 = ~1100; way over 100-token window
    const context = bigContext(4_000);
    let caught: unknown;
    try {
      enforceContextLimitForContext(context, config, 'test-alias');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContextLengthExceededError);
    const err = caught as ContextLengthExceededError;
    expect(err.routingContext.statusCode).toBe(400);
    expect(err.routingContext.code).toBe('context_length_exceeded');
    expect(err.routingContext.contextLength).toBe(100);
    expect(err.routingContext.aliasSlug).toBe('test-alias');
    expect(err.routingContext.estimatedInputTokens).toBeGreaterThan(0);
    expect(err.routingContext.reservedOutputTokens).toBeGreaterThan(0);
    expect(err.message).toContain('100');
    expect(err.message).toContain('input tokens');
  });

  test('throws via opts.contextLength without relying on metadata', () => {
    // Pass contextLength directly through opts — no metadata needed
    const config = aliasConfig(); // no metadata
    // ~4000 chars ≈ ~1000 raw tokens * 1.1 = ~1100; over a 200-token window
    const context = bigContext(4_000);
    expect(() =>
      enforceContextLimitForContext(context, config, 'test-alias-opts', {
        contextLength: 200,
      })
    ).toThrow(ContextLengthExceededError);
  });

  // --- under-window: does not throw ---

  test('returns without throwing when estimate fits within context window', () => {
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 10_000,
          top_provider: { context_length: 10_000, max_completion_tokens: 4096 },
        },
      },
    });
    // ~200 chars ≈ ~50 tokens * 1.1 = ~55; fits in 10000-token window
    const context = bigContext(200);
    expect(() => enforceContextLimitForContext(context, config, 'test-alias')).not.toThrow();
  });

  test('returns without throwing via opts.contextLength (under window)', () => {
    const config = aliasConfig();
    const context = bigContext(200);
    expect(() =>
      enforceContextLimitForContext(context, config, 'test-alias', {
        contextLength: 10_000,
      })
    ).not.toThrow();
  });

  // --- fail-open: no context length known ---

  test('fails open (no throw) when no context_length is known', () => {
    const config = aliasConfig(); // no metadata, no opts.contextLength
    // Even a huge context should not throw when we can't enforce
    const context = bigContext(100_000);
    expect(() => enforceContextLimitForContext(context, config, 'test-alias')).not.toThrow();
  });

  test('fails open when metadata exists but has no context_length', () => {
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          top_provider: { max_completion_tokens: 4096 },
          // no context_length or top_provider.context_length
        },
      },
    });
    const context = bigContext(100_000);
    expect(() => enforceContextLimitForContext(context, config, 'test-alias')).not.toThrow();
  });

  // --- reserved-output: opts.maxTokens smaller than metadata max_completion_tokens ---

  test('uses opts.maxTokens when smaller than metadata max_completion_tokens', () => {
    // We set up a case where:
    //   estimate * 1.1 + metadata_max (8000) > contextLength (10000) → would throw
    //   estimate * 1.1 + small maxTokens (10) <= contextLength (10000) → passes
    // ~24000 chars ≈ ~6000 raw tokens * 1.1 = ~6600
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 10_000,
          top_provider: { context_length: 10_000, max_completion_tokens: 8_000 },
        },
      },
    });
    const context = bigContext(24_000);

    // Without small maxTokens: 6600 + 8000 = 14600 > 10000 → throws
    expect(() => enforceContextLimitForContext(context, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );

    // With maxTokens=10: reservation = min(10, 8000) = 10 → 6600 + 10 < 10000 → passes
    expect(() =>
      enforceContextLimitForContext(context, config, 'test-alias', { maxTokens: 10 })
    ).not.toThrow();
  });

  test('reserved-output: asserts reservedOutputTokens in thrown error matches min(maxTokens, metadataMax)', () => {
    // Use opts.contextLength=100 (tiny window) so that estimate + 300 reservation
    // clearly exceeds the window. Metadata has max_completion_tokens=1000 so the
    // effective reservation is min(300, 1000) = 300, which should appear in the error.
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          top_provider: { max_completion_tokens: 1000 },
        },
      },
    });
    // 'hello' → ~1 raw token * 1.1 ≈ 2 estimated; 2 + 300 = 302 > 100 → throws
    const context = makeContext('hello');

    // With maxTokens=300 (smaller than 1000): reservation = min(300, 1000) = 300
    // 2 + 300 > 100 → throws; reservedOutputTokens should be 300
    let caught: unknown;
    try {
      enforceContextLimitForContext(context, config, 'test-alias', {
        contextLength: 100,
        maxTokens: 300,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContextLengthExceededError);
    const err = caught as ContextLengthExceededError;
    expect(err.routingContext.reservedOutputTokens).toBe(300);
  });

  test('uses DEFAULT_OUTPUT_RESERVATION (4096) when neither opts.maxTokens nor metadata max_completion_tokens is set', () => {
    // contextLength=100 so even 4096 reservation causes a throw (100 << 4096+estimate)
    const config = aliasConfig({
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 100,
          top_provider: { context_length: 100 }, // no max_completion_tokens
        },
      },
    });
    const context = makeContext('hello'); // tiny input
    let caught: unknown;
    try {
      enforceContextLimitForContext(context, config, 'test-alias');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContextLengthExceededError);
    const err = caught as ContextLengthExceededError;
    // DEFAULT_OUTPUT_RESERVATION = 4096
    expect(err.routingContext.reservedOutputTokens).toBe(4096);
  });
});
