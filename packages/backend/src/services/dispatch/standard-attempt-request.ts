import type { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import { logger } from '../../utils/logger';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import type { RouteResult } from '../routing/router';
import type { RetryAttemptRecord } from './dispatcher-types';
import type { StallConfig } from '../inspectors/stall-inspector';
import { CooldownManager } from '../runtime/cooldown-manager';
import type { RequestManagerHost } from './request-manager';

export type StandardAttemptResult =
  | { outcome: 'success'; response: UnifiedChatResponse }
  | { outcome: 'retry'; error: any };

export interface StandardAttemptContext {
  host: RequestManagerHost;
  providerPayload: any;
  request: UnifiedChatRequest;
  requestWithTargetModel: UnifiedChatRequest;
  route: RouteResult;
  targetApiType: string;
  transformer: any;
  bypassTransformation: boolean;
  adapters: ResolvedAdapter[];
  signal?: AbortSignal;
  stallConfig?: StallConfig | null;
  attemptTimeout: { signal: AbortSignal; isTimedOut: () => boolean; cleanup: () => void };
  failoverEnabled: boolean;
  hasNextTarget: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
  retryHistory: RetryAttemptRecord[];
  attemptedProviders: string[];
  sessionKey: string | null;
  release: () => void;
}

/** Executes a regular HTTP provider attempt and reports whether failover should continue. */
export async function executeStandardAttempt(
  context: StandardAttemptContext
): Promise<StandardAttemptResult> {
  const {
    host,
    providerPayload,
    request: currentRequest,
    requestWithTargetModel,
    route,
    targetApiType,
    transformer,
    bypassTransformation,
    adapters,
    signal,
    stallConfig: initialStallConfig,
    attemptTimeout,
    failoverEnabled,
    hasNextTarget,
    retryableStatusCodes,
    retryableErrors,
    retryHistory,
    attemptedProviders,
    sessionKey,
    release: doRelease,
  } = context;
  let effectiveStallConfig = initialStallConfig;

  const incomingApi = currentRequest.incomingApiType || 'unknown';
  const url = host.buildRequestUrl(route, transformer, requestWithTargetModel, targetApiType);
  const headers = host.setupHeaders(route, targetApiType, requestWithTargetModel);

  logger.info(
    `Dispatching ${currentRequest.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`
  );

  logger.silly('Upstream Request Payload', providerPayload);

  // When TTFB stall detection is configured for streaming requests, wrap
  // the fetch + probe in a single timeout that covers the entire TTFB
  // window (from request dispatch to receiving ttfbBytes of body data).
  // This handles the case where fetch() itself blocks for a long time
  // waiting for HTTP response headers from a slow provider.
  let response: Response;
  let stallAbortController: AbortController | undefined;
  let ttfbTimerId: ReturnType<typeof setTimeout> | undefined;
  const dispatchStartTime = Date.now();

  if (currentRequest.stream && effectiveStallConfig?.ttfbMs != null) {
    // Create a separate AbortController for the TTFB stall timeout.
    // We don't use the route's abortController because an abort there
    // means the client disconnected — we need a distinct signal for
    // "provider is too slow to start responding".
    stallAbortController = new AbortController();
    const combinedSignal = AbortSignal.any([attemptTimeout.signal, stallAbortController.signal]);

    const ttfbMs = effectiveStallConfig.ttfbMs!;
    ttfbTimerId = setTimeout(() => {
      stallAbortController!.abort(
        new DOMException(
          `Stream stalled: TTFB timeout — no response within ${ttfbMs}ms`,
          'TimeoutError'
        )
      );
    }, ttfbMs);
    ttfbTimerId.unref?.();

    try {
      response = await host.executeProviderRequest(url, headers, providerPayload, combinedSignal);
    } catch (fetchError: any) {
      // Client disconnected takes priority over stall detection —
      // if the client is gone, no point retrying.
      if (signal?.aborted) {
        clearTimeout(ttfbTimerId);
        throw host.buildCancelledError(signal);
      }

      // If the error was caused by our TTFB stall timeout, synthesize
      // a stall result instead of treating it as a generic network error.
      if (stallAbortController.signal.aborted) {
        clearTimeout(ttfbTimerId);
        const stallError = new Error(
          `Stream stalled: TTFB timeout — no response within ${ttfbMs}ms`
        );

        const canRetryStall =
          failoverEnabled &&
          hasNextTarget &&
          (host.isRetryableNetworkError(stallError, retryableErrors) ||
            stallError.message?.includes('stalled'));

        if (canRetryStall) {
          attemptTimeout.cleanup();
          await host.recordAttemptMetric(route, currentRequest.requestId, false, {
            isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
            isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
            visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
          });
          host.appendFailureAttempt(retryHistory, route, stallError, targetApiType, true);
          CooldownManager.getInstance().markProviderStallFailure(
            route.provider,
            route.model,
            host.formatFailureReason(stallError)
          );
          host.saveIntermediateError(currentRequest.requestId, targetApiType || 'chat', stallError);
          logger.info(
            `TTFB stall: fetch timed out after ${ttfbMs}ms for ${route.provider}/${route.model}, retrying with next provider`
          );
          doRelease();
          return { outcome: 'retry', error: stallError };
        }
        doRelease();
        throw stallError;
      }
      throw fetchError;
    }

    // Fetch returned — clear the TTFB timer (we beat the timeout)
    clearTimeout(ttfbTimerId);
    ttfbTimerId = undefined;

    // Adjust the stall config's ttfbMs for the probe — subtract the time
    // already spent waiting for fetch() to return. The probe only needs
    // to cover the remaining time until the byte threshold is met.
    const fetchElapsed = Date.now() - dispatchStartTime;
    const remainingTtfbMs = Math.max(0, ttfbMs - fetchElapsed);
    if (remainingTtfbMs <= 0 && effectiveStallConfig) {
      // Fetch returned just barely within the TTFB window — no time left
      // for the probe. Skip the probe and let the pipeline handle it.
      effectiveStallConfig = { ...effectiveStallConfig, ttfbMs: null };
    } else if (effectiveStallConfig) {
      effectiveStallConfig = { ...effectiveStallConfig, ttfbMs: remainingTtfbMs };
    }
  } else {
    response = await host.executeProviderRequest(
      url,
      headers,
      providerPayload,
      attemptTimeout.signal
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    const canRetry =
      failoverEnabled &&
      hasNextTarget &&
      host.isRetryableStatus(response.status, retryableStatusCodes);

    try {
      await host.handleProviderError(
        response,
        route,
        errorText,
        url,
        headers,
        targetApiType,
        currentRequest.requestId
      );
    } catch (e: any) {
      if (signal?.aborted) throw host.buildCancelledError(signal);
      host.appendFailureAttempt(retryHistory, route, e, targetApiType, canRetry);

      if (canRetry) {
        attemptTimeout.cleanup();
        doRelease();
        await host.recordAttemptMetric(route, currentRequest.requestId, false, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });
        // Only mark as failed if the error actually triggered a cooldown (i.e., it's not a caller error like validation)
        // Caller errors (400 validation errors, 413, 422) should not cause cooldown
        if (e?.routingContext?.cooldownTriggered) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(e, true)
          );
        }
        host.saveIntermediateError(currentRequest.requestId, targetApiType || 'chat', e);
        logger.warn(
          `Failover: retrying after HTTP ${response.status} from ${route.provider}/${route.model}`
        );
        return { outcome: 'retry', error: e };
      }

      doRelease();
      throw e;
    }
  }

  // 5. Handle Response
  if (currentRequest.stream) {
    // effectiveStallConfig was already computed before the fetch above.
    // If TTFB stall is still active (fetch returned within TTFB but body
    // hasn't met the byte threshold yet), the probe will continue checking.
    const streamProbe = await host.probeStreamingStart(response, effectiveStallConfig);

    if (!streamProbe.ok) {
      const error = streamProbe.error;

      const canRetry =
        failoverEnabled &&
        hasNextTarget &&
        !streamProbe.streamStarted &&
        (host.isRetryableNetworkError(error, retryableErrors) ||
          error.message?.includes('stalled'));

      if (canRetry) {
        attemptTimeout.cleanup();
        await host.recordAttemptMetric(route, currentRequest.requestId, false, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });
        host.appendFailureAttempt(retryHistory, route, error, targetApiType, true);
        if (error.message?.includes('stalled')) {
          CooldownManager.getInstance().markProviderStallFailure(
            route.provider,
            route.model,
            host.formatFailureReason(error)
          );
        } else {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            host.formatFailureReason(error)
          );
        }
        host.saveIntermediateError(currentRequest.requestId, targetApiType || 'chat', error);
        logger.warn(
          `Failover: retrying stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
        );
        doRelease();
        return { outcome: 'retry', error };
      }

      doRelease();
      throw error;
    }

    const streamResponse = host.handleStreamingResponse(
      streamProbe.response,
      currentRequest,
      route,
      targetApiType,
      bypassTransformation,
      adapters
    );

    // Wrap the stream to release the concurrency slot when the stream
    // is fully consumed, cancelled, or errors out. Without this, the
    // slot would never be released for streaming responses.
    if (streamResponse.stream) {
      const originalStream = streamResponse.stream;
      const reader = originalStream.getReader();
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          reader.releaseLock();
          doRelease();
        }
      };
      streamResponse.stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              release();
            } else {
              controller.enqueue(value);
            }
          } catch (e) {
            controller.error(e);
            release();
          }
        },
        cancel(reason) {
          release();
          return originalStream.cancel(reason);
        },
      });
    }

    await host.recordAttemptMetric(route, currentRequest.requestId, true, {
      isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
      isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
      visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
    });
    CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
    host.recordStickySession(sessionKey, route, currentRequest);
    host.appendSuccessAttempt(retryHistory, route, targetApiType);
    host.attachAttemptMetadata(
      streamResponse,
      attemptedProviders,
      retryHistory,
      route,
      targetApiType
    );
    attemptTimeout.cleanup();
    return { outcome: 'success', response: streamResponse };
  }

  const nonStreamingResponse = await host.handleNonStreamingResponse(
    response,
    currentRequest,
    route,
    targetApiType,
    transformer,
    bypassTransformation,
    adapters
  );
  await host.recordAttemptMetric(route, currentRequest.requestId, true, {
    isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
    isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
    visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
  });

  if ((currentRequest as any)._isVisionDescriptorRequest && host.getUsageStorage()) {
    // ... (this part is fine)
  }

  CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
  host.recordStickySession(sessionKey, route, currentRequest);
  host.appendSuccessAttempt(retryHistory, route, targetApiType);
  host.attachAttemptMetadata(
    nonStreamingResponse,
    attemptedProviders,
    retryHistory,
    route,
    targetApiType
  );
  doRelease();
  attemptTimeout.cleanup();
  return { outcome: 'success', response: nonStreamingResponse };
}
