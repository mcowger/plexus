import { describe, expect, test } from 'vitest';
import {
  createUnsupportedParamStripState,
  deleteDottedPath,
  matchUnsupportedParameter,
  planUnsupportedParamStrip,
  MAX_UNSUPPORTED_PARAM_STRIP_RETRIES,
} from '../dispatch/dispatcher-auto-compat';
import {
  ARRAY_FIELD_PAYLOAD,
  ARRAY_INDEX_TOOL_A,
  ARRAY_INDEX_TOOL_B,
  ARRAY_INDEX_TOOL_C,
  ARRAY_INDEX_TOOLS_PAYLOAD,
  BRACKET_MESSAGE_NAME_PAYLOAD,
  NESTED_ARRAY_PAYLOAD,
  PROMPT_CACHE_KEY_PAYLOAD,
  PROMPT_CACHE_METADATA_PAYLOAD,
  SHARED_MESSAGES,
  SHARED_MESSAGES_PAYLOAD,
  STRUCTURAL_MESSAGE_NAME_PAYLOAD,
  STRUCTURAL_TOOLS_PAYLOAD,
  TOP_LEVEL_TOOLS_PAYLOAD,
} from './dispatcher-auto-compat.fixtures';

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

  test('extracts a dotted-path param from an unknown-parameter error', () => {
    expect(
      matchUnsupportedParameter('{"error":{"message":"Unknown parameter: \'reasoning.enabled\'"}}')
    ).toBe('reasoning.enabled');
  });

  test('extracts a bracket-notation param name, normalized to canonical dotted form', () => {
    // The old `[\w.]+` capture stopped at the `[`, truncating
    // `messages[0].name` to `messages` — and the paired deleteDottedPath call
    // then deleted the ENTIRE conversation from the retry payload.
    expect(
      matchUnsupportedParameter(
        '{"error":{"message":"Unsupported parameter: \'messages[0].name\'"}}'
      )
    ).toBe('messages.0.name');
  });

  test('extracts a backtick-quoted param name (Meta Model API error shape)', () => {
    expect(
      matchUnsupportedParameter(
        '{"error":{"code":null,"message":"unknown parameter `reasoning`","param":"reasoning","type":"invalid_request_error"}}'
      )
    ).toBe('reasoning');
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

  // --- Array containers: numeric path segments must preserve Array-ness ------
  //
  // matchUnsupportedParameter's `[\w.]+` capture CAN name a path through an
  // array (an upstream 400 like "Unsupported parameter: messages.0.some_field").
  // The copy-on-write rebuild must keep every array on the path an ARRAY —
  // an unconditional `{ ...target }` would turn `messages` into an
  // object-shaped `{"0": {...}, "1": {...}}` and produce a malformed retry
  // payload that every upstream rejects.
  describe('array container preservation', () => {
    test('deleting a field inside an array element keeps the array an array', () => {
      const payload: Record<string, any> = ARRAY_FIELD_PAYLOAD;
      const snapshot = structuredClone(payload);

      const result = deleteDottedPath(payload, 'messages.0.some_field');

      expect(result.deleted).toBe(true);
      expect(Array.isArray(result.payload.messages)).toBe(true);
      expect(result.payload.messages).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
      ]);
      // Copy-on-write extends to array levels: original untouched...
      expect(payload).toEqual(snapshot);
      expect(result.payload.messages).not.toBe(payload.messages);
      // ...and the untouched sibling element is shared, not cloned.
      expect(result.payload.messages[1]).toBe(payload.messages[1]);
    });

    test('an array-index leaf removes the element splice-style (no hole, no null)', () => {
      const t0 = ARRAY_INDEX_TOOL_A;
      const t1 = ARRAY_INDEX_TOOL_B;
      const t2 = ARRAY_INDEX_TOOL_C;
      const payload: Record<string, any> = ARRAY_INDEX_TOOLS_PAYLOAD;

      const result = deleteDottedPath(payload, 'tools.2');

      expect(result.deleted).toBe(true);
      expect(Array.isArray(result.payload.tools)).toBe(true);
      expect(result.payload.tools).toEqual([t0, t1]);
      expect(result.payload.tools).toHaveLength(2);
      // No hole left behind: `delete arr[2]` would keep length 3 and
      // serialize the gap as null — every index must be an own property.
      expect(Object.keys(result.payload.tools)).toEqual(['0', '1']);
      // Original untouched.
      expect(payload.tools).toHaveLength(3);
      expect(payload.tools[2]).toBe(t2);
    });

    test('removing a MIDDLE array element shifts later elements left (no hole)', () => {
      const payload: Record<string, any> = { tools: ['a', 'b', 'c'] };

      const result = deleteDottedPath(payload, 'tools.1');

      expect(result.deleted).toBe(true);
      expect(result.payload.tools).toEqual(['a', 'c']);
      expect(Object.keys(result.payload.tools)).toEqual(['0', '1']);
      expect(payload.tools).toEqual(['a', 'b', 'c']);
    });

    test('preserves arrays at intermediate depths of a longer path', () => {
      const payload: Record<string, any> = NESTED_ARRAY_PAYLOAD;
      const result = deleteDottedPath(payload, 'messages.0.meta.drop');

      expect(result.deleted).toBe(true);
      expect(Array.isArray(result.payload.messages)).toBe(true);
      expect(result.payload.messages[0].meta).toEqual({ keep: 1 });
      expect(payload.messages[0].meta).toEqual({ keep: 1, drop: 2 });
    });

    test('does not mutate an array shared by reference with another holder', () => {
      const sharedMessages = SHARED_MESSAGES;
      const request = { messages: sharedMessages };
      // Mirrors payload.messages = request.messages — same reference.
      const payload: Record<string, any> = SHARED_MESSAGES_PAYLOAD;

      const result = deleteDottedPath(payload, 'messages.0.bad_field');

      expect(result.deleted).toBe(true);
      expect(request.messages).toBe(sharedMessages);
      expect(sharedMessages).toEqual([{ role: 'user', content: 'hi', bad_field: 1 }]);
      expect(result.payload.messages).not.toBe(sharedMessages);
      expect(result.payload.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    test('returns deleted:false for an out-of-bounds array index', () => {
      const payload: Record<string, any> = { tools: ['a'] };

      const result = deleteDottedPath(payload, 'tools.5');

      expect(result.deleted).toBe(false);
      expect(result.payload).toBe(payload);
    });

    test('returns deleted:false for a non-index own property on an array (e.g. length) instead of corrupting the array', () => {
      // Arrays have `length` as an OWN property, so hasOwnProperty alone
      // would let "messages.length" through — and the rebuild would turn the
      // array into an object. Only canonical in-bounds indices are valid
      // array segments; anything else is refused untouched.
      const payload: Record<string, any> = { messages: [{ role: 'user', content: 'hi' }] };

      const result = deleteDottedPath(payload, 'messages.length');

      expect(result.deleted).toBe(false);
      expect(result.payload).toBe(payload);
      expect(Array.isArray(payload.messages)).toBe(true);
      expect(payload.messages).toHaveLength(1);
    });

    test('rejects a non-canonical numeric segment ("01") on an array', () => {
      const payload: Record<string, any> = { tools: ['a', 'b'] };

      const result = deleteDottedPath(payload, 'tools.01');

      expect(result.deleted).toBe(false);
      expect(result.payload).toBe(payload);
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

  test('structural guard: refuses to strip the whole messages/input/model field, consuming no budget', () => {
    // Deleting any of these wholesale guarantees a malformed request — every
    // retry would 400 on a missing-conversation/missing-model error instead,
    // so the plan must refuse outright (normal failover proceeds) and must
    // NOT burn a strip attempt doing so.
    const state = createUnsupportedParamStripState();
    for (const field of ['messages', 'input', 'model']) {
      expect(
        planUnsupportedParamStrip(`{"detail":"Unsupported parameter: ${field}"}`, state)
      ).toBeUndefined();
    }
    expect(state.attempts).toBe(0);
    expect(state.strippedParams.size).toBe(0);
  });

  test('structural guard is exact-match only: sub-paths inside messages stay strippable', () => {
    const state = createUnsupportedParamStripState();
    expect(
      planUnsupportedParamStrip('{"detail":"Unsupported parameter: messages.0.name"}', state)
    ).toBe('messages.0.name');
    expect(state.attempts).toBe(1);
  });

  describe('structural array elements (messages[N] / input[N]) are refused budget-free', () => {
    // `Unsupported parameter: messages[0]` normalizes to `messages.0`, which
    // dodges the exact-name guard — and the paired deleteDottedPath would
    // splice an ENTIRE message out of the conversation. A numeric leaf
    // directly under a structural root deletes a whole conversation item,
    // so it gets the same budget-free refusal as the whole-field guard:
    // normal failover proceeds, no strip attempt is consumed.
    test('a 400 naming messages[0] (bracket form) is refused, consuming no budget', () => {
      const state = createUnsupportedParamStripState();
      expect(
        planUnsupportedParamStrip(
          '{"error":{"message":"Unsupported parameter: \'messages[0]\'"}}',
          state
        )
      ).toBeUndefined();
      expect(state.attempts).toBe(0);
      expect(state.strippedParams.size).toBe(0);
    });

    test('a 400 naming input[2] (bracket form) is refused, consuming no budget', () => {
      const state = createUnsupportedParamStripState();
      expect(
        planUnsupportedParamStrip('{"detail":"Unsupported parameter: input[2]"}', state)
      ).toBeUndefined();
      expect(state.attempts).toBe(0);
      expect(state.strippedParams.size).toBe(0);
    });

    test('the already-dotted spelling (messages.0) is refused identically', () => {
      const state = createUnsupportedParamStripState();
      expect(
        planUnsupportedParamStrip('{"detail":"Unsupported parameter: messages.0"}', state)
      ).toBeUndefined();
      expect(state.attempts).toBe(0);
    });

    test('a refusal leaves the full budget for later legitimately-strippable params', () => {
      const state = createUnsupportedParamStripState();
      expect(
        planUnsupportedParamStrip('{"detail":"Unsupported parameter: messages[0]"}', state)
      ).toBeUndefined();
      // Both retry slots must still be available afterwards.
      expect(
        planUnsupportedParamStrip('{"detail":"Unsupported parameter: safety_identifier"}', state)
      ).toBe('safety_identifier');
      expect(
        planUnsupportedParamStrip('{"detail":"Unsupported parameter: prompt_cache_key"}', state)
      ).toBe('prompt_cache_key');
      expect(state.attempts).toBe(2);
    });

    test('deeper paths under a structural element (messages.0.name) remain strippable', () => {
      const state = createUnsupportedParamStripState();
      const payload: Record<string, any> = STRUCTURAL_MESSAGE_NAME_PAYLOAD;

      const paramToStrip = planUnsupportedParamStrip(
        '{"error":{"message":"Unsupported parameter: \'messages[0].name\'"}}',
        state
      );
      expect(paramToStrip).toBe('messages.0.name');

      const result = deleteDottedPath(payload, paramToStrip!);
      expect(result.deleted).toBe(true);
      expect(result.payload.messages).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
      ]);
    });

    test('numeric leaves under NON-structural arrays (tools[2]) stay splice-deletable', () => {
      const state = createUnsupportedParamStripState();
      const payload: Record<string, any> = STRUCTURAL_TOOLS_PAYLOAD;

      const paramToStrip = planUnsupportedParamStrip(
        '{"detail":"Unsupported parameter: tools[2]"}',
        state
      );
      expect(paramToStrip).toBe('tools.2');
      expect(state.attempts).toBe(1);

      const result = deleteDottedPath(payload, paramToStrip!);
      expect(result.deleted).toBe(true);
      expect(result.payload.tools).toEqual([{ name: 'a' }, { name: 'b' }]);
      expect(Array.isArray(result.payload.tools)).toBe(true);
    });
  });
});

// The production bug this pipeline guards against: an upstream 400 naming
// `messages[0].name` was truncated by the old `[\w.]+` matcher to `messages`,
// so the strip-and-retry deleted the WHOLE conversation and retried a
// guaranteed-malformed payload. Bracket segments must be captured, normalized
// to canonical dotted form, and land on the array ELEMENT's field.
describe('bracket-notation unsupported params (match -> plan -> delete pipeline)', () => {
  test('a 400 naming messages[0].name deletes only that element field — the conversation array survives', () => {
    const state = createUnsupportedParamStripState();
    const payload: Record<string, any> = BRACKET_MESSAGE_NAME_PAYLOAD;

    const paramToStrip = planUnsupportedParamStrip(
      '{"error":{"message":"Unsupported parameter: \'messages[0].name\'"}}',
      state
    );

    expect(paramToStrip).toBe('messages.0.name');

    const result = deleteDottedPath(payload, paramToStrip!);
    expect(result.deleted).toBe(true);
    expect(Array.isArray(result.payload.messages)).toBe(true);
    expect(result.payload.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]);
  });

  test('other whole top-level fields (tools) are still strippable', () => {
    // The structural guard is a narrow deny-list (messages/input/model), not
    // a blanket "no whole fields" rule: stripping a whole `tools` (or
    // `safety_identifier`, etc.) leaves a well-formed request.
    const state = createUnsupportedParamStripState();
    const payload: Record<string, any> = TOP_LEVEL_TOOLS_PAYLOAD;

    const paramToStrip = planUnsupportedParamStrip(
      '{"detail":"Unsupported parameter: tools"}',
      state
    );

    expect(paramToStrip).toBe('tools');
    const result = deleteDottedPath(payload, paramToStrip!);
    expect(result.deleted).toBe(true);
    expect(result.payload).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
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
    const payload: Record<string, any> = PROMPT_CACHE_KEY_PAYLOAD;

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
    const payload: Record<string, any> = PROMPT_CACHE_METADATA_PAYLOAD;

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
