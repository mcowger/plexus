import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ModelConfig } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { ContextLengthExceededError, enforceContextLimit } from '../enforce-limits';
import { ModelMetadataManager } from '../model-metadata-manager';

function makeRequest(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  const messages = overrides.messages ?? [{ role: 'user' as const, content: 'hi there' }];
  const originalBody = overrides.originalBody ?? { messages };
  return {
    messages,
    model: 'test-alias',
    incomingApiType: 'chat',
    originalBody,
    ...overrides,
  } as UnifiedChatRequest;
}

function bigMessages(charCount: number): UnifiedChatRequest['messages'] {
  return [{ role: 'user' as const, content: 'x'.repeat(charCount) }];
}

function aliasConfig(partial: Partial<ModelConfig> = {}): ModelConfig {
  return {
    targets: [{ provider: 'openai', model: 'gpt-4' }],
    priority: 'selector',
    ...partial,
  } as ModelConfig;
}

describe('enforceContextLimit', () => {
  beforeEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  afterEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  test('passes through when estimated input fits within context - reserved output', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 10_000,
          top_provider: { context_length: 10_000, max_completion_tokens: 4096 },
        },
      },
    });
    const req = makeRequest({ messages: bigMessages(200) }); // ~50 tokens
    expect(() => enforceContextLimit(req, config, 'test-alias')).not.toThrow();
  });

  test('throws ContextLengthExceededError when estimated input + reservation exceeds limit', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
          top_provider: { context_length: 1_000, max_completion_tokens: 256 },
        },
      },
    });
    // ~10,000 chars ≈ ~2,500 tokens, well over a 1000-token context.
    const req = makeRequest({ messages: bigMessages(10_000) });
    let caught: unknown;
    try {
      enforceContextLimit(req, config, 'test-alias');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContextLengthExceededError);
    const err = caught as ContextLengthExceededError;
    expect(err.routingContext.statusCode).toBe(400);
    expect(err.routingContext.code).toBe('context_length_exceeded');
    expect(err.routingContext.contextLength).toBe(1_000);
    expect(err.routingContext.aliasSlug).toBe('test-alias');
    expect(err.routingContext.reservedOutputTokens).toBe(256);
    expect(err.message).toContain('1000');
  });

  test('fails open with no throw when context_length is unknown', () => {
    const config = aliasConfig({
      enforce_limits: true,
      // No metadata at all.
    });
    const req = makeRequest({ messages: bigMessages(10_000) });
    expect(() => enforceContextLimit(req, config, 'test-alias')).not.toThrow();
  });

  test('fails open when metadata exists but lacks context_length', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          // no context_length / top_provider.context_length
          top_provider: { max_completion_tokens: 4096 },
        },
      },
    });
    const req = makeRequest({ messages: bigMessages(10_000) });
    expect(() => enforceContextLimit(req, config, 'test-alias')).not.toThrow();
  });

  test('uses request.max_tokens reservation when smaller than metadata max_completion_tokens', () => {
    // Small max_tokens leaves more budget for input; request that would be
    // rejected with max_completion_tokens=8000 reservation should pass with
    // max_tokens=10 reservation.
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 10_000,
          top_provider: { context_length: 10_000, max_completion_tokens: 8_000 },
        },
      },
    });
    // ~6000 chars ≈ ~1500 tokens, * 1.1 = ~1650.
    // With reservation 8000 → 9650 < 10000, still passes. Use bigger input:
    const msgs = bigMessages(24_000); // ~6000 tokens * 1.1 = ~6600
    const withMetadataReservation = makeRequest({
      messages: msgs,
      originalBody: { messages: msgs },
    });
    // With max_completion_tokens=8000 reservation: 6600 + 8000 = 14600 > 10000 → reject
    expect(() => enforceContextLimit(withMetadataReservation, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );

    // Same input, but caller requested max_tokens=10 → reservation becomes 10 → 6600 + 10 < 10000 → pass
    const withSmallMaxTokens = makeRequest({
      messages: msgs,
      max_tokens: 10,
      originalBody: { messages: msgs, max_tokens: 10 },
    });
    expect(() => enforceContextLimit(withSmallMaxTokens, config, 'test-alias')).not.toThrow();
  });

  test('uses metadata max_completion_tokens when request.max_tokens is larger', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 10_000,
          top_provider: { context_length: 10_000, max_completion_tokens: 500 },
        },
      },
    });
    const msgs = bigMessages(32_000); // ~8000 tokens * 1.1 = ~8800
    // With reservation=500 (metadata min): 8800 + 500 = 9300 < 10000 → pass
    // With reservation=9999 (requested): 8800 + 9999 > 10000 → reject
    // We use min(request, metadata) so it should pass.
    const req = makeRequest({
      messages: msgs,
      max_tokens: 9999,
      originalBody: { messages: msgs, max_tokens: 9999 },
    });
    expect(() => enforceContextLimit(req, config, 'test-alias')).not.toThrow();
  });

  test('prefers top_provider.context_length over root context_length', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 100_000, // broad
          top_provider: { context_length: 1_000 }, // per-deployment narrower
        },
      },
    });
    const req = makeRequest({ messages: bigMessages(10_000) }); // ~2500 tokens
    expect(() => enforceContextLimit(req, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );
  });

  test('falls back to root context_length when top_provider is absent', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
        },
      },
    });
    const req = makeRequest({ messages: bigMessages(10_000) });
    expect(() => enforceContextLimit(req, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );
  });

  test('works for anthropic messages API shape', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
        },
      },
    });
    const longText = 'x'.repeat(10_000);
    const req = makeRequest({
      incomingApiType: 'messages',
      messages: [{ role: 'user', content: longText }],
      originalBody: {
        messages: [{ role: 'user', content: longText }],
        system: 'You are a helpful assistant.',
      },
    });
    expect(() => enforceContextLimit(req, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );
  });

  test('works for gemini API shape', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
        },
      },
    });
    const req = makeRequest({
      incomingApiType: 'gemini',
      messages: [{ role: 'user', content: 'x' }],
      originalBody: {
        contents: [{ role: 'user', parts: [{ text: 'x'.repeat(10_000) }] }],
      },
    });
    expect(() => enforceContextLimit(req, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );
  });

  test('works for responses API shape (string input)', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
        },
      },
    });
    const req = makeRequest({
      incomingApiType: 'responses',
      messages: [{ role: 'user', content: 'x' }],
      originalBody: {
        input: 'x'.repeat(10_000),
      },
    });
    expect(() => enforceContextLimit(req, config, 'test-alias')).toThrow(
      ContextLengthExceededError
    );
  });

  test('returns error message with estimated tokens and context length', () => {
    const config = aliasConfig({
      enforce_limits: true,
      metadata: {
        source: 'custom',
        overrides: {
          name: 'Test',
          context_length: 1_000,
          top_provider: { context_length: 1_000, max_completion_tokens: 256 },
        },
      },
    });
    const req = makeRequest({ messages: bigMessages(10_000) });
    try {
      enforceContextLimit(req, config, 'my-alias');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ContextLengthExceededError;
      expect(err.message).toMatch(/context window is 1000 tokens/);
      expect(err.message).toMatch(/input tokens/);
    }
  });
});
