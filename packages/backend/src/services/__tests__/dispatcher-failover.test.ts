import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';
// Globally mocked in test/vitest.setup.ts — imported here only to assert on
// the warn calls the strip-and-retry paths emit.
import { logger } from '../../utils/logger';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeConfig(options?: { failoverEnabled?: boolean; targetCount?: number }) {
  const failoverEnabled = options?.failoverEnabled ?? true;
  const targetCount = options?.targetCount ?? 2;

  const providers: Record<string, any> = {
    p1: {
      type: 'chat',
      api_base_url: 'https://p1.example.com/v1',
      api_key: 'test-key-p1',
      models: { 'model-1': {} },
    },
    p2: {
      type: 'chat',
      api_base_url: 'https://p2.example.com/v1',
      api_key: 'test-key-p2',
      models: { 'model-2': {} },
    },
    p3: {
      type: 'chat',
      api_base_url: 'https://p3.example.com/v1',
      api_key: 'test-key-p3',
      models: { 'model-3': {} },
    },
  };

  const orderedTargets = [
    { provider: 'p1', model: 'model-1' },
    { provider: 'p2', model: 'model-2' },
    { provider: 'p3', model: 'model-3' },
  ].slice(0, targetCount);

  return {
    providers,
    models: {
      'test-alias': {
        selector: 'in_order',
        targets: orderedTargets,
      },
    },
    keys: {},
    failover: {
      enabled: failoverEnabled,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function makeChatRequest(stream = false): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream,
  };
}

/**
 * A chat request whose outbound provider payload actually CONTAINS the
 * fields the same-target strip-and-retry tests below name as "unsupported"
 * (`safety_identifier`, `prompt_cache_key`) — via `originalBody`, since
 * OpenAITransformer.transformRequest only carries unmapped fields through
 * when `incomingApiType === 'chat'` (same-format) AND `originalBody` is set.
 * Needed so `deleteDottedPath` actually finds and removes something
 * (`deleted: true`); the call site now correctly refuses to retry a strip
 * that didn't remove anything, so a fixture that never put the field in the
 * payload in the first place would no longer exercise the retry at all.
 */
function makeChatRequestWithUnsupportedParams(): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream: false,
    originalBody: {
      model: 'test-alias',
      messages: [{ role: 'user', content: 'hello' }],
      safety_identifier: 'safety-abc',
      prompt_cache_key: 'cache-key-123',
    },
  } as any;
}

function successChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- T3: thinking-signature failover recovery helpers -----------------------

function makeAnthropicMessagesConfig(options?: { targetCount?: number }) {
  const targetCount = options?.targetCount ?? 1;
  // api_base_url uses the record/map form ({ messages: <url> }) rather than a
  // bare string so getProviderTypes()/resolveProviderBaseUrl() resolve the
  // 'messages' API type explicitly (the string-URL inference path only
  // recognizes 'messages' for URLs containing "anthropic.com" — see
  // config.ts's getProviderTypes()).
  const providers: Record<string, any> = {
    p1: {
      api_base_url: { messages: 'https://p1.example.com' },
      api_key: 'test-key-p1',
      useClaudeMasking: false,
      models: { 'model-1': {} },
    },
    p2: {
      api_base_url: { messages: 'https://p2.example.com' },
      api_key: 'test-key-p2',
      useClaudeMasking: false,
      models: { 'model-2': {} },
    },
  };

  const orderedTargets = [
    { provider: 'p1', model: 'model-1' },
    { provider: 'p2', model: 'model-2' },
  ].slice(0, targetCount);

  return {
    providers,
    models: {
      'claude-alias': {
        selector: 'in_order',
        targets: orderedTargets,
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function makeMessagesRequest(messages: any[]): UnifiedChatRequest {
  return {
    model: 'claude-alias',
    // Unified `messages` is required by the type but unused on the
    // pass-through path — the bypass path clones `originalBody` verbatim.
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'messages',
    originalBody: {
      model: 'claude-alias',
      max_tokens: 1024,
      messages,
    },
  } as any;
}

function thinkingSignatureErrorResponse() {
  // Verbatim production body from the task brief.
  return new Response(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'messages.3.content.0: Invalid `signature` in `thinking` block',
      },
      request_id: 'req_test123',
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}

function successMessagesResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function messagesWithStaleThinking() {
  return [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'stale reasoning', signature: 'sig-from-model-a' },
        { type: 'text', text: 'answer' },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
  ];
}

describe('Dispatcher Failover', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('single target, success on first try', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('multiple targets, success on first try', async () => {
    setConfigForTesting(makeConfig({ targetCount: 3 }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain('p1.example.com');
  });

  test('multiple targets, failover on retryable failure', async () => {
    setConfigForTesting(makeConfig({ targetCount: 3 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'upstream boom'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(JSON.parse(meta?.allAttemptedProviders || '[]')).toEqual(['p1/model-1', 'p2/model-2']);
  });

  test('multiple targets, all fail (exhaustion)', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'first failed'))
      .mockImplementationOnce(async () => errorResponse(503, 'second failed'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      // T6: the client-visible message now carries each attempt's own HTTP
      // status code (500 from p1, 503 from p2) instead of a bare provider list.
      expect(error.message).toContain('p1/model-1 (500), p2/model-2 (503)');
      expect(error.routingContext?.attemptCount).toBe(2);
    }
  });

  test('non-retryable 400 does NOT failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(400, 'bad request'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('malformed upstream JSON records raw body in failure context', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    const invalidJson = '{"broken": ';
    fetchMock.mockImplementation(
      async () =>
        new Response(invalidJson, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch({ ...makeChatRequest(), requestId: 'req-malformed-json' });
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain(invalidJson.trim());
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(error.routingContext?.rawResponseText).toBe(invalidJson);
      expect(error.routingContext?.providerResponse).toBe(invalidJson);

      const retryHistory = JSON.parse(error.routingContext?.retryHistory || '[]');
      expect(retryHistory).toHaveLength(1);
      expect(retryHistory[0]?.reason).toContain('{"broken":');
    }
  });

  test('large upstream validation bodies are not echoed into client-facing error messages', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    const largeValidationDetails = 'invalid input '.repeat(25_000);
    const providerBody = JSON.stringify({
      error: {
        message: 'Invalid Responses API request',
        code: 'invalid_prompt',
      },
      metadata: {
        raw: largeValidationDetails,
      },
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(providerBody, {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(error.message).toContain('Invalid Responses API request');
      expect(error.message).not.toContain(largeValidationDetails);
      expect(error.message.length).toBeLessThan(650);
      expect(error.routingContext?.providerResponse).toBe(providerBody);

      const retryHistory = JSON.parse(error.routingContext?.retryHistory || '[]');
      expect(retryHistory.length).toBeGreaterThanOrEqual(1);
      expect(
        retryHistory.every((attempt: any) => attempt.reason === 'Invalid Responses API request')
      ).toBe(true);
    }
  });

  test('large upstream error messages are capped consistently', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    const largeProviderMessage = `Invalid Responses API request ${'invalid input '.repeat(25_000)}`;
    const providerBody = JSON.stringify({
      error: {
        message: largeProviderMessage,
        code: 'invalid_prompt',
      },
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(providerBody, {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('Invalid Responses API request');
      expect(error.message).toContain('[truncated');
      expect(error.message).not.toContain(largeProviderMessage);
      expect(error.message.length).toBeLessThan(650);
      expect(error.routingContext?.providerResponse).toBe(providerBody);

      const retryHistory = JSON.parse(error.routingContext?.retryHistory || '[]');
      expect(retryHistory.length).toBeGreaterThanOrEqual(1);
      expect(
        retryHistory.every(
          (attempt: any) =>
            attempt.reason.startsWith('Invalid Responses API request') &&
            attempt.reason.includes('[truncated') &&
            attempt.reason.length < 550
        )
      ).toBe(true);
    }
  });

  test('non-retryable 422 does NOT failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(422, 'unprocessable'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('retryable 500 DOES failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'retryable'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
  });

  test('network error ECONNREFUSED DOES failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => {
        const err: any = new Error('connect ECONNREFUSED 127.0.0.1:443');
        err.code = 'ECONNREFUSED';
        throw err;
      })
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
  });

  test('streaming success on first try', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hello\\n\\n'));
        controller.close();
      },
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(response.stream).toBeDefined();
  });

  test('streaming failover before first byte', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const err: any = new Error('connect ECONNREFUSED stream');
        err.code = 'ECONNREFUSED';
        controller.error(err);
      },
    });

    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: recovered\\n\\n'));
        controller.close();
      },
    });

    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response(failingStream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
      )
      .mockImplementationOnce(
        async () =>
          new Response(okStream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
      );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest(true));
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(response.stream).toBeDefined();
  });

  test('no failover when disabled in config', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2, failoverEnabled: false }));
    fetchMock.mockImplementation(async () => errorResponse(500, 'should not retry'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('same-target retry: strips a named unsupported parameter and retries instead of failing over', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, 'Unsupported parameter: safety_identifier')
      )
      .mockImplementationOnce(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequestWithUnsupportedParams());
    const meta = (response as any).plexus;

    // Single configured target — a second fetch call can only mean the
    // SAME target was retried after stripping the offending field, not a
    // failover to a different provider (there isn't one).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta?.finalAttemptProvider).toBe('p1');

    // The field was ACTUALLY removed from the retried payload, not just a
    // retry regardless of outcome.
    const retriedBody = JSON.parse((fetchMock.mock.calls[1] as any[])[1].body as string);
    expect(retriedBody.safety_identifier).toBeUndefined();

    // The strip warn is the only operator-visible trace that the outbound
    // payload was modified mid-request — it must name both the target
    // (provider/model) and the exact param that was removed.
    const paramStripWarn = vi
      .mocked(logger.warn)
      .mock.calls.map((call) => String(call[0]))
      .find((message) => message.includes('rejected unsupported parameter'));
    expect(paramStripWarn).toBeDefined();
    expect(paramStripWarn).toContain('p1/model-1');
    expect(paramStripWarn).toContain("'safety_identifier'");
  });

  test('same-target retry: gives up after the retry bound and fails normally when the upstream keeps naming a NEW unsupported param', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, 'Unsupported parameter: safety_identifier')
      )
      .mockImplementationOnce(async () =>
        errorResponse(400, "Unsupported parameter: 'prompt_cache_key'")
      )
      .mockImplementationOnce(async () =>
        errorResponse(400, "Unsupported parameter: 'reasoning.summary'")
      );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequestWithUnsupportedParams());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    // 1 initial attempt + 2 bounded strip-retries = 3 fetch calls, then give
    // up rather than stripping a 3rd distinct param.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('same-target retry: a prototype-pollution attempt (__proto__.toString) is rejected — no retry, global state intact', async () => {
    // A malicious/compromised upstream can name ANY dotted string via the
    // "Unsupported parameter: X" 400 body (matchUnsupportedParameter's regex
    // captures dots and underscores). This proves the reactive strip-and-retry
    // path cannot be turned into a prototype-pollution gadget: the attempt
    // must be rejected (no field actually removed), so the call site must NOT
    // resend the identical payload — single target, single fetch call.
    const originalToString = Object.prototype.toString;
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () =>
      errorResponse(400, "Unsupported parameter: '__proto__.toString'")
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    // No retry happened: deleteDottedPath rejected the dangerous path, so
    // nothing was actually stripped, so the call site must not resend an
    // identical payload to the same target. A single configured target with
    // failover on but a non-retryable 400 means exactly one fetch call.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The actual attack: prove global state survived, not just that dispatch
    // failed for some other reason.
    expect(Object.prototype.toString).toBe(originalToString);
    expect(typeof Object.prototype.toString).toBe('function');
    expect({}.toString()).toBe('[object Object]');
  });

  test('same-target retry: refuses to strip the whole `messages` field — no strip, no retry', async () => {
    // Deleting the entire conversation wholesale guarantees a malformed
    // request, so the structural guard must refuse: exactly one fetch (no
    // same-target retry with a messages-less payload), then normal failure.
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => errorResponse(400, 'Unsupported parameter: messages'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('same-target retry: bracket notation (messages[0].name) strips only that element field and retries with the conversation intact', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock
      .mockImplementationOnce(async () =>
        errorResponse(400, "Unsupported parameter: 'messages[0].name'")
      )
      .mockImplementationOnce(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      model: 'test-alias',
      messages: [{ role: 'user', content: 'hello' }],
      incomingApiType: 'chat',
      stream: false,
      originalBody: {
        model: 'test-alias',
        messages: [{ role: 'user', content: 'hello', name: 'bob!' }],
      },
    } as any);
    const meta = (response as any).plexus;

    // Single configured target — the second fetch is a same-target retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta?.finalAttemptProvider).toBe('p1');

    const retriedBody = JSON.parse((fetchMock.mock.calls[1] as any[])[1].body as string);
    // The delete landed on the array ELEMENT's field (bracket segments
    // normalized to canonical indices) — the old truncating matcher instead
    // deleted `messages` wholesale from the retry payload.
    expect(Array.isArray(retriedBody.messages)).toBe(true);
    expect(retriedBody.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  test('same-target retry: a no-op strip (named field not actually present) does not retry', async () => {
    // The upstream names a field that plainly isn't in the outbound payload
    // at all — deleteDottedPath finds nothing to remove. Retrying here would
    // just resend the exact same payload and get the exact same 400 again;
    // the call site must respect the `deleted` return value and skip the retry.
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () =>
      errorResponse(400, 'Unsupported parameter: totally_fake_field_xyz')
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('same-target retry: stops immediately (no infinite loop) when the upstream keeps naming the SAME unsupported param', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () =>
      errorResponse(400, 'Unsupported parameter: safety_identifier')
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequestWithUnsupportedParams());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    // First 400 strips safety_identifier and retries; the second 400 names
    // the SAME already-stripped param, so the loop stops there instead of
    // spinning until the retry bound is exhausted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('same-target retry: strips stale thinking-block signatures and retries instead of failing over', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig({ targetCount: 1 }));
    fetchMock
      .mockImplementationOnce(async () => thinkingSignatureErrorResponse())
      .mockImplementationOnce(async () => successMessagesResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeMessagesRequest(messagesWithStaleThinking()));
    const meta = (response as any).plexus;

    // Single configured target — a second fetch call can only mean the SAME
    // target was retried after stripping the stale thinking blocks, not a
    // failover to a different provider (there isn't one).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta?.finalAttemptProvider).toBe('p1');

    const retriedBody = JSON.parse((fetchMock.mock.calls[1] as any[])[1].body as string);
    expect(Array.isArray(retriedBody.messages)).toBe(true);
    for (const message of retriedBody.messages) {
      const content = Array.isArray(message.content) ? message.content : [];
      expect(
        content.some(
          (block: any) => block.type === 'thinking' || block.type === 'redacted_thinking'
        )
      ).toBe(false);
    }
    // Non-thinking content survives the strip.
    expect(retriedBody.messages[1].content).toEqual([{ type: 'text', text: 'answer' }]);

    // The strip warn is the only operator-visible trace that conversation
    // content was modified mid-request — it must name the target
    // (provider/model) and how many thinking blocks were stripped (the
    // fixture carries exactly one).
    const signatureStripWarn = vi
      .mocked(logger.warn)
      .mock.calls.map((call) => String(call[0]))
      .find((message) => message.includes('stale thinking-block'));
    expect(signatureStripWarn).toBeDefined();
    expect(signatureStripWarn).toContain('p1/model-1');
    expect(signatureStripWarn).toContain('stripped 1 thinking block(s)');
  });

  test('same-target retry: gives up after the one-shot thinking-signature retry bound and fails normally when the signature error persists', async () => {
    setConfigForTesting(makeAnthropicMessagesConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(async () => thinkingSignatureErrorResponse());

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeMessagesRequest(messagesWithStaleThinking()));
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
    }

    // 1 initial attempt + exactly 1 bounded signature strip-retry = 2 fetch
    // calls, then give up rather than looping forever on a persistent error.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('embeddings failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'embeddings failed on p1'))
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              object: 'list',
              data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
              model: 'model-2',
              usage: { prompt_tokens: 2, total_tokens: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatchEmbeddings({
      model: 'test-alias',
      input: 'hello',
      originalBody: { input: 'hello' },
    } as any);
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(response.data?.[0]?.embedding).toEqual([0.1, 0.2]);
  });

  test('non-retryable 413 (Payload Too Large) does NOT failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(413, 'payload too large'));

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch(makeChatRequest());
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.message).toContain('All targets failed');
      expect(error.routingContext?.attemptCount).toBe(1);
      expect(error.routingContext?.statusCode).toBe(413);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('413 error does NOT trigger cooldown', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => errorResponse(413, 'payload too large'));

    const dispatcher = new Dispatcher();
    const cm = CooldownManager.getInstance();

    // Clear any existing cooldowns
    await cm.clearCooldown();

    try {
      await dispatcher.dispatch(makeChatRequest());
    } catch (error: any) {
      // Expected to fail
    }

    // Provider should NOT be on cooldown after 413
    const cooldowns = cm.getCooldowns();
    expect(cooldowns).toHaveLength(0);
  });

  test('provider allowlist filters candidates before dispatch', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      ...makeChatRequest(),
      metadata: {
        plexus_metadata: {
          plexus_key_policy: {
            allowedProviders: ['p2'],
          },
        },
      },
    });
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain('p2.example.com');
  });

  test('model allowlist blocks disallowed aliases with 403 before fetch', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const dispatcher = new Dispatcher();

    await expect(
      dispatcher.dispatch({
        ...makeChatRequest(),
        metadata: {
          plexus_metadata: {
            plexus_key_policy: {
              allowedModels: ['other-alias'],
            },
          },
        },
      })
    ).rejects.toMatchObject({
      message: "Key is not allowed to access model 'test-alias' for chat",
      routingContext: {
        statusCode: 403,
        errorType: 'access_denied',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test('provider denylist filters out excluded providers', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      ...makeChatRequest(),
      metadata: {
        plexus_metadata: {
          plexus_key_policy: {
            excludedProviders: ['p1'],
          },
        },
      },
    });
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock as any).mock.calls[0]?.[0])).toContain('p2.example.com');
  });

  test('model denylist blocks excluded aliases with 403 before fetch', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const dispatcher = new Dispatcher();

    await expect(
      dispatcher.dispatch({
        ...makeChatRequest(),
        metadata: {
          plexus_metadata: {
            plexus_key_policy: {
              excludedModels: ['test-alias'],
            },
          },
        },
      })
    ).rejects.toMatchObject({
      message: "Key is not allowed to access model 'test-alias' for chat",
      routingContext: {
        statusCode: 403,
        errorType: 'access_denied',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test('excluded models take precedence over allowed models for the same entry', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));

    const dispatcher = new Dispatcher();

    // If a model is in both allowed AND excluded lists, excluded wins
    await expect(
      dispatcher.dispatch({
        ...makeChatRequest(),
        metadata: {
          plexus_metadata: {
            plexus_key_policy: {
              allowedModels: ['test-alias'],
              excludedModels: ['test-alias'],
            },
          },
        },
      })
    ).rejects.toMatchObject({
      routingContext: {
        statusCode: 403,
        errorType: 'access_denied',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test('excluded providers filter out candidates, then allowed providers further restrict', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock.mockImplementation(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      ...makeChatRequest(),
      metadata: {
        plexus_metadata: {
          plexus_key_policy: {
            excludedProviders: ['p1'],
            allowedProviders: ['p2'],
          },
        },
      },
    });
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p2');
  });

  test('provider error captures all upstream response headers in routing context', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: 'boom' } }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'provider-req-123',
            'X-Custom-Header': 'custom-value',
          },
        })
    );

    const dispatcher = new Dispatcher();

    try {
      await dispatcher.dispatch({ ...makeChatRequest(), requestId: 'req-headers-test' });
      throw new Error('expected dispatch to fail');
    } catch (error: any) {
      expect(error.routingContext?.providerResponseHeaders).toBeDefined();
      expect(error.routingContext?.providerResponseHeaders['x-request-id']).toBe(
        'provider-req-123'
      );
      expect(error.routingContext?.providerResponseHeaders['x-custom-header']).toBe('custom-value');
      expect(error.routingContext?.providerResponseHeaders['content-type']).toBe(
        'application/json'
      );
    }
  });

  test('retry history includes provider response headers on failed attempts', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ error: { message: 'first boom' } }), {
            status: 500,
            headers: { 'x-request-id': 'first-req-id' },
          })
      )
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch({
      ...makeChatRequest(),
      requestId: 'req-retry-hist',
    });
    const meta = (response as any).plexus;
    const retryHistory = JSON.parse(meta?.retryHistory || '[]');

    expect(retryHistory).toHaveLength(2);
    expect(retryHistory[0]?.status).toBe('failed');
    expect(retryHistory[0]?.providerResponseHeaders?.['x-request-id']).toBe('first-req-id');
    expect(retryHistory[1]?.status).toBe('success');
  });

  test('intermediate failures are saved during failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'first failed'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    const saveErrorSpy = vi.fn();
    const dispatcher = new Dispatcher();
    dispatcher.setUsageStorage({
      saveError: saveErrorSpy,
      recordFailedAttempt: vi.fn(),
      recordSuccessfulAttempt: vi.fn(),
      emitUpdatedAsync: vi.fn(),
    } as any);

    const response = await dispatcher.dispatch({
      ...makeChatRequest(),
      requestId: 'req-intermediate',
    });
    const meta = (response as any).plexus;

    expect(meta?.attemptCount).toBe(2);
    // One call for the intermediate failure, one in the route handler doesn't happen
    // here because dispatch succeeded overall.
    expect(saveErrorSpy).toHaveBeenCalledTimes(1);
    const [savedRequestId, savedError, savedDetails] = saveErrorSpy.mock.calls[0] as any[];
    expect(savedRequestId).toBe('req-intermediate');
    expect(savedError?.routingContext?.statusCode).toBe(500);
    expect(savedDetails?.apiType).toBe('chat');
  });
});
