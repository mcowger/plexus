/**
 * Tests for enforceContextLimitForRoute — the thin bridge helper that gates a
 * context-shaped request against context-window limits.
 *
 * TDD: these tests were written BEFORE the implementation (RED), then the
 * helper was added to enforce-limits.ts (GREEN).
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@earendil-works/pi-ai';
import type { ModelConfig } from '../../config';
import { ModelMetadataManager } from '../model-metadata-manager';
import {
  ContextLengthExceededError,
  enforceContextLimitForRoute,
  type EnforceRouteInfo,
} from '../enforce-limits';

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

/**
 * Build a Context that reliably exceeds a context window of OVER_WINDOW_SIZE tokens.
 * The window used by the over-limit tests is OVER_WINDOW_SIZE (4200), chosen so that
 * even a ~100-token prompt tips over the limit:
 *   estimateContextTokens ≈ 101 tokens → 101 × 1.1 + 4096 = 4208 > 4200. ✓
 * (Verified with both the tiktoken encoder path and the heuristic fallback.)
 */
const OVER_WINDOW_SIZE = 4200;

function overWindowContext(): Context {
  // 'hello world ' repeated 50× ≈ 101 tokens via o200k_base / heuristic.
  return makeContext('hello world '.repeat(50));
}

// ---------------------------------------------------------------------------
// enforceContextLimitForRoute
// ---------------------------------------------------------------------------

describe('enforceContextLimitForRoute', () => {
  // Reset the ModelMetadataManager singleton so alias metadata retained by an
  // earlier test can't leak into the default gpt-4 fallback path (matches the
  // sibling enforce-limits-context.test.ts).
  beforeEach(() => {
    ModelMetadataManager.resetForTesting();
  });
  afterEach(() => {
    ModelMetadataManager.resetForTesting();
  });

  // Case 1: aliasConfig undefined → no-op
  test('no-ops when aliasConfig is undefined', () => {
    const context = makeContext('hello world');
    const route: EnforceRouteInfo = { canonicalModel: 'some-model' };
    expect(() =>
      enforceContextLimitForRoute(context, route, undefined, undefined, 'chat')
    ).not.toThrow();
  });

  // Case 2: aliasConfig.enforce_limits falsy → no-op
  test('no-ops when enforce_limits is falsy', () => {
    const context = makeContext('hello world');
    const route: EnforceRouteInfo = { canonicalModel: 'some-model' };
    const config = aliasConfig({ enforce_limits: false });
    expect(() =>
      enforceContextLimitForRoute(context, route, config, undefined, 'chat')
    ).not.toThrow();
  });

  test('no-ops when enforce_limits is absent', () => {
    const context = makeContext('hello world');
    const route: EnforceRouteInfo = { canonicalModel: 'some-model' };
    const config = aliasConfig(); // enforce_limits not set
    expect(() =>
      enforceContextLimitForRoute(context, route, config, undefined, 'chat')
    ).not.toThrow();
  });

  // Case 3: route.canonicalModel undefined (even with enforce_limits true) → no-op
  test('no-ops when canonicalModel is undefined', () => {
    const context = makeContext('hello world');
    const route: EnforceRouteInfo = { canonicalModel: undefined };
    const config = aliasConfig({ enforce_limits: true });
    expect(() =>
      enforceContextLimitForRoute(context, route, config, undefined, 'chat')
    ).not.toThrow();
  });

  // Case 4: enforce_limits true + over-window → throws ContextLengthExceededError with statusCode 400
  test('throws ContextLengthExceededError when context exceeds route.modelArchitecture.context_length', () => {
    // Tiny window: OVER_WINDOW_SIZE tokens. No alias metadata → resolveContextLength returns undefined,
    // so the route.modelArchitecture.context_length is used as the contextLength.
    const context = overWindowContext();
    const route: EnforceRouteInfo = {
      canonicalModel: 'test-model',
      modelArchitecture: { context_length: OVER_WINDOW_SIZE },
    };
    // No metadata on aliasConfig → resolveContextLength returns undefined → falls through to route architecture
    const config = aliasConfig({ enforce_limits: true });

    expect(() => enforceContextLimitForRoute(context, route, config, undefined, 'chat')).toThrow(
      ContextLengthExceededError
    );
  });

  test('thrown ContextLengthExceededError has routingContext.statusCode === 400', () => {
    const context = overWindowContext();
    const route: EnforceRouteInfo = {
      canonicalModel: 'test-model',
      modelArchitecture: { context_length: OVER_WINDOW_SIZE },
    };
    const config = aliasConfig({ enforce_limits: true });

    let caught: unknown;
    try {
      enforceContextLimitForRoute(context, route, config, undefined, 'chat');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ContextLengthExceededError);
    const limitErr = caught as ContextLengthExceededError;
    expect(limitErr.routingContext.statusCode).toBe(400);
    expect(limitErr.routingContext.code).toBe('context_length_exceeded');
    expect(limitErr.routingContext.aliasSlug).toBe('test-model');
  });

  // Case 5: enforce_limits true but under the window → no throw
  test('does not throw when context is under the window', () => {
    const contextWindowSize = 50_000;
    const context = makeContext('Short prompt');
    const route: EnforceRouteInfo = {
      canonicalModel: 'test-model',
      modelArchitecture: { context_length: contextWindowSize },
    };
    const config = aliasConfig({ enforce_limits: true });

    expect(() =>
      enforceContextLimitForRoute(context, route, config, undefined, 'chat')
    ).not.toThrow();
  });
});
