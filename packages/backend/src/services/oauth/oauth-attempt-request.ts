import type { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import { logger } from '../../utils/logger';
import type { RouteResult } from '../routing/router';
import type { RetryAttemptRecord } from '../dispatch/dispatcher-types';
import type { StallConfig } from '../inspectors/stall-inspector';
import { CooldownManager } from '../runtime/cooldown-manager';
import type { RequestManagerHost } from '../dispatch/request-manager';

export type OAuthAttemptResult =
  | { outcome: 'success'; response: UnifiedChatResponse }
  | { outcome: 'retry'; error: any };

export interface OAuthAttemptContext {
  host: RequestManagerHost;
  providerPayload: any;
  request: UnifiedChatRequest;
  route: RouteResult;
  targetApiType: string;
  transformer: any;
  signal?: AbortSignal;
  stallConfig?: StallConfig | null;
  attemptTimeout: { signal: AbortSignal; isTimedOut: () => boolean; cleanup: () => void };
  failoverEnabled: boolean;
  hasNextTarget: boolean;
  retryHistory: RetryAttemptRecord[];
  attemptedProviders: string[];
  sessionKey: string | null;
  release: () => void;
}

/** Executes an OAuth-backed attempt and reports whether the candidate loop should continue. */
export async function executeOAuthAttempt(
  context: OAuthAttemptContext
): Promise<OAuthAttemptResult> {
  const {
    host,
    providerPayload,
    request,
    route,
    targetApiType,
    transformer,
    signal,
    stallConfig,
    attemptTimeout,
    failoverEnabled,
    hasNextTarget,
    retryHistory,
    attemptedProviders,
    sessionKey,
    release: doRelease,
  } = context;

  try {
    const oauthResponse = await host.dispatchOAuthRequest(
      providerPayload,
      request,
      route,
      targetApiType,
      transformer,
      attemptTimeout.signal,
      stallConfig
    );
    attemptTimeout.cleanup();
    await host.recordAttemptMetric(route, request.requestId, true, {
      isVisionFallthrough: (request as any)._hasVisionFallthrough,
      isDescriptorRequest: (request as any)._isVisionDescriptorRequest,
      visionFallthroughModel: (request as any)._visionFallthroughModel,
    });
    host.appendSuccessAttempt(retryHistory, route, targetApiType);
    host.attachAttemptMetadata(
      oauthResponse,
      attemptedProviders,
      retryHistory,
      route,
      targetApiType
    );
    try {
      CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
      host.recordStickySession(sessionKey, route, request);
      return { outcome: 'success', response: oauthResponse };
    } finally {
      doRelease();
    }
  } catch (oauthError: any) {
    const effectiveOAuthError = attemptTimeout.isTimedOut() ? host.buildTimeoutError() : oauthError;
    if (signal?.aborted) throw host.buildCancelledError(signal);

    // Handle TTFB stall errors with failover support
    const isStallError = (effectiveOAuthError as any).isStallError === true;
    if (isStallError) {
      const canRetryStall = failoverEnabled && hasNextTarget;
      host.appendFailureAttempt(
        retryHistory,
        route,
        effectiveOAuthError,
        targetApiType,
        canRetryStall
      );

      if (canRetryStall) {
        attemptTimeout.cleanup();
        await host.recordAttemptMetric(route, request.requestId, false, {
          isVisionFallthrough: (request as any)._hasVisionFallthrough,
          isDescriptorRequest: (request as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (request as any)._visionFallthroughModel,
        });
        CooldownManager.getInstance().markProviderStallFailure(
          route.provider,
          route.model,
          host.formatFailureReason(effectiveOAuthError)
        );
        host.saveIntermediateError(request.requestId, targetApiType || 'chat', effectiveOAuthError);
        logger.info(
          `TTFB stall: OAuth request timed out for ${route.provider}/${route.model}, retrying`
        );
        doRelease();
        return { outcome: 'retry', error: effectiveOAuthError };
      }

      doRelease();

      // Mark stall failure for cooldown tracking even on the last target
      CooldownManager.getInstance().markProviderStallFailure(
        route.provider,
        route.model,
        host.formatFailureReason(effectiveOAuthError)
      );
      throw effectiveOAuthError;
    }

    const canRetry =
      failoverEnabled &&
      hasNextTarget &&
      (attemptTimeout.isTimedOut() || host.isRetryableOAuthError(effectiveOAuthError));

    host.appendFailureAttempt(retryHistory, route, effectiveOAuthError, targetApiType, canRetry);

    if (canRetry) {
      attemptTimeout.cleanup();
      await host.recordAttemptMetric(route, request.requestId, false, {
        isVisionFallthrough: (request as any)._hasVisionFallthrough,
        isDescriptorRequest: (request as any)._isVisionDescriptorRequest,
        visionFallthroughModel: (request as any)._visionFallthroughModel,
      });
      await host.markOAuthProviderFailure(route, effectiveOAuthError);
      host.saveIntermediateError(request.requestId, targetApiType || 'chat', effectiveOAuthError);
      logger.warn(
        `Failover: retrying after OAuth error from ${route.provider}/${route.model}: ${effectiveOAuthError.message}`
      );
      doRelease();
      return { outcome: 'retry', error: effectiveOAuthError };
    }

    attemptTimeout.cleanup();
    await host.markOAuthProviderFailure(route, effectiveOAuthError);
    doRelease();
    throw effectiveOAuthError;
  }
}
