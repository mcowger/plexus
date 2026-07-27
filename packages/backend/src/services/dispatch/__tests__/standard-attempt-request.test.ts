import { describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import {
  deriveProbeStallConfig,
  executeStandardAttempt,
  type StandardAttemptContext,
} from '../standard-attempt-request';
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
