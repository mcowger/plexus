import { describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import {
  deriveProbeStallConfig,
  executeStandardAttempt,
  type StandardAttemptContext,
} from '../standard-attempt-request';
import { isRetryableStatus, isRetryableOAuthError } from '../failover-policy';
import type { RequestManagerHost } from '../request-manager';
import type { RouteResult } from '../../routing/router';
import type { UnifiedChatRequest } from '../../../types/unified';
import type { StallConfig } from '../../inspectors/stall-inspector';

function makeStallConfig(overrides: Partial<StallConfig> = {}): StallConfig {
  return {
    ttfbMs: 5000,
    ttfbBytes: 1024,
    minBytesPerSecond: null,
    windowMs: 1000,
    gracePeriodMs: 0,
    ...overrides,
  };
}

describe('deriveProbeStallConfig', () => {
  it('returns the pristine config unchanged when no fetch time has elapsed', () => {
    const pristine = makeStallConfig({ ttfbMs: 5000 });
    expect(deriveProbeStallConfig(pristine, 0)).toEqual(pristine);
  });

  it('nulls out ttfbMs once elapsed time meets or exceeds the full budget', () => {
    const pristine = makeStallConfig({ ttfbMs: 5000 });
    expect(deriveProbeStallConfig(pristine, 5000)).toEqual({ ...pristine, ttfbMs: null });
    expect(deriveProbeStallConfig(pristine, 6000)).toEqual({ ...pristine, ttfbMs: null });
  });

  it('reduces ttfbMs by the elapsed time for a partial budget', () => {
    const pristine = makeStallConfig({ ttfbMs: 5000 });
    expect(deriveProbeStallConfig(pristine, 4900)).toEqual({ ...pristine, ttfbMs: 100 });
  });

  it('passes a null/undefined pristine config through unchanged', () => {
    expect(deriveProbeStallConfig(null, 1000)).toBeNull();
    expect(deriveProbeStallConfig(undefined, 1000)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dispatch-level seam: `host.probeStreamingStart` is the injected "probe
// config receiver" — executeStandardAttempt calls it exactly once, after the
// same-target strip-and-retry while(true) loop breaks, with whatever
// `effectiveStallConfig` the FINAL iteration computed. That makes it the
// only clean spy-able point to prove which ttfbMs budget a given iteration
// actually derived from (there is no host method that observes the *armed*
// per-iteration TTFB timer directly — it's a local `setTimeout`, not passed
// through the host).
// ---------------------------------------------------------------------------

function makeRoute(): RouteResult {
  return { provider: 'p1', model: 'model-1', config: {} as any } as RouteResult;
}

function makeStreamingRequest(): UnifiedChatRequest {
  return {
    requestId: 'req-1',
    model: 'model-1',
    messages: [{ role: 'user', content: 'hi' } as any],
    stream: true,
    incomingApiType: 'chat',
  };
}

function makeHost(overrides: Partial<RequestManagerHost> = {}): RequestManagerHost {
  return {
    appendFailureAttempt: vi.fn(),
    appendSkippedAttempt: vi.fn(),
    appendSuccessAttempt: vi.fn(),
    attachAttemptMetadata: vi.fn(),
    buildAllTargetsFailedError: vi.fn(() => new Error('all targets failed')),
    buildCancelledError: vi.fn(() => new Error('cancelled')),
    buildRequestUrl: vi.fn(() => 'https://example.test/v1/chat/completions'),
    buildTimeoutError: vi.fn(() => new Error('timeout')),
    createAttemptTimeout: vi.fn(),
    emitRoutingUpdate: vi.fn(),
    executeProviderRequest: vi.fn(),
    formatFailureReason: vi.fn((error: any) => error?.message ?? 'error'),
    getUsageStorage: vi.fn(() => undefined),
    handleNonStreamingResponse: vi.fn(async () => ({}) as any),
    handleProviderError: vi.fn(),
    handleStreamingResponse: vi.fn(() => ({}) as any),
    isPiAiRoute: vi.fn(() => false),
    isRetryableNetworkError: vi.fn(() => false),
    isRetryableStatus: vi.fn(() => false),
    probeStreamingStart: vi.fn(),
    recordAttemptMetric: vi.fn(async () => {}),
    recordStickySession: vi.fn(),
    saveIntermediateError: vi.fn(),
    selectTargetApiType: vi.fn(() => ({ selectionReason: 'test' })),
    setupHeaders: vi.fn(() => ({})),
    transformRequestPayload: vi.fn(async () => ({ payload: {}, bypassTransformation: false })),
    ...overrides,
  };
}

describe('executeStandardAttempt — per-fetch TTFB budget reset', () => {
  it("gives a same-target strip-and-retry attempt the full pristine TTFB budget instead of the previous attempt's reduced one", async () => {
    const dateSpy = registerSpy(Date, 'now');
    // Sequence matches the exact Date.now() read sites for this scenario:
    // iter1 dispatchStartTime, iter1 post-fetch (fetchElapsed calc), iter2
    // dispatchStartTime, iter2 post-fetch (fetchElapsed calc). The strip
    // path taken between iter1 and iter2 doesn't call Date.now() itself, and
    // the synthetic probeStreamingStart failure below short-circuits the
    // function before any later (CooldownManager-driven) Date.now() calls.
    dateSpy
      .mockReturnValueOnce(1_000_000) // iter1 dispatchStartTime
      .mockReturnValueOnce(1_004_900) // iter1 post-fetch => fetchElapsed 4900ms (near the 5000ms budget)
      .mockReturnValueOnce(2_000_000) // iter2 dispatchStartTime
      .mockReturnValueOnce(2_000_050); // iter2 post-fetch => fetchElapsed 50ms

    const badRequestResponse = new Response(
      JSON.stringify({ error: { message: "Unsupported parameter: 'safety_identifier'" } }),
      { status: 400 }
    );
    const okResponse = new Response(null, { status: 200 });

    const executeProviderRequest = vi
      .fn()
      .mockResolvedValueOnce(badRequestResponse)
      .mockResolvedValueOnce(okResponse);

    const probeStopError = new Error('test-stop-after-probe');
    const probeStreamingStart = vi.fn().mockResolvedValue({
      ok: false,
      streamStarted: true,
      error: probeStopError,
    });

    const host = makeHost({ executeProviderRequest, probeStreamingStart });
    const route = makeRoute();
    const request = makeStreamingRequest();

    // originalBody-less payload carrying the exact field the synthetic 400
    // names, so planUnsupportedParamStrip's paired deleteDottedPath actually
    // removes something (`deleted: true`) — otherwise the strip is refused
    // and the loop falls through to normal failover instead of retrying the
    // same target, which is the scenario this test needs.
    const providerPayload = { model: 'model-1', safety_identifier: 'abc' };

    const context: StandardAttemptContext = {
      host,
      providerPayload,
      request,
      requestWithTargetModel: request,
      route,
      targetApiType: 'chat',
      transformer: { name: 'test-transformer' },
      bypassTransformation: false,
      adapters: [],
      stallConfig: makeStallConfig({ ttfbMs: 5000 }),
      attemptTimeout: {
        signal: new AbortController().signal,
        isTimedOut: () => false,
        cleanup: vi.fn(),
      },
      failoverEnabled: true,
      hasNextTarget: true,
      retryableStatusCodes: [500, 502, 503],
      retryableErrors: [],
      retryHistory: [],
      attemptedProviders: [],
      sessionKey: null,
      release: vi.fn(),
    };

    await expect(executeStandardAttempt(context)).rejects.toThrow('test-stop-after-probe');

    // Same target dispatched twice: the initial attempt, then the
    // strip-and-retry after the 400.
    expect(executeProviderRequest).toHaveBeenCalledTimes(2);
    expect(probeStreamingStart).toHaveBeenCalledTimes(1);

    const [, receivedStallConfig] = probeStreamingStart.mock.calls[0]!;
    // Pristine ttfbMs is 5000ms. Iteration 2's own fetch took 50ms (per the
    // Date.now() sequence above), so a correctly-reset budget leaves
    // 4950ms for the probe. Before the fix, iteration 2 inherited
    // iteration 1's already-reduced ttfbMs (100ms, left over from a
    // 4900ms first fetch against the same 5000ms budget) and derived only
    // 50ms from THAT — starving the probe of nearly its whole budget.
    expect(receivedStallConfig.ttfbMs).toBe(4950);
  });
});

describe('executeStandardAttempt — thinking-signature strip-and-retry', () => {
  const signature400Body = JSON.stringify({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'messages.3.content.0: Invalid `signature` in `thinking` block',
    },
  });

  function makeNonStreamingRequest(): UnifiedChatRequest {
    return {
      requestId: 'req-1',
      model: 'model-1',
      messages: [{ role: 'user', content: 'hi' } as any],
      stream: false,
      incomingApiType: 'chat',
    };
  }

  function makeContext(
    host: RequestManagerHost,
    providerPayload: any,
    overrides: Partial<StandardAttemptContext> = {}
  ): StandardAttemptContext {
    const request = makeNonStreamingRequest();
    return {
      host,
      providerPayload,
      request,
      requestWithTargetModel: request,
      route: makeRoute(),
      targetApiType: 'messages',
      transformer: { name: 'test-transformer' },
      bypassTransformation: false,
      adapters: [],
      stallConfig: null,
      attemptTimeout: {
        signal: new AbortController().signal,
        isTimedOut: () => false,
        cleanup: vi.fn(),
      },
      failoverEnabled: true,
      hasNextTarget: true,
      retryableStatusCodes: [500, 502, 503],
      retryableErrors: [],
      retryHistory: [],
      attemptedProviders: [],
      sessionKey: null,
      release: vi.fn(),
      ...overrides,
    };
  }

  it('does not retry the same target when a signature-matching 400 hits a payload with no thinking blocks (single fetch, normal failover)', async () => {
    // Fresh Response per call: a Response body is single-read, so a shared
    // instance would throw on a second (buggy) fetch's .text() and mask the
    // real assertion failure.
    const executeProviderRequest = vi.fn(
      async () => new Response(signature400Body, { status: 400 })
    );
    const handleProviderError = vi.fn(async () => {
      throw new Error('HTTP 400: invalid signature');
    });
    const isRetryableStatus = vi.fn(() => true);
    const host = makeHost({ executeProviderRequest, handleProviderError, isRetryableStatus });

    // The known false-positive shape: an OpenAI-chat-format payload also has
    // a `messages` array (so the structural Anthropic-payload check matches)
    // but carries NO thinking blocks — a strip would remove zero blocks and
    // a retry would resend a byte-identical request.
    const providerPayload = {
      model: 'model-1',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const snapshot = structuredClone(providerPayload);

    const result = await executeStandardAttempt(makeContext(host, providerPayload));

    // Normal failover proceeds (retry outcome hands control back to the
    // caller's next-target loop)...
    expect(result.outcome).toBe('retry');
    // ...but the SAME target was fetched exactly once: the zero-block strip
    // must not burn a same-target retry on an identical payload.
    expect(executeProviderRequest).toHaveBeenCalledTimes(1);
    // Nothing was stripped, so the payload is untouched.
    expect(providerPayload).toEqual(snapshot);
  });

  it('strips thinking blocks copy-on-write on a genuine signature 400: original payload object never mutated, retried payload stripped', async () => {
    const executeProviderRequest = vi
      .fn()
      .mockImplementationOnce(async () => new Response(signature400Body, { status: 400 }))
      .mockImplementationOnce(async () => new Response('{"id":"msg_1"}', { status: 200 }));
    const handleNonStreamingResponse = vi.fn(async () => ({ content: 'ok' }) as any);
    const host = makeHost({ executeProviderRequest, handleNonStreamingResponse });

    const providerPayload = {
      model: 'model-1',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'stale', signature: 'sig-a' },
            { type: 'text', text: 'answer' },
          ],
        },
      ],
    };
    const snapshot = structuredClone(providerPayload);

    const result = await executeStandardAttempt(makeContext(host, providerPayload));

    expect(result.outcome).toBe('success');
    expect(executeProviderRequest).toHaveBeenCalledTimes(2);

    // First fetch sent the original payload object...
    expect(executeProviderRequest.mock.calls[0]![2]).toBe(providerPayload);
    // ...the same-target retry sent a NEW payload with the blocks stripped...
    const retriedPayload = executeProviderRequest.mock.calls[1]![2];
    expect(retriedPayload).not.toBe(providerPayload);
    expect(retriedPayload.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ]);
    // ...and the ORIGINAL payload (which can share `messages` with the
    // long-lived request) was never mutated in place.
    expect(providerPayload).toEqual(snapshot);
  });

  it('retries on early stream error from probeStreamingStart', async () => {
    const executeProviderRequest = vi.fn(
      async () =>
        new Response('data: {"error":{"code":429,"message":"Rate limit"}}\n\n', { status: 200 })
    );
    const streamError = new Error('openai/gpt-5.6-luna is temporarily rate-limited upstream');
    (streamError as any).isStreamError = true;
    (streamError as any).statusCode = 429;
    (streamError as any).cooldownDuration = 30000;

    const probeStreamingStart = vi.fn().mockResolvedValue({
      ok: false,
      error: streamError,
      streamStarted: false,
    });
    const host = makeHost({ executeProviderRequest, probeStreamingStart });

    const request = makeStreamingRequest();
    const result = await executeStandardAttempt(
      makeContext(host, {}, { request, requestWithTargetModel: request, targetApiType: 'chat' })
    );
    expect(result.outcome).toBe('retry');
    expect(host.appendFailureAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      streamError,
      'chat',
      true
    );
  });
});

describe('failover-policy 402 status code handling', () => {
  it('treats 402 Payment Required as retryable regardless of configured retryable status codes', () => {
    expect(isRetryableStatus(402, [])).toBe(true);
    expect(isRetryableStatus(402, [500, 502])).toBe(true);
    expect(isRetryableStatus(500, [500])).toBe(true);
    expect(isRetryableStatus(400, [500])).toBe(false);
  });

  it('treats 402 Payment Required as retryable for OAuth errors', () => {
    expect(isRetryableOAuthError({ status: 402, message: 'Low balance' })).toBe(true);
    expect(isRetryableOAuthError({ statusCode: 402, message: 'Payment required' })).toBe(true);
    expect(isRetryableOAuthError({ status: 429, message: 'Rate limit' })).toBe(true);
    expect(isRetryableOAuthError({ status: 401, message: 'Unauthorized' })).toBe(false);
  });
});
