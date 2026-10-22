import { describe, expect, it, vi } from 'vitest';

import type { RequestManagerHost } from '../dispatch/request-manager';
import { executeStandardAttempt } from '../dispatch/standard-attempt-request';
import type { RouteResult } from '../routing/router';

function makeRoute(): RouteResult {
  return {
    provider: 'metasub',
    model: 'muse-spark-1.3-contributor',
    config: {
      discount: 0,
      models: {
        'muse-spark-1.3-contributor': { pricing: { source: 'simple', input: 1, output: 2 } },
        'muse-spark-1.3': { pricing: { source: 'simple', input: 10, output: 20 } },
      },
    } as any,
    modelConfig: { pricing: { source: 'simple', input: 1, output: 2 } } as any,
  } as RouteResult;
}

function makeHost(overrides: Partial<RequestManagerHost> = {}): RequestManagerHost {
  return {
    appendFailureAttempt: vi.fn(),
    appendSkippedAttempt: vi.fn(),
    appendSuccessAttempt: vi.fn(
      (history: any[], route: any, apiType?: string, upstream?: string) => {
        history.push({
          index: history.length + 1,
          provider: route.provider,
          model: route.model,
          upstreamModel: upstream,
          apiType,
          status: 'success',
          reason: 'Request completed successfully',
          retryable: false,
        });
      }
    ),
    attachAttemptMetadata: vi.fn(
      (response: any, _a: any, _h: any, route: any, _t: any, upstream?: string) => {
        response.plexus = {
          ...(response.plexus || {}),
          finalAttemptModel: route.model,
          upstreamModel: upstream,
        };
      }
    ),
    buildAllTargetsFailedError: vi.fn(() => new Error('all failed')),
    buildCancelledError: vi.fn(() => new Error('cancelled')),
    buildRequestUrl: vi.fn(() => 'https://example.test/v1/chat/completions'),
    buildTimeoutError: vi.fn(() => new Error('timeout')),
    createAttemptTimeout: vi.fn(),
    dispatchImageGenerations: vi.fn(async () => ({}) as any),
    emitRoutingUpdate: vi.fn(),
    executeProviderRequest: vi.fn(async () => new Response('{"id":"x"}', { status: 200 })),
    formatFailureReason: vi.fn((e: any) => e?.message ?? 'error'),
    getUsageStorage: vi.fn(() => undefined),
    handleNonStreamingResponse: vi.fn(async () => ({ content: 'ok' }) as any),
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

describe('dispatcher model_override metadata (issue #916)', () => {
  it('fetched payload, plexus.upstreamModel, and retry entry agree while finalAttemptModel stays route', async () => {
    const route = makeRoute();
    const request: any = {
      requestId: 'req-916',
      model: 'muse-spark-1.3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      incomingApiType: 'chat',
    };
    // Post-adapter payload: model_override rewrote contributor -> full model
    const providerPayload = { model: 'muse-spark-1.3' };
    let capturedFetchModel: string | undefined;
    const executeProviderRequest = vi.fn(async (_url: any, _h: any, payload: any) => {
      capturedFetchModel = payload?.model;
      return new Response('{"id":"x"}', { status: 200 });
    });
    const host = makeHost({ executeProviderRequest });
    const retryHistory: any[] = [];
    const attemptedProviders = ['metasub/muse-spark-1.3-contributor'];

    const result = await executeStandardAttempt({
      host,
      providerPayload,
      request,
      requestWithTargetModel: request,
      route,
      targetApiType: 'chat',
      transformer: { name: 't' },
      bypassTransformation: false,
      adapters: [],
      attemptTimeout: {
        signal: new AbortController().signal,
        isTimedOut: () => false,
        cleanup: vi.fn(),
      },
      failoverEnabled: false,
      hasNextTarget: false,
      retryableStatusCodes: [],
      retryableErrors: [],
      retryHistory,
      attemptedProviders,
      sessionKey: null,
      release: vi.fn(),
    });

    expect(result.outcome).toBe('success');
    expect(capturedFetchModel).toBe('muse-spark-1.3');
    expect(host.appendSuccessAttempt).toHaveBeenCalledWith(
      retryHistory,
      route,
      'chat',
      'muse-spark-1.3'
    );
    expect(host.attachAttemptMetadata).toHaveBeenCalledWith(
      expect.anything(),
      attemptedProviders,
      retryHistory,
      route,
      'chat',
      'muse-spark-1.3'
    );
    expect(retryHistory[0].model).toBe('muse-spark-1.3-contributor');
    expect(retryHistory[0].upstreamModel).toBe('muse-spark-1.3');
    expect((result as any).response.plexus.finalAttemptModel).toBe('muse-spark-1.3-contributor');
    expect((result as any).response.plexus.upstreamModel).toBe('muse-spark-1.3');
  });
});
