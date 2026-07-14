import type { UnifiedChatRequest, UnifiedChatResponse } from '../../types/unified';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';
import { StickySessionManager } from '../routing/sticky-session-manager';
import { TransformerFactory } from './transformer-factory';
import { resolveAdapters } from './adapter-resolver';
import { DebugManager } from '../observability/debug-manager';
import { CooldownManager } from '../runtime/cooldown-manager';
import { admitProvider } from '../runtime/provider-admission';
import { enforceContextLimit } from '../models/enforce-limits';
import { getGlobalStallConfig, resolveStallConfig } from '../../utils/stall';
import { preprocessVisionRequest } from '../vision/vision-request-preprocessor';
import { resolveRouteCandidates } from '../routing/route-candidates';
import { executeStandardAttempt } from './standard-attempt-request';
import { isNativeOAuthRoute } from './request-payload-builder';
import { nativeOAuthApiType } from '../oauth/oauth-native-request';
import type { RetryAttemptRecord } from './dispatcher-types';
import type { ResolveTimeoutMs } from './upstream-execution';

export type StallOverrides = {
  stallTtfbMs?: number | null;
  stallTtfbBytes?: number | null;
  stallMinBps?: number | null;
  stallWindowMs?: number | null;
  stallGracePeriodMs?: number | null;
};

/** Operations supplied by the public Dispatcher facade. */
export interface RequestManagerHost {
  appendFailureAttempt(...args: any[]): void;
  appendSkippedAttempt(...args: any[]): void;
  appendSuccessAttempt(...args: any[]): void;
  attachAttemptMetadata(...args: any[]): void;
  buildAllTargetsFailedError(...args: any[]): Error;
  buildCancelledError(...args: any[]): Error;
  buildRequestUrl(...args: any[]): string;
  buildTimeoutError(...args: any[]): Error;
  createAttemptTimeout(...args: any[]): any;
  emitRoutingUpdate(...args: any[]): void;
  executeProviderRequest(...args: any[]): Promise<Response>;
  formatFailureReason(...args: any[]): string;
  getUsageStorage(): any;
  handleNonStreamingResponse(...args: any[]): Promise<UnifiedChatResponse>;
  handleProviderError(...args: any[]): Promise<never>;
  handleStreamingResponse(...args: any[]): UnifiedChatResponse;
  isPiAiRoute(...args: any[]): boolean;
  isRetryableNetworkError(...args: any[]): boolean;
  isRetryableStatus(...args: any[]): boolean;
  probeStreamingStart(...args: any[]): Promise<any>;
  recordAttemptMetric(...args: any[]): Promise<void>;
  recordStickySession(...args: any[]): void;
  saveIntermediateError(...args: any[]): void;
  selectTargetApiType(...args: any[]): { targetApiType?: string; selectionReason: string };
  setupHeaders(...args: any[]): Record<string, string>;
  transformRequestPayload(...args: any[]): Promise<{ payload: any; bypassTransformation: boolean }>;
}

export class RequestManager {
  constructor(private readonly host: RequestManagerHost) {}

  async dispatch(
    request: UnifiedChatRequest,
    signal?: AbortSignal,
    resolveTimeoutMs?: ResolveTimeoutMs,
    addStallConfig?: (providerOverrides: {
      stallTtfbMs?: number | null;
      stallTtfbBytes?: number | null;
      stallMinBps?: number | null;
      stallWindowMs?: number | null;
      stallGracePeriodMs?: number | null;
    }) => void
  ): Promise<UnifiedChatResponse> {
    const host = this.host;
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    // 1. Resolve the ordered candidate list.
    const sessionKey = StickySessionManager.computeSessionKey(request);
    const retryHistory: RetryAttemptRecord[] = [];
    const candidates = await resolveRouteCandidates(
      request,
      retryHistory,
      sessionKey,
      host.appendSkippedAttempt.bind(host)
    );
    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) throw host.buildCancelledError(signal);
      let currentRequest = { ...request };
      const route = targets[i]!;
      const apiSelection = host.selectTargetApiType(route, currentRequest.incomingApiType);
      if (!apiSelection.targetApiType) {
        const reason = apiSelection.selectionReason;
        logger.info(`Skipping ${route.provider}/${route.model} - ${reason}`);
        lastError = new Error(reason);
        host.appendSkippedAttempt(retryHistory, route, reason, currentRequest.incomingApiType);
        continue;
      }
      const { targetApiType, selectionReason } = apiSelection;
      const attemptTimeout = host.createAttemptTimeout(
        signal,
        route.config.timeoutMs,
        resolveTimeoutMs
      );

      // Vision preprocessing happens before context validation and provider admission.
      currentRequest = await preprocessVisionRequest(
        currentRequest,
        route,
        config,
        host.getUsageStorage()
      );

      const aliasConfig = route.canonicalModel ? config.models?.[route.canonicalModel] : undefined;
      // Context validation must happen before a concurrency slot is acquired.
      if (aliasConfig?.enforce_limits && route.canonicalModel) {
        enforceContextLimit(currentRequest, aliasConfig, route.canonicalModel);
      }

      const admission = await admitProvider(route);
      if (!admission.admitted) {
        attemptTimeout.cleanup();
        logger.warn(
          `Skipping ${route.provider}/${route.model} - ${admission.reason.replace(`Provider ${route.provider}/${route.model} `, '')}`
        );
        lastError = new Error(admission.reason);
        host.appendSkippedAttempt(retryHistory, route, admission.reason);
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);
      const doRelease = admission.release;

      host.emitRoutingUpdate(currentRequest.requestId, route);

      try {
        // Determine Target API Type
        logger.info(
          `Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`
        );

        // 2. Get Transformer
        // ALL OAuth routes now run through the STANDARD path via the native
        // OAuth builders — there is no pi-ai `oauth` executor
        // anymore. A native OAuth route's wire API is its real upstream protocol
        // (e.g. Anthropic 'messages', Codex 'responses', Copilot per-model), NOT
        // the synthetic 'oauth' type getProviderTypes() reports for an `oauth://`
        // URL. Using the native type selects the correct transformer AND lets
        // same-format requests use pass-through; masking/fingerprint is layered
        // on in buildRequestPayload.
        const nativeOAuth = isNativeOAuthRoute(route, targetApiType);
        // Any `oauth://` route whose provider isn't natively supported is dead
        // config (Gemini CLI / Antigravity were removed; persisted rows are
        // purged at startup). Fail fast with an actionable error rather than
        // silently mis-routing.
        if (host.isPiAiRoute(route, targetApiType) && !nativeOAuth) {
          throw new Error(
            `OAuth provider '${route.config.oauth_provider || route.provider}' is not supported. ` +
              `Supported OAuth providers: anthropic, openai-codex, github-copilot.`
          );
        }
        const effectiveApiType = nativeOAuth
          ? (nativeOAuthApiType(route.config.oauth_provider || route.provider, route.model) ??
            'messages')
          : targetApiType;
        const transformer = TransformerFactory.getTransformer(effectiveApiType);

        // 3. Transform Request
        const requestWithTargetModel = { ...currentRequest, model: route.model };

        // Resolve adapters for this specific provider+model combination
        const adapters = resolveAdapters(route);

        const { payload: providerPayload, bypassTransformation } =
          await host.transformRequestPayload(
            requestWithTargetModel,
            route,
            transformer,
            effectiveApiType,
            adapters
          );

        // Capture transformed request
        if (currentRequest.requestId) {
          DebugManager.getInstance().addTransformedRequest(
            currentRequest.requestId,
            providerPayload
          );
        }

        // Wire per-provider stall detection overrides. Always call addStallConfig
        // so the StallInspector is reset on each failover iteration — even when
        // the current provider has no overrides, this clears a previous provider's
        // overrides from the inspector.
        if (addStallConfig) {
          const providerStallOverrides: Parameters<typeof addStallConfig>[0] = {};
          if (route.config.stallTtfbMs !== undefined)
            providerStallOverrides.stallTtfbMs = route.config.stallTtfbMs;
          if (route.config.stallTtfbBytes !== undefined)
            providerStallOverrides.stallTtfbBytes = route.config.stallTtfbBytes;
          if (route.config.stallMinBps !== undefined)
            providerStallOverrides.stallMinBps = route.config.stallMinBps;
          if (route.config.stallWindowMs !== undefined)
            providerStallOverrides.stallWindowMs = route.config.stallWindowMs;
          if (route.config.stallGracePeriodMs !== undefined)
            providerStallOverrides.stallGracePeriodMs = route.config.stallGracePeriodMs;
          logger.debug(
            `Dispatcher: provider stall overrides for ${route.provider}: ${JSON.stringify(providerStallOverrides)}, ` +
              `route.config stall fields: stallTtfbMs=${route.config.stallTtfbMs}, stallMinBps=${route.config.stallMinBps}`
          );
          addStallConfig(providerStallOverrides);
        }

        // Resolve stall config BEFORE the dispatch so we can wrap fetch+probe
        // in a TTFB timeout. This is critical because fetch() itself may block
        // for a long time waiting for HTTP response headers — the TTFB timeout
        // must cover this "headers phase" too, not just the body reading.
        // This applies to BOTH OAuth and non-OAuth routes.
        let effectiveStallConfig = resolveStallConfig(getGlobalStallConfig(), {
          stallTtfbMs: route.config.stallTtfbMs,
          stallTtfbBytes: route.config.stallTtfbBytes,
          stallMinBps: route.config.stallMinBps,
          stallWindowMs: route.config.stallWindowMs,
          stallGracePeriodMs: route.config.stallGracePeriodMs,
        });

        logger.debug(
          `Dispatcher: effectiveStallConfig for ${route.provider}: ${JSON.stringify(effectiveStallConfig)}, ` +
            `route.config.stallTtfbMs=${route.config.stallTtfbMs}, route.config.stallMinBps=${route.config.stallMinBps}`
        );

        const result = await executeStandardAttempt({
          host,
          providerPayload,
          request: currentRequest,
          requestWithTargetModel,
          route,
          targetApiType: effectiveApiType,
          transformer,
          bypassTransformation,
          adapters,
          signal,
          stallConfig: effectiveStallConfig,
          attemptTimeout,
          failoverEnabled,
          hasNextTarget: i < targets.length - 1,
          retryableStatusCodes: failover?.retryableStatusCodes || [],
          retryableErrors: failover?.retryableErrors || [],
          retryHistory,
          attemptedProviders,
          sessionKey,
          release: doRelease,
        });
        if (result.outcome === 'retry') {
          lastError = result.error;
          continue;
        }
        return result.response;
      } catch (error: any) {
        const effectiveError = attemptTimeout.isTimedOut() ? host.buildTimeoutError() : error;
        lastError = effectiveError;
        attemptTimeout.cleanup();
        doRelease();

        // If the client disconnected (abort signal), don't treat this as a
        // retryable error — throw a proper client_disconnected error so the
        // route handler records it as cancelled, not as an inference error.
        if (signal?.aborted) throw host.buildCancelledError(signal);

        // If the error came from handleProviderError, it already called markProviderFailure.
        // Only call it here for network/transport errors that have no HTTP status code.
        const isHttpError = effectiveError?.routingContext?.statusCode !== undefined;
        const isUpstreamTimeout = effectiveError?.routingContext?.code === 'upstream_timeout';

        if (!isHttpError || isUpstreamTimeout) {
          // Pure network/transport error — mark the provider as failed
          if (effectiveError.message?.includes('stalled')) {
            CooldownManager.getInstance().markProviderStallFailure(
              route.provider,
              route.model,
              host.formatFailureReason(effectiveError)
            );
          } else {
            CooldownManager.getInstance().markProviderFailure(
              route.provider,
              route.model,
              undefined,
              host.formatFailureReason(effectiveError)
            );
          }
        }
        await host.recordAttemptMetric(route, currentRequest.requestId, false, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          (isUpstreamTimeout ||
            host.isRetryableNetworkError(effectiveError, failover?.retryableErrors || []) ||
            effectiveError.message?.includes('stalled'));

        host.appendFailureAttempt(retryHistory, route, effectiveError, undefined, canRetryNetwork);

        if (canRetryNetwork) {
          host.saveIntermediateError(
            currentRequest.requestId,
            effectiveError?.routingContext?.targetApiType || 'chat',
            effectiveError
          );
          logger.warn(
            `Failover: retrying after network/transport error from ${route.provider}/${route.model}: ${effectiveError.message}`
          );
          continue;
        }

        throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw host.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }
}
