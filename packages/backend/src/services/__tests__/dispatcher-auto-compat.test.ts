import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Dispatcher } from '../dispatch/dispatcher';
import * as piAiRegistry from '../pi-ai/registry';
import type { RouteResult } from '../routing/router';
import type { UnifiedChatRequest } from '../../types/unified';
import {
  createUnsupportedParamStripState,
  deleteDottedPath,
  matchUnsupportedParameter,
  planUnsupportedParamStrip,
  MAX_UNSUPPORTED_PARAM_STRIP_RETRIES,
  createThinkingSignatureStripState,
  isAnthropicMessagesPayload,
  matchThinkingSignatureError,
  planThinkingSignatureStrip,
  stripThinkingSignatureBlocks,
  MAX_THINKING_SIGNATURE_STRIP_RETRIES,
} from '../dispatch/dispatcher-auto-compat';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    provider: 'test-provider',
    model: 'provider-model',
    config: {
      api_base_url: 'https://example.test/v1',
      api_key: 'test-key',
      auto_compat: true,
      pi_ai_provider: 'openai',
    } as any,
    modelConfig: {
      pricing: { source: 'simple', input: 0, output: 0 },
      pi_ai_model_id: 'registry-model',
    } as any,
    ...overrides,
  };
}

function request(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'alias-model',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    ...overrides,
  };
}

function piModel(overrides: Record<string, any> = {}) {
  return {
    id: 'registry-model',
    provider: 'openai',
    api: 'openai-completions',
    reasoning: true,
    thinkingLevelMap: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { supportsReasoningEffort: true, supportsTemperature: true },
    maxTokens: 4096,
    ...overrides,
  } as any;
}

describe('Dispatcher registry auto-compat', () => {
  beforeEach(() => {
    registerSpy(piAiRegistry, 'resolvePiAiModel').mockReturnValue(piModel());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('applies registry reasoning fields on the passthrough path', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'medium',
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.bypassTransformation).toBe(true);
    expect(result.payload.model).toBe('provider-model');
    expect(result.payload.reasoning_effort).toBe('medium');
  });

  test('applies registry reasoning fields on the transformed Anthropic path', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        api: 'anthropic-messages',
        provider: 'anthropic',
        compat: { supportsTemperature: true },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        reasoning: { effort: 'high', enabled: true },
        temperature: 0.7,
      }),
      route({
        config: {
          api_base_url: 'https://api.anthropic.com',
          api_key: 'test-key',
          auto_compat: true,
          pi_ai_provider: 'anthropic',
        } as any,
      }),
      {
        transformRequest: vi.fn(async () => ({
          model: 'provider-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          max_tokens: 4096,
          temperature: 0.7,
        })),
      },
      'messages',
      []
    );

    expect(result.bypassTransformation).toBe(false);
    expect(result.payload.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 16384,
      display: 'summarized',
    });
    expect(result.payload.temperature).toBeUndefined();
  });

  test('skips auto-compat when the model has no pi_ai_model_id', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'high',
        },
      }),
      route({ modelConfig: { pricing: { source: 'simple', input: 0, output: 0 } } as any }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('high');
    expect(piAiRegistry.resolvePiAiModel).not.toHaveBeenCalled();
  });

  test('drops temperature when registry compat marks it unsupported', async () => {
    vi.mocked(piAiRegistry.resolvePiAiModel).mockReturnValue(
      piModel({
        reasoning: false,
        compat: { supportsTemperature: false },
      })
    );
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          temperature: 0.5,
        },
      }),
      route(),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.temperature).toBeUndefined();
  });

  test('model-level auto_compat enables compat when provider-level is off', async () => {
    const dispatcher = new Dispatcher() as any;

    const result = await dispatcher.transformRequestPayload(
      request({
        originalBody: {
          model: 'alias-model',
          messages: [{ role: 'user', content: 'hello' }],
          reasoning_effort: 'low',
        },
      }),
      route({
        config: {
          api_base_url: 'https://example.test/v1',
          api_key: 'test-key',
          auto_compat: false,
          pi_ai_provider: 'openai',
        } as any,
        modelConfig: {
          pricing: { source: 'simple', input: 0, output: 0 },
          auto_compat: true,
          pi_ai_model_id: 'registry-model',
        } as any,
      }),
      { transformRequest: vi.fn() },
      'chat',
      []
    );

    expect(result.payload.reasoning_effort).toBe('low');
  });
});

describe('matchUnsupportedParameter', () => {
  test('extracts the param name from a {"detail": "..."} body', () => {
    expect(matchUnsupportedParameter('{"detail":"Unsupported parameter: safety_identifier"}')).toBe(
      'safety_identifier'
    );
  });

  test('extracts the param name from a {"error":{"message": "..."}} body with quotes', () => {
    expect(
      matchUnsupportedParameter(
        '{"error":{"message":"Unsupported parameter: \'prompt_cache_key\'"}}'
      )
    ).toBe('prompt_cache_key');
  });

  test('extracts dotted-path param names', () => {
    expect(
      matchUnsupportedParameter(
        '{"error":{"message":"Unsupported parameter: \'reasoning.summary\'"}}'
      )
    ).toBe('reasoning.summary');
  });

  test('returns undefined when the body does not name an unsupported parameter', () => {
    expect(matchUnsupportedParameter('{"error":{"message":"Invalid request"}}')).toBeUndefined();
  });

  test('returns undefined for an empty body', () => {
    expect(matchUnsupportedParameter('')).toBeUndefined();
  });
});

describe('deleteDottedPath', () => {
  test('deletes a top-level field and returns deleted:true with a new payload object', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5', safety_identifier: 'abc' };
    const result = deleteDottedPath(payload, 'safety_identifier');
    expect(result.deleted).toBe(true);
    expect(result.payload).toEqual({ model: 'gpt-5.5' });
    // Copy-on-write: the ORIGINAL argument object is never mutated.
    expect(payload).toEqual({ model: 'gpt-5.5', safety_identifier: 'abc' });
    expect(result.payload).not.toBe(payload);
  });

  test('deletes a nested field via a dotted path, preserving siblings', () => {
    const payload: Record<string, any> = {
      reasoning: { effort: 'high', summary: 'auto' },
    };
    const result = deleteDottedPath(payload, 'reasoning.summary');
    expect(result.deleted).toBe(true);
    expect(result.payload).toEqual({ reasoning: { effort: 'high' } });
    // Original untouched.
    expect(payload).toEqual({ reasoning: { effort: 'high', summary: 'auto' } });
  });

  test('returns deleted:false and leaves the payload untouched when the field is absent', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5' };
    const result = deleteDottedPath(payload, 'safety_identifier');
    expect(result.deleted).toBe(false);
    expect(result.payload).toEqual({ model: 'gpt-5.5' });
    expect(payload).toEqual({ model: 'gpt-5.5' });
  });

  test('returns deleted:false without throwing when an intermediate segment does not exist', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5' };
    const result = deleteDottedPath(payload, 'reasoning.summary');
    expect(result.deleted).toBe(false);
    expect(result.payload).toEqual({ model: 'gpt-5.5' });
  });

  test('returns deleted:false without throwing when an intermediate segment is not an object', () => {
    const payload: Record<string, any> = { reasoning: 'not-an-object' };
    const result = deleteDottedPath(payload, 'reasoning.summary');
    expect(result.deleted).toBe(false);
    expect(result.payload).toEqual({ reasoning: 'not-an-object' });
  });

  // --- SECURITY: prototype-pollution hardening -------------------------------
  //
  // `path` is attacker-influenced: it comes from parsing an UPSTREAM PROVIDER's
  // error message (matchUnsupportedParameter's `[\w.]+` capture group matches
  // dots AND underscores, so a malicious/compromised upstream can name
  // `__proto__.toString` as the "unsupported parameter"). The OLD
  // implementation traversed with `segment in target` (true for INHERITED
  // properties too) and mutated in place — `payload.__proto__` resolves via
  // the inherited accessor to the REAL `Object.prototype`, so
  // `deleteDottedPath({}, '__proto__.toString')` would delete the global
  // `Object.prototype.toString` for the entire process, permanently, for
  // every subsequent request.
  describe('prototype-pollution hardening', () => {
    test('rejects a `__proto__.<leaf>` path and leaves Object.prototype.toString intact', () => {
      const originalToString = Object.prototype.toString;
      const payload: Record<string, any> = { model: 'gpt-5.5' };

      const result = deleteDottedPath(payload, '__proto__.toString');

      expect(result.deleted).toBe(false);
      expect(result.payload).toEqual({ model: 'gpt-5.5' });
      // The actual attack: prove global state survived, not just that the
      // function returned a particular value.
      expect(Object.prototype.toString).toBe(originalToString);
      expect(typeof Object.prototype.toString).toBe('function');
      expect({}.toString()).toBe('[object Object]');
    });

    test('rejects a bare top-level `__proto__` path', () => {
      const payload: Record<string, any> = { model: 'gpt-5.5' };
      const result = deleteDottedPath(payload, '__proto__');
      expect(result.deleted).toBe(false);
      expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    });

    test('rejects `constructor.prototype.<leaf>` (classic gadget path)', () => {
      const originalToString = Object.prototype.toString;
      const payload: Record<string, any> = { model: 'gpt-5.5' };

      const result = deleteDottedPath(payload, 'constructor.prototype.toString');

      expect(result.deleted).toBe(false);
      expect(Object.prototype.toString).toBe(originalToString);
      expect(typeof Object.prototype.toString).toBe('function');
    });

    test('rejects a dangerous segment appearing in the middle of the path, not just at the edges', () => {
      const payload: Record<string, any> = { a: { __proto__: { b: 'x' } } };
      const result = deleteDottedPath(payload, 'a.__proto__.b');
      expect(result.deleted).toBe(false);
    });

    test('rejects `prototype` as a segment name', () => {
      const payload: Record<string, any> = { model: 'gpt-5.5' };
      const result = deleteDottedPath(payload, 'prototype.polluted');
      expect(result.deleted).toBe(false);
    });

    test('traverses only OWN enumerable properties — inherited properties are never walked', () => {
      // `toString` is never an OWN property of a plain object literal; it's
      // inherited from Object.prototype. `in` (the old check) would say
      // true; hasOwnProperty must say false.
      const payload: Record<string, any> = { model: 'gpt-5.5' };
      const result = deleteDottedPath(payload, 'toString');
      expect(result.deleted).toBe(false);
      expect(typeof payload.toString).toBe('function');
    });
  });

  // --- Copy-on-write: shared nested objects must never be mutated ------------
  //
  // `providerPayload.reasoning` can be the SAME object reference as the
  // long-lived `UnifiedChatRequest.reasoning` (see
  // `payload.reasoning = request.reasoning` in transformers/responses.ts).
  // Mutating it in place would corrupt that shared object for every OTHER
  // failover target built from the same request afterward.
  describe('copy-on-write (shared nested object references)', () => {
    test('does not mutate a nested object shared by reference with another source object', () => {
      const sharedReasoning = { effort: 'high', summary: 'auto' };
      const request = { reasoning: sharedReasoning };
      // Mirrors `payload.reasoning = request.reasoning` — same reference, not a clone.
      const payload: Record<string, any> = { model: 'gpt-5.5', reasoning: request.reasoning };
      expect(payload.reasoning).toBe(sharedReasoning);

      const result = deleteDottedPath(payload, 'reasoning.summary');

      expect(result.deleted).toBe(true);
      expect(result.payload).toEqual({ model: 'gpt-5.5', reasoning: { effort: 'high' } });

      // Assert BY REFERENCE: the source object binding is untouched...
      expect(request.reasoning).toBe(sharedReasoning);
      // ...AND by deep equality: its CONTENT was never mutated in place.
      expect(request.reasoning).toEqual({ effort: 'high', summary: 'auto' });
      expect(sharedReasoning).toEqual({ effort: 'high', summary: 'auto' });

      // The original `payload` argument itself is also untouched.
      expect(payload).toEqual({ model: 'gpt-5.5', reasoning: sharedReasoning });
      expect(payload.reasoning).toBe(sharedReasoning);

      // The returned payload's reasoning object is a NEW object, not the shared one.
      expect(result.payload.reasoning).not.toBe(sharedReasoning);
    });

    test('sibling nested objects on the payload are shared (not cloned) since they are never touched', () => {
      const untouchedSibling = { foo: 'bar' };
      const payload: Record<string, any> = {
        reasoning: { effort: 'high', summary: 'auto' },
        metadata: untouchedSibling,
      };

      const result = deleteDottedPath(payload, 'reasoning.summary');

      expect(result.deleted).toBe(true);
      // Untouched branch of the object tree is the SAME reference (only the
      // path actually being modified gets cloned).
      expect(result.payload.metadata).toBe(untouchedSibling);
    });
  });
});

describe('planUnsupportedParamStrip', () => {
  test('strips a newly-named param and records the attempt', () => {
    const state = createUnsupportedParamStripState();
    const result = planUnsupportedParamStrip(
      '{"detail":"Unsupported parameter: safety_identifier"}',
      state
    );
    expect(result).toBe('safety_identifier');
    expect(state.attempts).toBe(1);
    expect(state.strippedParams.has('safety_identifier')).toBe(true);
  });

  test('allows up to MAX_UNSUPPORTED_PARAM_STRIP_RETRIES distinct params, then stops', () => {
    expect(MAX_UNSUPPORTED_PARAM_STRIP_RETRIES).toBe(2);
    const state = createUnsupportedParamStripState();

    expect(
      planUnsupportedParamStrip('{"detail":"Unsupported parameter: safety_identifier"}', state)
    ).toBe('safety_identifier');
    expect(
      planUnsupportedParamStrip('{"detail":"Unsupported parameter: prompt_cache_key"}', state)
    ).toBe('prompt_cache_key');

    // Bound reached — a THIRD distinct param must not trigger another retry.
    expect(
      planUnsupportedParamStrip('{"detail":"Unsupported parameter: reasoning.summary"}', state)
    ).toBeUndefined();
    expect(state.attempts).toBe(2);
  });

  test('stops immediately (no infinite loop) when upstream keeps naming the same param', () => {
    const state = createUnsupportedParamStripState();
    const body = '{"detail":"Unsupported parameter: safety_identifier"}';

    expect(planUnsupportedParamStrip(body, state)).toBe('safety_identifier');
    // Upstream 400s again naming the SAME param even after it was stripped —
    // stop rather than burning through the retry bound on a no-op.
    expect(planUnsupportedParamStrip(body, state)).toBeUndefined();
    expect(planUnsupportedParamStrip(body, state)).toBeUndefined();
    expect(state.attempts).toBe(1);
  });

  test('returns undefined when the body does not name an unsupported parameter', () => {
    const state = createUnsupportedParamStripState();
    expect(
      planUnsupportedParamStrip('{"error":{"message":"Invalid request"}}', state)
    ).toBeUndefined();
    expect(state.attempts).toBe(0);
  });
});

// prompt_cache_key is intentionally NOT in the static
// suppress_unsupported_gpt5_options strip list (the Codex-OAuth native path
// derives session-id/x-client-request-id headers from it, and no upstream
// has been observed rejecting it) — so the reactive path is the ONLY
// mechanism that removes it, and only when an upstream actually 400s naming
// it. These tests exercise the full match -> plan -> delete pipeline on a
// realistic provider payload, for both a plain and a dotted-path occurrence
// of the field.
describe('reactive strip-and-retry handles prompt_cache_key (not statically stripped)', () => {
  test('strips a plain top-level prompt_cache_key named in a 400', () => {
    const state = createUnsupportedParamStripState();
    const payload: Record<string, any> = {
      model: 'openai/gpt-5.5',
      input: 'hello',
      prompt_cache_key: 'cache-key-123',
    };

    const paramToStrip = planUnsupportedParamStrip(
      '{"detail":"Unsupported parameter: prompt_cache_key"}',
      state
    );

    expect(paramToStrip).toBe('prompt_cache_key');
    const result = deleteDottedPath(payload, paramToStrip!);
    expect(result.deleted).toBe(true);
    expect(result.payload).toEqual({ model: 'openai/gpt-5.5', input: 'hello' });
  });

  test('strips a dotted-path prompt_cache_key named in a 400', () => {
    const state = createUnsupportedParamStripState();
    const payload: Record<string, any> = {
      model: 'openai/gpt-5.5',
      input: 'hello',
      metadata: { prompt_cache_key: 'cache-key-123', session: 's1' },
    };

    const paramToStrip = planUnsupportedParamStrip(
      '{"error":{"message":"Unsupported parameter: \'metadata.prompt_cache_key\'"}}',
      state
    );

    expect(paramToStrip).toBe('metadata.prompt_cache_key');
    const result = deleteDottedPath(payload, paramToStrip!);
    expect(result.deleted).toBe(true);
    expect(result.payload).toEqual({
      model: 'openai/gpt-5.5',
      input: 'hello',
      metadata: { session: 's1' },
    });
  });
});

// ---------------------------------------------------------------------------
// T3: thinking-signature failover recovery
// ---------------------------------------------------------------------------
//
// Alias-level failover can replay a conversation containing `thinking` /
// `redacted_thinking` blocks signed by one Claude model against a different
// Claude model (e.g. cc/claude-opus-5 -> cc/claude-opus-4-8). Anthropic
// rejects the stale signature with a 400 naming it specifically; every
// remaining target would reject the same replayed signature the same way, so
// failing over doesn't help — strip the thinking blocks and retry the SAME
// target instead.

describe('matchThinkingSignatureError', () => {
  test('matches the exact production error body', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'messages.3.content.0: Invalid `signature` in `thinking` block',
      },
      request_id: 'req_test123',
    });
    expect(matchThinkingSignatureError(body)).toBe(true);
  });

  test('matches without backtick quoting around signature/thinking', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"Invalid signature in thinking block"}}')
    ).toBe(true);
  });

  test('matches regardless of case', () => {
    expect(matchThinkingSignatureError('INVALID SIGNATURE IN THINKING BLOCK')).toBe(true);
  });

  test('returns false for an unrelated 400 body', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"Invalid request: missing model"}}')
    ).toBe(false);
  });

  test('returns false for a thinking-adjacent but unrelated error', () => {
    expect(
      matchThinkingSignatureError('{"error":{"message":"thinking.budget_tokens must be positive"}}')
    ).toBe(false);
  });

  test('returns false for an empty body', () => {
    expect(matchThinkingSignatureError('')).toBe(false);
  });
});

describe('isAnthropicMessagesPayload', () => {
  test('true when the payload has a messages array', () => {
    expect(isAnthropicMessagesPayload({ model: 'claude-x', messages: [] })).toBe(true);
  });

  test('false when messages is missing (e.g. a Responses API payload)', () => {
    expect(isAnthropicMessagesPayload({ model: 'gpt-5.5', input: 'hi' })).toBe(false);
  });

  test('false when messages is present but not an array', () => {
    expect(isAnthropicMessagesPayload({ messages: 'not-an-array' })).toBe(false);
  });

  test('false for null, undefined, and non-object payloads', () => {
    expect(isAnthropicMessagesPayload(null)).toBe(false);
    expect(isAnthropicMessagesPayload(undefined)).toBe(false);
    expect(isAnthropicMessagesPayload('a string')).toBe(false);
  });
});

describe('stripThinkingSignatureBlocks', () => {
  test('removes a thinking block preceding text, preserving ordering', () => {
    const payload: Record<string, any> = {
      model: 'claude-x',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'stale reasoning', signature: 'sig-from-model-a' },
            { type: 'text', text: 'the answer' },
          ],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
    ]);
  });

  test('removes a thinking block preceding a tool_use, preserving ordering', () => {
    const payload: Record<string, any> = {
      model: 'claude-x',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'stale reasoning', signature: 'sig-from-model-a' },
            { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
          ],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages[1].content).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
    ]);
    // Ordering/other messages untouched.
    expect(payload.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'do the thing' }],
    });
  });

  test('removes a redacted_thinking block, preserving sibling content', () => {
    const payload: Record<string, any> = {
      model: 'claude-x',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'redacted_thinking', data: 'opaque-encrypted-payload' },
            { type: 'text', text: 'the answer' },
          ],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
    ]);
  });

  test('removes both thinking and redacted_thinking blocks in the same message', () => {
    const payload: Record<string, any> = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'a', signature: 'sig-a' },
            { type: 'redacted_thinking', data: 'b' },
            { type: 'text', text: 'the answer' },
          ],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(2);
    expect(payload.messages[0].content).toEqual([{ type: 'text', text: 'the answer' }]);
  });

  test('leaves non-array content (plain string messages) untouched', () => {
    const payload: Record<string, any> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(0);
    expect(payload.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  test('is a no-op when the payload has no messages array', () => {
    const payload: Record<string, any> = { model: 'gpt-5.5', input: 'hi' };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(0);
    expect(payload).toEqual({ model: 'gpt-5.5', input: 'hi' });
  });

  test('drops a thinking-only assistant message at the end of the conversation (no alternation break, nothing to orphan)', () => {
    const payload: Record<string, any> = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  test('replaces a thinking-only assistant message with a placeholder when dropping it would break user/assistant alternation', () => {
    const payload: Record<string, any> = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'text', text: '[reasoning elided]' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ]);
  });

  test('replaces a thinking-only message with a placeholder when dropping it would orphan a tool_result (no matching tool_use adjacent)', () => {
    // Deliberately constructed so the alternation check alone would NOT catch
    // this (prev='assistant', next='user' — different roles) — isolating the
    // tool_result-orphan guard: `next` carries a tool_result but `prev` does
    // NOT carry the tool_use it would need to correspond to, so dropping the
    // thinking-only message would leave that tool_result dangling.
    const payload: Record<string, any> = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'partial answer, no tool call' }] },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages[2]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[reasoning elided]' }],
    });
    // Everything else is untouched.
    expect(payload.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'q' }] });
    expect(payload.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial answer, no tool call' }],
    });
    expect(payload.messages[3]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
    });
  });

  test('drops a thinking-only message when the next tool_result correctly pairs with a preceding tool_use', () => {
    // Here dropping the empty message actually restores correct adjacency
    // between the tool_use and its tool_result, so it is safe to drop.
    const payload: Record<string, any> = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'search', input: {} }],
        },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'stale', signature: 'sig-a' }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
        },
      ],
    };

    const strippedCount = stripThinkingSignatureBlocks(payload);

    expect(strippedCount).toBe(1);
    expect(payload.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'search', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result' }],
      },
    ]);
  });
});

describe('planThinkingSignatureStrip', () => {
  const signatureBody = JSON.stringify({
    error: { message: 'messages.3.content.0: Invalid `signature` in `thinking` block' },
  });
  const anthropicPayload = { model: 'claude-x', messages: [] };

  test('MAX_THINKING_SIGNATURE_STRIP_RETRIES is exactly 1 (one strip-retry per target)', () => {
    expect(MAX_THINKING_SIGNATURE_STRIP_RETRIES).toBe(1);
  });

  test('plans a strip-retry on the first matching 400 for an Anthropic messages payload', () => {
    const state = createThinkingSignatureStripState();
    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    expect(state.attempts).toBe(1);
  });

  test('does not plan a retry when the body does not name a signature error', () => {
    const state = createThinkingSignatureStripState();
    expect(
      planThinkingSignatureStrip('{"error":{"message":"Invalid request"}}', anthropicPayload, state)
    ).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('does not plan a retry when the outbound payload is not Anthropic-messages-shaped', () => {
    const state = createThinkingSignatureStripState();
    const responsesPayload = { model: 'gpt-5.5', input: 'hi' };
    expect(planThinkingSignatureStrip(signatureBody, responsesPayload, state)).toBe(false);
    expect(state.attempts).toBe(0);
  });

  test('retry bound: a second signature 400 on the same target does not plan a second strip-retry', () => {
    const state = createThinkingSignatureStripState();

    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(true);
    // Upstream 400s again with the SAME (or another) signature error — the
    // one-per-target bound is already used up, so normal failover must
    // proceed instead of stripping again.
    expect(planThinkingSignatureStrip(signatureBody, anthropicPayload, state)).toBe(false);
    expect(state.attempts).toBe(1);
  });
});
