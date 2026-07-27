import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../runtime/cooldown-manager';
import { EMPTY_COMPLETION_REASON } from '../dispatch/empty-completion';

// T5 — dispatch-level empty-completion failover.
//
// Fixture setup mirrors dispatcher-failover.test.ts (same style: makeConfig
// builds an `in_order` alias with N targets, fetchMock stands in for
// upstream HTTP). Kept in its own file rather than appended to
// dispatcher-failover.test.ts because that file has unrelated in-flight
// changes from other tasks in the working tree.

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

function makeChatRequest(): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream: false,
  };
}

/** A 200 OpenAI chat completion whose message has visible text content. */
function contentChatResponse(model: string, content = 'ok') {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * A 200 OpenAI chat completion with zero visible output: no text, no tool
 * calls, no reasoning. This is the "upstream 200 but empty" case the task
 * targets — e.g. LobeHub `ModelEmptyCompletion` / KiloCode blank replies.
 */
function emptyChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// --- Fix round 2: image_generation_call output is visible output -----------

/**
 * A single-target Responses-API alias config. `api_base_url` uses the
 * record/map form (`{ responses: <url> }`) so getProviderTypes() resolves
 * the 'responses' API type explicitly (mirrors makeAnthropicMessagesConfig's
 * `{ messages: <url> }` / makeGeminiConfig's `{ gemini: <url> }` pattern).
 */
function makeResponsesConfig(options?: { targetCount?: number }) {
  const targetCount = options?.targetCount ?? 2;

  const providers: Record<string, any> = {
    p1: {
      api_base_url: { responses: 'https://p1.example.com' },
      api_key: 'test-key-p1',
      models: { 'model-1': {} },
    },
    p2: {
      api_base_url: { responses: 'https://p2.example.com' },
      api_key: 'test-key-p2',
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
      'responses-alias': {
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

// incomingApiType === targetApiType ('responses') with `originalBody` set
// satisfies shouldUsePassThrough (request-payload-builder.ts) -> bypassTransformation
// true -> dispatcher.ts's handleNonStreamingResponse attaches the ORIGINAL
// parsed body as `unifiedResponse.rawResponse`, which is exactly the seam
// getResponseVisibilitySignals reads image_generation_call items from.
function makeResponsesRequest(): UnifiedChatRequest {
  return {
    model: 'responses-alias',
    messages: [{ role: 'user', content: 'draw a cat' }],
    incomingApiType: 'responses',
    stream: false,
    originalBody: {
      model: 'responses-alias',
      input: 'draw a cat',
    },
  } as any;
}

/** A 200 Responses API completion whose ONLY output item is an image_generation_call — no message, no text. */
function imageOnlyResponsesResponse() {
  return new Response(
    JSON.stringify({
      id: 'resp_img_1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'model-1',
      output: [
        {
          type: 'image_generation_call',
          id: 'ig_1',
          status: 'completed',
          result: 'base64-image-data',
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * A 200 OpenAI chat completion with null content AND a terminal
 * `content_filter` finish reason — a deliberate provider safety decision,
 * not "the model produced nothing". Must NOT be classified as an empty
 * completion (must not fail over to another provider).
 */
function contentFilterChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finish_reason: 'content_filter',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// --- Fix round 1: clientError must take precedence over empty-completion retry ---
//
// transformGeminiResponse (transformers/gemini/response-transformer.ts) sets
// `clientError` on a non-streaming UnifiedChatResponse for Gemini's
// MALFORMED_FUNCTION_CALL defect — a response that also has zero visible
// output (no text, no tool_calls). response-handler.ts's
// `!unifiedResponse.stream && unifiedResponse.clientError` branch signals
// that to the client directly, deliberately WITHOUT failover or cooldown.
// This config/request pair drives a real request through the real
// GeminiTransformer (not the 'chat'/OpenAI one used above) so the fixture
// below exercises production code, not a hand-rolled stand-in.
function makeGeminiConfig(options?: { targetCount?: number }) {
  const targetCount = options?.targetCount ?? 2;

  const providers: Record<string, any> = {
    p1: {
      api_base_url: { gemini: 'https://p1.example.com' },
      api_key: 'test-key-p1',
      models: { 'model-1': {} },
    },
    p2: {
      api_base_url: { gemini: 'https://p2.example.com' },
      api_key: 'test-key-p2',
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
      'gemini-alias': {
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

// Incoming type is deliberately 'chat' (not 'gemini') so selectTargetApiType
// falls through to the only available provider type ('gemini') via the
// normal transform pipeline (bypassTransformation stays false — pass-through
// requires incomingApiType === targetApiType, see shouldUsePassThrough in
// request-payload-builder.ts) — i.e. the REAL GeminiTransformer.transformResponse
// runs on the mocked upstream body below, exactly as production would.
function makeGeminiRequest(): UnifiedChatRequest {
  return {
    model: 'gemini-alias',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'chat',
    stream: false,
  };
}

/**
 * A 200 Gemini response whose only candidate ends in MALFORMED_FUNCTION_CALL
 * — detectGeminiMalformedFunctionCall (utils/gemini-malformed-function-call.ts)
 * fires on finishReason alone, regardless of parts content. Empty `parts`
 * means transformGeminiResponse also produces zero visible output (content
 * null, no tool_calls) — the exact collision this test locks down.
 */
function geminiMalformedFunctionCallResponse() {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'MALFORMED_FUNCTION_CALL',
          content: { parts: [] },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** A normal 200 Gemini response with visible text — used to prove failover would have "worked" if it fired. */
function geminiContentResponse(text = 'ok') {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text }] },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Dispatcher empty-completion failover (T5)', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    setConfigForTesting(makeConfig());
    CooldownManager.resetForTesting();
  });

  test('empty completion (200, no visible output) on target 1 fails over to target 2', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => emptyChatResponse('model-1'))
      .mockImplementationOnce(async () => contentChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta?.attemptCount).toBe(2);
    expect(meta?.finalAttemptProvider).toBe('p2');
    expect(response.content).toBe('ok');

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory).toHaveLength(2);
    expect(retryHistory[0]?.status).toBe('failed');
    expect(retryHistory[0]?.reason).toBe(EMPTY_COMPLETION_REASON);
    expect(retryHistory[0]?.retryable).toBe(true);
    expect(retryHistory[1]?.status).toBe('success');
  });

  test('all targets empty: returns the last empty response as-is (200), does not throw', async () => {
    setConfigForTesting(makeConfig({ targetCount: 3 }));
    fetchMock
      .mockImplementationOnce(async () => emptyChatResponse('model-1'))
      .mockImplementationOnce(async () => emptyChatResponse('model-2'))
      .mockImplementationOnce(async () => emptyChatResponse('model-3'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(meta?.attemptCount).toBe(3);
    expect(meta?.finalAttemptProvider).toBe('p3');
    // Empty completion means the transformed content is null (empty string
    // normalizes to null in the OpenAI chat transformer) — returned as-is,
    // not converted into a 5xx.
    expect(response.content).toBeNull();

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory).toHaveLength(3);
    expect(retryHistory[0]?.status).toBe('failed');
    expect(retryHistory[1]?.status).toBe('failed');
    expect(retryHistory[2]?.status).toBe('success');
  });

  test('single target, empty completion: no next target to fail over to, returns as-is', async () => {
    setConfigForTesting(makeConfig({ targetCount: 1 }));
    fetchMock.mockImplementationOnce(async () => emptyChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.attemptCount).toBe(1);
    expect(response.content).toBeNull();

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory).toHaveLength(1);
    expect(retryHistory[0]?.status).toBe('success');
  });

  test('empty-completion failover does NOT trigger provider cooldown', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => emptyChatResponse('model-1'))
      .mockImplementationOnce(async () => contentChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const cm = CooldownManager.getInstance();
    await cm.clearCooldown();

    await dispatcher.dispatch(makeChatRequest());

    // p1 returned an empty completion (not a provider health failure) — it
    // must not be on cooldown, mirroring how caller-errors (400 non-quota,
    // 413, 422) skip markProviderFailure.
    const cooldowns = cm.getCooldowns();
    expect(cooldowns).toHaveLength(0);
  });

  test('no failover when failover is disabled: empty completion from the only target returns as-is', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2, failoverEnabled: false }));
    fetchMock.mockImplementation(async () => emptyChatResponse('model-1'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.content).toBeNull();
  });

  test('intermediate empty-completion failure is saved during failover', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => emptyChatResponse('model-1'))
      .mockImplementationOnce(async () => contentChatResponse('model-2'));

    const saveErrorSpy = vi.fn();
    const dispatcher = new Dispatcher();
    dispatcher.setUsageStorage({
      saveError: saveErrorSpy,
      recordFailedAttempt: vi.fn(),
      recordSuccessfulAttempt: vi.fn(),
      emitUpdatedAsync: vi.fn(),
    } as any);

    await dispatcher.dispatch({ ...makeChatRequest(), requestId: 'req-empty-intermediate' });

    expect(saveErrorSpy).toHaveBeenCalledTimes(1);
    const [savedRequestId, savedError] = saveErrorSpy.mock.calls[0] as any[];
    expect(savedRequestId).toBe('req-empty-intermediate');
    expect(savedError?.message).toBe(EMPTY_COMPLETION_REASON);
  });

  test('a clientError-carrying response (e.g. Gemini MALFORMED_FUNCTION_CALL) is NEVER retried as an empty completion, even with a next target available', async () => {
    setConfigForTesting(makeGeminiConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => geminiMalformedFunctionCallResponse())
      .mockImplementationOnce(async () => geminiContentResponse());

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeGeminiRequest());
    const meta = (response as any).plexus;

    // A single fetch call proves NO failover happened — target 2 (which
    // would have returned visible content) was never reached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');

    // The response still has zero visible output (this is precisely why the
    // bug existed: isEmptyUnifiedResponse alone would say "empty") AND still
    // carries clientError intact for response-handler.ts's dedicated
    // no-failover/no-cooldown handling to pick up downstream.
    expect(response.content).toBeNull();
    expect(response.tool_calls).toBeUndefined();
    expect(response.clientError?.statusCode).toBe(503);
    expect(response.clientError?.code).toBe('MALFORMED_FUNCTION_CALL');

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory).toHaveLength(1);
    expect(retryHistory[0]?.status).toBe('success');
  });

  // --- Fix round 2: terminal finish reasons must never be classified empty ---
  test('a content_filter completion (null content, terminal finish reason) is NEVER retried as an empty completion, even with a next target available', async () => {
    setConfigForTesting(makeConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => contentFilterChatResponse('model-1'))
      .mockImplementationOnce(async () => contentChatResponse('model-2'));

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeChatRequest());
    const meta = (response as any).plexus;

    // A single fetch call proves NO failover happened — target 2 (which
    // would have returned visible content) was never reached: routing
    // around a content-filter decision via failover would be exactly the
    // bug this guards against.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');
    expect(response.content).toBeNull();
    expect(response.finishReason).toBe('content_filter');

    const retryHistory = JSON.parse(meta?.retryHistory || '[]');
    expect(retryHistory).toHaveLength(1);
    expect(retryHistory[0]?.status).toBe('success');
  });

  test('an image_generation_call-only Responses API completion is NEVER retried as an empty completion, even with a next target available', async () => {
    setConfigForTesting(makeResponsesConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => imageOnlyResponsesResponse())
      .mockImplementationOnce(async () => {
        throw new Error('should not be called — failing over here would be the bug');
      });

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeResponsesRequest());
    const meta = (response as any).plexus;

    // A single fetch call proves NO failover happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');
  });

  test('an image_generation_call-only completion on the TRANSFORMED path (chat client -> responses provider) is not retried as empty', async () => {
    setConfigForTesting(makeResponsesConfig({ targetCount: 2 }));
    fetchMock
      .mockImplementationOnce(async () => imageOnlyResponsesResponse())
      .mockImplementationOnce(async () => {
        throw new Error('should not be called — failing over here would be the bug');
      });

    const dispatcher = new Dispatcher();
    // A CHAT-format client request against the responses-target alias:
    // incoming 'chat' !== target 'responses' means NO passthrough/bypass, so
    // the unified response is the TRANSFORMED one — PURE content (null, no
    // baked image markdown), typed `image_generation_calls`, no rawResponse.
    // The typed empty-completion signal is the only thing keeping this from
    // being misclassified as empty and failed over.
    const response = await dispatcher.dispatch({
      model: 'responses-alias',
      messages: [{ role: 'user', content: 'draw a cat' }],
      incomingApiType: 'chat',
      stream: false,
    } as UnifiedChatRequest);
    const meta = (response as any).plexus;

    // A single fetch call proves NO failover happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meta?.attemptCount).toBe(1);
    expect(meta?.finalAttemptProvider).toBe('p1');
    // Transformed path, not bypass: pure content + typed carry.
    expect(response.bypassTransformation).toBeUndefined();
    expect(response.content).toBeNull();
    expect(response.image_generation_calls?.[0]?.result).toBe('base64-image-data');
  });
});
