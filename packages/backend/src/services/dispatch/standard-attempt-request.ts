import type { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import { logger } from '../../utils/logger';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import type { RouteResult } from '../routing/router';
import type { RetryAttemptRecord } from './dispatcher-types';
import type { StallConfig } from '../inspectors/stall-inspector';
import { CooldownManager } from '../runtime/cooldown-manager';
import type { RequestManagerHost } from './request-manager';
import {
  createThinkingSignatureStripState,
  createUnsupportedParamStripState,
  deleteDottedPath,
  planThinkingSignatureStrip,
  planUnsupportedParamStrip,
  stripThinkingSignatureBlocks,
  MAX_THINKING_SIGNATURE_STRIP_RETRIES,
  MAX_UNSUPPORTED_PARAM_STRIP_RETRIES,
} from './dispatcher-auto-compat';
import { EMPTY_COMPLETION_REASON, isEmptyUnifiedResponse } from './empty-completion';

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
  // Mutable (not const): the unsupported-param strip-and-retry path below
  // rebuilds this via copy-on-write (deleteDottedPath) rather than mutating
  // in place, so a successful strip must reassign this binding.
  let providerPayload = context.providerPayload;
  let effectiveStallConfig = initialStallConfig;

  const incomingApi = currentRequest.incomingApiType || 'unknown';
  const url = host.buildRequestUrl(route, transformer, requestWithTargetModel, targetApiType);
  const headers = host.setupHeaders(route, targetApiType, requestWithTargetModel);

  logger.info(
    `Dispatching ${currentRequest.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`
  );

  // Reactive auto-compat: bounded per-target state so a strip-and-retry
  // cycle (see the 400 handling below) can't loop forever (see
  // dispatcher-auto-compat.ts for the matching/bound logic). Two independent
  // mechanisms, two independent budgets — neither resets the other's
  // counter, so the combined worst case for this target is bounded at
  // exactly 1 (initial attempt) + MAX_THINKING_SIGNATURE_STRIP_RETRIES +
  // MAX_UNSUPPORTED_PARAM_STRIP_RETRIES fetches, however the two mechanisms
  // interleave — they can't ping-pong into an unbounded loop.
  const paramStripState = createUnsupportedParamStripState();
  const thinkingStripState = createThinkingSignatureStripState();

  // Looped so a strip-and-retry can redo the fetch against the SAME target
  // without returning to the caller's failover loop — failing over would
  // just hit the same "client sent an unsupported param" problem on the
  // next provider too. Logging the payload inside the loop means a
  // strip-retry's silly-level log reflects the field that was actually
  // removed, not just the original request.
  let response: Response;
  while (true) {
    logger.silly('Upstream Request Payload', providerPayload);

    let stallAbortController: AbortController | undefined;
    let ttfbTimerId: ReturnType<typeof setTimeout> | undefined;
    const dispatchStartTime = Date.now();

    // When TTFB stall detection is configured for streaming requests, wrap
    // the fetch + probe in a single timeout that covers the entire TTFB
    // window (from request dispatch to receiving ttfbBytes of body data).
    // This handles the case where fetch() itself blocks for a long time
    // waiting for HTTP response headers from a slow provider.
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
            host.saveIntermediateError(
              currentRequest.requestId,
              targetApiType || 'chat',
              stallError
            );
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

      // Reactive auto-compat: alias-level failover can replay a conversation
      // whose `thinking`/`redacted_thinking` blocks were signed by a
      // DIFFERENT Claude model/session than the one we're now targeting.
      // Anthropic 400s naming the stale signature specifically — every
      // remaining Claude target would reject the same replayed signature
      // the same way, so strip the thinking blocks and retry the SAME
      // target rather than failing over.
      if (response.status === 400) {
        if (planThinkingSignatureStrip(errorText, providerPayload, thinkingStripState)) {
          const strippedBlockCount = stripThinkingSignatureBlocks(providerPayload);
          logger.warn(
            `Auto-compat: ${route.provider}/${route.model} rejected a stale thinking-block ` +
              `signature — stripped ${strippedBlockCount} thinking block(s) and retrying the ` +
              `same target (attempt ${thinkingStripState.attempts}/${MAX_THINKING_SIGNATURE_STRIP_RETRIES})`
          );
          continue;
        }
      }

      // Reactive auto-compat: some upstreams 400 naming one specific
      // unsupported parameter (e.g. LobeHub's gpt-5.5 traffic sending
      // safety_identifier / prompt_cache_key that a provider rejects).
      // Strip that field and retry the SAME target rather than falling
      // through to normal failover, which wouldn't help — every target
      // would reject the same client-sent field the same way.
      if (response.status === 400) {
        const paramToStrip = planUnsupportedParamStrip(errorText, paramStripState);
        if (paramToStrip) {
          const stripResult = deleteDottedPath(providerPayload, paramToStrip);
          if (stripResult.deleted) {
            providerPayload = stripResult.payload;
            logger.warn(
              `Auto-compat: ${route.provider}/${route.model} rejected unsupported parameter ` +
                `'${paramToStrip}' — stripping it and retrying the same target ` +
                `(attempt ${paramStripState.attempts}/${MAX_UNSUPPORTED_PARAM_STRIP_RETRIES})`
            );
            continue;
          }
          // Nothing was actually removed (a rejected __proto__/constructor/
          // prototype segment, or the named field wasn't present) —
          // resending the SAME payload would just repeat the identical
          // upstream rejection, so fall through to normal failover/error
          // handling below instead of retrying this target again.
        }
      }

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

    break;
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

  // T5: empty-completion failover (see empty-completion.ts). An upstream 200
  // whose transformed completion has zero visible output (no text, tool
  // calls, reasoning, images, or citations) reads as a hard error to clients
  // like LobeHub (`ModelEmptyCompletion`) / KiloCode. Treat it as a
  // retryable target failure so normal failover proceeds to the next
  // candidate — UNLESS this is the last target, in which case the empty
  // response is returned as-is: an empty 200 from every candidate is still a
  // valid upstream answer, so failover-exhaustion semantics must stay
  // unchanged (no conversion into a 5xx).
  //
  // `clientError` is excluded on purpose: some transformers (e.g. Gemini's
  // MALFORMED_FUNCTION_CALL — transformGeminiResponse) deliberately populate
  // a clientError-carrying response with no visible output — a distinct,
  // pre-existing "signal the client directly, no failover, no cooldown"
  // mechanism handled later in response-handler.ts (see its
  // `!unifiedResponse.stream && unifiedResponse.clientError` branch). Letting
  // empty-completion failover fire here would silently discard that specific
  // diagnostic and introduce retries where they were deliberately excluded,
  // so any clientError takes precedence and is never treated as empty.
  const canRetryEmptyCompletion =
    failoverEnabled &&
    hasNextTarget &&
    !nonStreamingResponse.clientError &&
    isEmptyUnifiedResponse(nonStreamingResponse);
  if (canRetryEmptyCompletion) {
    attemptTimeout.cleanup();
    doRelease();
    await host.recordAttemptMetric(route, currentRequest.requestId, false, {
      isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
      isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
      visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
    });
    const emptyCompletionError = new Error(EMPTY_COMPLETION_REASON) as any;
    emptyCompletionError.routingContext = {
      provider: route.provider,
      targetModel: route.model,
      targetApiType,
      statusCode: 200,
      // Not a provider-health issue — the HTTP call itself succeeded, it
      // just carried no visible output — so cooldown must be skipped here,
      // mirroring how caller-errors (400 non-quota, 413, 422) skip
      // CooldownManager.markProviderFailure above.
      cooldownTriggered: false,
    };
    host.appendFailureAttempt(retryHistory, route, emptyCompletionError, targetApiType, true);
    host.saveIntermediateError(
      currentRequest.requestId,
      targetApiType || 'chat',
      emptyCompletionError
    );
    logger.warn(
      `Failover: retrying after empty completion (no visible output) from ${route.provider}/${route.model}`
    );
    return { outcome: 'retry', error: emptyCompletionError };
  }

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
