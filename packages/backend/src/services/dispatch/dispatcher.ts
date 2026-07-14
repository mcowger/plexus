import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedTranscriptionRequest,
  UnifiedTranscriptionResponse,
  UnifiedSpeechRequest,
  UnifiedSpeechResponse,
  UnifiedImageGenerationRequest,
  UnifiedImageGenerationResponse,
  UnifiedImageEditRequest,
  UnifiedImageEditResponse,
} from '../../types/unified';
import { QuotaEnforcer } from '../quota/quota-enforcer';
import { buildQuotaExceededError } from '../quota/quota-middleware';
import { logger } from '../../utils/logger';
import { QUOTA_ERROR_PATTERNS } from '../../utils/constants';
import { CooldownManager } from '../runtime/cooldown-manager';
import { StickySessionManager } from '../routing/sticky-session-manager';
import { RouteResult } from '../routing/router';
import { DebugManager } from '../observability/debug-manager';
import { UsageStorageService } from '../observability/usage-storage';
import { getConfig } from '../../config';
import type { ResolvedAdapter } from '../../types/provider-adapter';
import type { StallConfig } from '../inspectors/stall-inspector';
import { sanitizeHeaders } from '../../utils/sanitize-headers';
import type { RetryAttemptRecord } from './dispatcher-types';
import { MediaDispatcher } from './media-dispatcher';
import { RequestManager, type RequestManagerHost } from './request-manager';
import {
  appendFailureAttempt,
  appendSkippedAttempt,
  appendSuccessAttempt,
  attachAttemptMetadata,
  buildAllTargetsFailedError,
} from './attempt-history';
import { isRetryableNetworkError, isRetryableStatus } from './failover-policy';
import { buildRequestPayload, NATIVE_OAUTH_STASH } from './request-payload-builder';
import {
  createAttemptTimeout,
  executeUpstreamRequest,
  probeStreamingStart,
} from './upstream-execution';
import { isPiAiRoute } from '../oauth/oauth-dispatcher';
import { setupProviderHeaders } from '../providers/provider-request-headers';
import {
  applyGeminiThinkingConfig,
  getApiMetadata,
  resolveProviderBaseUrl,
  selectTargetApiType,
} from '../providers/provider-api-selection';
import {
  parseCooldownDurationForProvider,
  resolveCooldownProviderType,
} from '../providers/provider-cooldown';

interface ParseFailureContext {
  rawResponseText: string;
  contentType?: string | null;
}

interface RetryHistoryLikeEntry {
  reason?: unknown;
}

type ResolveTimeoutMs = (timeoutMs?: number | null) => number;

const PROVIDER_ERROR_SUMMARY_LIMIT = 500;

export class Dispatcher {
  private usageStorage?: UsageStorageService;
  private mediaDispatcher?: MediaDispatcher;
  private requestManager?: RequestManager;

  private getRequestManager(): RequestManager {
    if (!this.requestManager) {
      const host: RequestManagerHost = {
        appendFailureAttempt: this.appendFailureAttempt.bind(this),
        appendSkippedAttempt: this.appendSkippedAttempt.bind(this),
        appendSuccessAttempt: this.appendSuccessAttempt.bind(this),
        attachAttemptMetadata: this.attachAttemptMetadata.bind(this),
        buildAllTargetsFailedError: this.buildAllTargetsFailedError.bind(this),
        buildCancelledError: this.buildCancelledError.bind(this),
        buildRequestUrl: this.buildRequestUrl.bind(this),
        buildTimeoutError: this.buildTimeoutError.bind(this),
        createAttemptTimeout: this.createAttemptTimeout.bind(this),
        emitRoutingUpdate: this.emitRoutingUpdate.bind(this),
        executeProviderRequest: this.executeProviderRequest.bind(this),
        formatFailureReason: this.formatFailureReason.bind(this),
        getUsageStorage: this.getUsageStorage.bind(this),
        handleNonStreamingResponse: this.handleNonStreamingResponse.bind(this),
        handleProviderError: this.handleProviderError.bind(this),
        handleStreamingResponse: this.handleStreamingResponse.bind(this),
        isPiAiRoute: this.isPiAiRoute.bind(this),
        isRetryableNetworkError: this.isRetryableNetworkError.bind(this),
        isRetryableStatus: this.isRetryableStatus.bind(this),
        probeStreamingStart: this.probeStreamingStart.bind(this),
        recordAttemptMetric: this.recordAttemptMetric.bind(this),
        recordStickySession: this.recordStickySession.bind(this),
        saveIntermediateError: this.saveIntermediateError.bind(this),
        selectTargetApiType: this.selectTargetApiType.bind(this),
        setupHeaders: this.setupHeaders.bind(this),
        transformRequestPayload: this.transformRequestPayload.bind(this),
      };
      this.requestManager = new RequestManager(host);
    }

    return this.requestManager;
  }

  private getMediaDispatcher(): MediaDispatcher {
    if (!this.mediaDispatcher) {
      this.mediaDispatcher = new MediaDispatcher({
        resolveBaseUrl: this.resolveBaseUrl.bind(this),
        executeProviderRequest: this.executeProviderRequest.bind(this),
        handleProviderError: this.handleProviderError.bind(this),
        parseJsonResponseBody: this.parseJsonResponseBody.bind(this),
        extractResponseHeaders: this.extractResponseHeaders.bind(this),
        applyQuotaFilter: this.applyQuotaFilter.bind(this),
        appendSkippedAttempt: this.appendSkippedAttempt.bind(this),
        appendSuccessAttempt: this.appendSuccessAttempt.bind(this),
        appendFailureAttempt: this.appendFailureAttempt.bind(this),
        attachAttemptMetadata: this.attachAttemptMetadata.bind(this),
        buildAllTargetsFailedError: this.buildAllTargetsFailedError.bind(this),
        emitRoutingUpdate: this.emitRoutingUpdate.bind(this),
        recordAttemptMetric: this.recordAttemptMetric.bind(this),
        saveIntermediateError: this.saveIntermediateError.bind(this),
        formatFailureReason: this.formatFailureReason.bind(this),
        isRetryableStatus: this.isRetryableStatus.bind(this),
        isRetryableNetworkError: this.isRetryableNetworkError.bind(this),
        probeStreamingStart: this.probeStreamingStart.bind(this),
      });
    }

    return this.mediaDispatcher;
  }

  private compactProviderErrorSummary(value: unknown): string {
    const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
    const text = raw.trim() || 'Unknown provider error';
    const chars = Array.from(text);

    if (chars.length <= PROVIDER_ERROR_SUMMARY_LIMIT) {
      return text;
    }

    return `${chars.slice(0, PROVIDER_ERROR_SUMMARY_LIMIT).join('')}... [truncated ${chars.length - PROVIDER_ERROR_SUMMARY_LIMIT} chars]`;
  }

  private formatClientProviderError(statusCode: number, errorText: string): string {
    const reason = this.extractFailureReason(errorText) || errorText || 'Unknown provider error';
    return `Provider failed: ${statusCode} ${this.compactProviderErrorSummary(reason)}`;
  }

  private extractFailureReason(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }

      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.extractFailureReason(parsed) || trimmed;
        } catch {
          return trimmed;
        }
      }

      return trimmed;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const nestedError =
      record.error && typeof record.error === 'object'
        ? (record.error as Record<string, unknown>)
        : undefined;
    const nestedRoutingContext =
      record.routingContext && typeof record.routingContext === 'object'
        ? (record.routingContext as Record<string, unknown>)
        : undefined;

    const directCandidates = [
      record.errorMessage,
      nestedError?.errorMessage,
      record.message,
      nestedError?.message,
      record.providerResponse,
      record.rawResponseText,
      nestedRoutingContext?.providerResponse,
      nestedRoutingContext?.rawResponseText,
    ];

    for (const candidate of directCandidates) {
      const extracted = this.extractFailureReason(candidate);
      if (extracted) {
        return extracted;
      }
    }

    if (typeof record.retryHistory === 'string') {
      try {
        const parsed = JSON.parse(record.retryHistory) as RetryHistoryLikeEntry[];
        for (let index = parsed.length - 1; index >= 0; index--) {
          const extracted = this.extractFailureReason(parsed[index]?.reason);
          if (extracted) {
            return extracted;
          }
        }
      } catch {
        // Ignore malformed retry history strings.
      }
    }

    return undefined;
  }

  private formatFailureReason(error: any, includeStatusCode = false): string {
    const extracted =
      this.extractFailureReason(error?.routingContext?.providerResponse) ||
      this.extractFailureReason(error?.routingContext?.rawResponseText) ||
      this.extractFailureReason(error?.piAiResponse) ||
      this.extractFailureReason(error) ||
      error?.message ||
      'Unknown provider error';

    const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;

    if (includeStatusCode && typeof statusCode === 'number') {
      return this.compactProviderErrorSummary(`HTTP ${statusCode}: ${extracted}`);
    }

    return this.compactProviderErrorSummary(extracted);
  }

  private async recordAttemptMetric(
    route: RouteResult,
    requestId: string | undefined,
    success: boolean,
    metadata?: {
      isVisionFallthrough?: boolean;
      isDescriptorRequest?: boolean;
      visionFallthroughModel?: string;
    }
  ): Promise<void> {
    if (!this.usageStorage) return;

    const metricRequestId =
      requestId || `failover-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (success) {
      await this.usageStorage.recordSuccessfulAttempt(
        route.provider,
        route.model,
        route.canonicalModel ?? null,
        metricRequestId,
        metadata
      );
      return;
    }

    await this.usageStorage.recordFailedAttempt(
      route.provider,
      route.model,
      route.canonicalModel ?? null,
      metricRequestId,
      metadata
    );
  }

  setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }

  getUsageStorage(): UsageStorageService | undefined {
    return this.usageStorage;
  }

  private saveIntermediateError(requestId: string | undefined, apiType: string, error: any): void {
    if (!this.usageStorage || !requestId) return;
    this.usageStorage.saveError(requestId, error, {
      apiType,
      ...(error?.routingContext || {}),
    });
  }

  /**
   * Emit an early routing update so the frontend shows provider/model immediately.
   * The route handler emits a second update after dispatch, but for non-streaming
   * requests that can be seconds later — this one fires as soon as routing is done.
   */
  private emitRoutingUpdate(requestId: string | undefined, route: RouteResult): void {
    if (!requestId || !this.usageStorage) return;
    this.usageStorage.emitUpdatedAsync({
      requestId,
      provider: route.provider,
      selectedModelName: route.model,
      canonicalModelName: route.canonicalModel,
    });
  }

  /**
   * Persist the (alias, sessionKey) → (provider, model) mapping after a
   * successful dispatch so the next turn of this conversation can prefer the
   * same target. No-op when stickiness doesn't apply (no session key, no
   * canonical alias, or vision-descriptor sub-request).
   */
  private recordStickySession(
    sessionKey: string | null,
    route: RouteResult,
    request: UnifiedChatRequest
  ): void {
    if (!sessionKey || !route.canonicalModel) return;
    if ((request as any)._isVisionDescriptorRequest) return;
    const aliasConfig = getConfig().models?.[route.canonicalModel];
    if (!aliasConfig?.sticky_session) return;
    StickySessionManager.getInstance().set(
      route.canonicalModel,
      request.incomingApiType || 'chat',
      sessionKey,
      route.provider,
      route.model
    );
  }

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
    return this.getRequestManager().dispatch(request, signal, resolveTimeoutMs, addStallConfig);
  }

  private isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
    return isRetryableStatus(statusCode, retryableStatusCodes);
  }

  private isRetryableNetworkError(error: any, retryableErrors: string[]): boolean {
    return isRetryableNetworkError(error, retryableErrors);
  }

  private async probeStreamingStart(
    response: Response,
    stallConfig?: StallConfig | null
  ): Promise<
    { ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }
  > {
    return probeStreamingStart(response, stallConfig);
  }

  private attachAttemptMetadata(
    response: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[],
    finalRoute: RouteResult,
    apiType: string
  ): void {
    attachAttemptMetadata(response, attemptedProviders, retryHistory, finalRoute, apiType);
  }

  private appendSkippedAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    reason: string,
    apiType?: string
  ): void {
    appendSkippedAttempt(retryHistory, route, reason, apiType);
  }

  /**
   * Quota-aware candidate filter. Reads the QuotaContext attached by
   * `attachQuotaContext` (quota-middleware.ts) at
   * `metadata.plexus_metadata.plexus_quota_context` — absent whenever the
   * caller never attached one (no quota assigned, or one of the non-chat
   * dispatch paths that doesn't attach a context at all) — in which case
   * this is a no-op and `candidates` is returned unchanged.
   *
   * Candidates blocked by a scope-matching exhausted quota are dropped and
   * recorded as `skipped` retryHistory entries (reason
   * `quota_exceeded:<quotaName>`) — routing silently narrows to the
   * remaining candidates. Only when EVERY candidate ends up blocked does
   * this throw a terminal `buildQuotaExceededError`, carrying every
   * blocking snapshot so the 429 body's `blocking_quotas` reflects the full
   * set.
   */
  private applyQuotaFilter<C extends RouteResult>(
    request: { metadata?: Record<string, any> },
    candidates: C[],
    retryHistory: RetryAttemptRecord[],
    apiType?: string
  ): C[] {
    const ctx = request.metadata?.plexus_metadata?.plexus_quota_context ?? null;
    if (!ctx) return candidates;

    const { allowed, blocked } = QuotaEnforcer.filterCandidates(ctx, candidates);
    if (blocked.length === 0) return candidates;

    for (const { candidate, quota } of blocked) {
      this.appendSkippedAttempt(
        retryHistory,
        candidate,
        `quota_exceeded:${quota.quotaName}`,
        apiType
      );
    }

    if (allowed.length === 0) {
      // Terminal: keep the quota-skip breadcrumbs on the error so the saved
      // UsageRecord's retryHistory isn't null when everything was blocked.
      throw buildQuotaExceededError(
        blocked.map((b) => b.quota),
        retryHistory
      );
    }

    return allowed;
  }

  private appendSuccessAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    apiType?: string
  ): void {
    appendSuccessAttempt(retryHistory, route, apiType);
  }

  private appendFailureAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    error: any,
    apiType?: string,
    retryable?: boolean
  ): void {
    appendFailureAttempt(
      retryHistory,
      route,
      error,
      this.formatFailureReason.bind(this),
      apiType,
      retryable
    );
  }

  private buildAllTargetsFailedError(
    lastError: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[] = []
  ): Error {
    return buildAllTargetsFailedError(
      lastError,
      attemptedProviders,
      retryHistory,
      this.formatFailureReason.bind(this),
      this.compactProviderErrorSummary.bind(this)
    );
  }

  private async parseJsonResponseBody(
    response: Response,
    requestId?: string,
    route?: RouteResult,
    targetApiType?: string
  ): Promise<any> {
    const responseText = await response.text();

    try {
      return JSON.parse(responseText);
    } catch (cause) {
      if (requestId) {
        DebugManager.getInstance().addRawResponse(requestId, responseText);
        DebugManager.getInstance().addReconstructedRawResponse(requestId, {
          parseError: true,
          rawResponseText: responseText,
          contentType: response.headers.get('content-type'),
          provider: route?.provider,
          targetModel: route?.model,
          targetApiType,
        });
      }

      const error = new Error(
        responseText || 'JSON Parse error: Unable to parse JSON string'
      ) as any;
      error.cause = cause;
      error.routingContext = {
        provider: route?.provider,
        targetModel: route?.model,
        targetApiType,
        statusCode: response.status || 500,
        rawResponseText: responseText,
        providerResponse: responseText,
        contentType: response.headers.get('content-type'),
      } satisfies ParseFailureContext & Record<string, unknown>;

      throw error;
    }
  }

  setupHeaders(
    route: RouteResult,
    apiType: string,
    request: UnifiedChatRequest
  ): Record<string, string> {
    // Native OAuth routes carry fully-built wire headers (Bearer token + CC
    // fingerprint headers) stashed during payload preparation.
    const nativeOAuth = (route as any)[NATIVE_OAUTH_STASH];
    if (nativeOAuth?.headers) {
      return { ...nativeOAuth.headers };
    }
    return setupProviderHeaders(route, apiType, request);
  }

  private getApiMetadata(metadata: Record<string, any>): Record<string, any> {
    return getApiMetadata(metadata);
  }

  private selectTargetApiType(
    route: RouteResult,
    incomingApiType?: string
  ): { targetApiType?: string; selectionReason: string } {
    return selectTargetApiType(route, incomingApiType);
  }

  private resolveBaseUrl(route: RouteResult, targetApiType: string): string {
    return resolveProviderBaseUrl(route, targetApiType);
  }

  private applyGeminiThinkingConfig(route: RouteResult, targetApiType: string, payload: any): any {
    return applyGeminiThinkingConfig(route, targetApiType, payload);
  }

  private isPiAiRoute(route: RouteResult, targetApiType: string): boolean {
    return isPiAiRoute(route, targetApiType);
  }

  private createAttemptTimeout(
    signal: AbortSignal | undefined,
    providerTimeoutMs: number | null | undefined,
    resolveTimeoutMs?: ResolveTimeoutMs
  ) {
    return createAttemptTimeout(signal, providerTimeoutMs, resolveTimeoutMs);
  }

  private buildTimeoutError(): Error {
    const err = new Error('Upstream timeout') as any;
    err.routingContext = {
      statusCode: 504,
      code: 'upstream_timeout',
    };
    return err;
  }

  private buildCancelledError(signal: AbortSignal): Error {
    const isTimeout = signal.reason?.name === 'TimeoutError';
    const err = new Error(isTimeout ? 'Upstream timeout' : 'Client disconnected') as any;
    err.routingContext = {
      statusCode: isTimeout ? 504 : 499,
      code: isTimeout ? 'upstream_timeout' : 'client_disconnected',
    };
    return err;
  }

  private async transformRequestPayload(
    request: UnifiedChatRequest,
    route: RouteResult,
    transformer: any,
    targetApiType: string,
    adapters: ResolvedAdapter[] = []
  ): Promise<{ payload: any; bypassTransformation: boolean }> {
    return buildRequestPayload(request, route, transformer, targetApiType, adapters);
  }

  /**
   * Constructs the full provider request URL
   */
  private buildRequestUrl(
    route: RouteResult,
    transformer: any,
    request: UnifiedChatRequest,
    targetApiType: string
  ): string {
    // Native OAuth routes carry a fully-resolved upstream URL stashed during
    // payload preparation (real provider endpoint, not oauth://).
    const nativeOAuth = (route as any)[NATIVE_OAUTH_STASH];
    if (nativeOAuth?.url) {
      return nativeOAuth.url;
    }
    const baseUrl = this.resolveBaseUrl(route, targetApiType);
    const endpoint = transformer.getEndpoint
      ? transformer.getEndpoint(request)
      : transformer.defaultEndpoint;
    return `${baseUrl}${endpoint}`;
  }

  /**
   * Executes the HTTP POST request to the provider
   */
  private async executeProviderRequest(
    url: string,
    headers: Record<string, string>,
    payload: any,
    signal?: AbortSignal
  ): Promise<Response> {
    return executeUpstreamRequest(url, headers, payload, signal);
  }

  /**
   * Handles failed provider responses with cooldown logic
   */
  /**
   * Detects whether an error response body indicates a quota/funds exhaustion error.
   * These patterns should trigger a cooldown even on 400/403 responses.
   */
  private isQuotaExhaustedError(errorText: string): boolean {
    const lower = errorText.toLowerCase();
    return (
      lower.includes('insufficient fund') ||
      lower.includes('insufficient_quota') ||
      lower.includes('insufficient balance') ||
      lower.includes('insufficient_balance') ||
      lower.includes('quota exceeded') ||
      lower.includes('out of credits') ||
      lower.includes('credit balance is too low') ||
      lower.includes('credit_balance_too_low') ||
      lower.includes('account is out of credits') ||
      lower.includes('used up your points') ||
      lower.includes('usage limit') ||
      lower.includes('free plan') ||
      lower.includes('your credit balance') ||
      lower.includes('remaining quota') ||
      lower.includes('payment required') ||
      lower.includes('billing') ||
      lower.includes('no credits') ||
      lower.includes('topup') ||
      lower.includes('top up') ||
      lower.includes('top_up') ||
      lower.includes('rate limit') ||
      lower.includes('rate_limit')
    );
  }

  private async handleProviderError(
    response: Response,
    route: RouteResult,
    errorText: string,
    url?: string,
    headers?: Record<string, string>,
    targetApiType?: string,
    requestId?: string
  ): Promise<never> {
    logger.error(`Provider error: ${response.status} ${errorText}`);

    const cooldownManager = CooldownManager.getInstance();

    // 400s are ambiguous: they can be caller errors (bad prompt, invalid params) OR provider-side
    // quota/balance exhaustion. Only trigger cooldown for the latter.
    const isQuota400 =
      response.status === 400 &&
      QUOTA_ERROR_PATTERNS.some((p) => errorText.toLowerCase().includes(p.toLowerCase()));

    if (isQuota400) {
      logger.warn(
        `Detected quota/balance error in 400 response from ${route.provider}/${route.model}`
      );
    }

    // Trigger cooldown for all provider errors except:
    // - 413 (payload too large) and 422 (unprocessable entity): caller errors, not provider failures
    // - 400 without a quota pattern: likely a request validation error, not a provider failure
    const isCallerError =
      response.status === 413 ||
      response.status === 422 ||
      (response.status === 400 && !isQuota400);

    if (!isCallerError) {
      let cooldownDuration: number | undefined;

      // For 429 errors, try to parse provider-specific cooldown duration
      if (response.status === 429) {
        // Get provider type for parser lookup
        cooldownDuration = parseCooldownDurationForProvider(
          resolveCooldownProviderType(route),
          errorText,
          'HTTP'
        );
      }

      // Mark provider+model as failed with optional duration
      // For non-429 errors, cooldownDuration will be undefined and default (10 minutes) will be used
      cooldownManager.markProviderFailure(
        route.provider,
        route.model,
        cooldownDuration,
        this.formatFailureReason(
          { routingContext: { providerResponse: errorText, statusCode: response.status } },
          true
        )
      );
    }

    // Create enriched error with routing context
    const error = new Error(this.formatClientProviderError(response.status, errorText)) as any;
    error.routingContext = {
      provider: route.provider,
      targetModel: route.model,
      targetApiType: targetApiType,
      url: url,
      headers: sanitizeHeaders(headers || {}),
      statusCode: response.status,
      providerResponse: errorText,
      providerResponseHeaders: this.extractResponseHeaders(response),
      cooldownTriggered: !isCallerError,
    };

    // Capture the raw error response for debug logs
    if (requestId) {
      DebugManager.getInstance().addResponseMeta(
        requestId,
        response.status,
        this.extractResponseHeaders(response)
      );
      DebugManager.getInstance().addRawResponse(requestId, errorText);
    }

    throw error;
  }

  /**
   * Extract all provider response headers from a fetch Response
   */
  private extractResponseHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  /**
   * Enriches response with Plexus metadata
   */
  private enrichResponseWithMetadata(
    response: UnifiedChatResponse,
    route: RouteResult,
    targetApiType: string
  ): void {
    response.plexus = {
      provider: route.provider,
      model: route.model,
      apiType: targetApiType,
      pricing: route.modelConfig?.pricing,
      providerDiscount: route.config.discount,
      canonicalModel: route.canonicalModel,
      config: route.config,
    };
  }

  /**
   * Handles streaming responses
   */
  private handleStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    bypassTransformation: boolean,
    adapters: ResolvedAdapter[] = []
  ): UnifiedChatResponse {
    logger.debug('Streaming response detected');

    // Capture response metadata for debug logging
    if (request.requestId) {
      DebugManager.getInstance().addResponseMeta(
        request.requestId,
        response.status,
        this.extractResponseHeaders(response)
      );
    }

    let rawStream: ReadableStream = response.body!;

    // Native OAuth: reverse request-side tool-name renames on the raw upstream
    // SSE bytes (no IR, no event translation) before they reach the client.
    const nativeOAuth = (route as any)[NATIVE_OAUTH_STASH];
    if (nativeOAuth?.reverseResponseFrame) {
      rawStream = rawStream.pipeThrough(
        this.buildSseFrameRewriteTransform(nativeOAuth.reverseResponseFrame)
      );
    }

    // If any adapter defines preDispatchStreamChunk, pipe the raw SSE stream
    // through a rewrite transform before it reaches transformStream().
    const streamAdapters = adapters.filter((a) => a.adapter.preDispatchStreamChunk);
    if (streamAdapters.length > 0) {
      rawStream = rawStream.pipeThrough(this.buildSseRewriteTransform(streamAdapters));
      logger.debug(
        `Stream adapters applied (preDispatchStreamChunk): [${streamAdapters.map((a) => a.adapter.name).join(', ')}] ` +
          `for ${route.provider}/${route.model}`
      );
    }

    const streamResponse: UnifiedChatResponse = {
      id: 'stream-' + Date.now(),
      model: request.model,
      content: null,
      stream: rawStream,
      bypassTransformation: bypassTransformation,
    };

    this.enrichResponseWithMetadata(streamResponse, route, targetApiType);

    return streamResponse;
  }

  /**
   * Builds a TransformStream that rewrites raw SSE lines through the
   * preDispatchStreamChunk hooks of the given adapters.
   * Handles chunked delivery — lines may arrive split across multiple chunks.
   */
  private buildSseRewriteTransform(
    adapters: ResolvedAdapter[]
  ): TransformStream<Uint8Array, Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) segment in the buffer
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          let rewritten = line;
          for (const { adapter, options } of adapters) {
            rewritten = adapter.preDispatchStreamChunk!(rewritten, options);
          }
          controller.enqueue(encoder.encode(rewritten + '\n'));
        }
      },
      flush(controller) {
        if (buffer.length > 0) {
          let rewritten = buffer;
          for (const { adapter, options } of adapters) {
            rewritten = adapter.preDispatchStreamChunk!(rewritten, options);
          }
          controller.enqueue(encoder.encode(rewritten));
        }
      },
    });
  }

  /**
   * Builds a TransformStream that rewrites each raw SSE line through a single
   * frame-rewriter function (used by the native OAuth path to reverse tool-name
   * renames on upstream bytes). Line-buffered to handle chunk-split frames.
   */
  private buildSseFrameRewriteTransform(
    rewrite: (frame: string) => string
  ): TransformStream<Uint8Array, Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          controller.enqueue(encoder.encode(rewrite(line) + '\n'));
        }
      },
      flush(controller) {
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(rewrite(buffer)));
        }
      },
    });
  }

  /**
   * Handles non-streaming responses
   */
  private async handleNonStreamingResponse(
    response: Response,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any,
    bypassTransformation: boolean,
    adapters: ResolvedAdapter[] = []
  ): Promise<UnifiedChatResponse> {
    // Capture response metadata for debug logging
    if (request.requestId) {
      DebugManager.getInstance().addResponseMeta(
        request.requestId,
        response.status,
        this.extractResponseHeaders(response)
      );
    }

    let responseBody = await this.parseJsonResponseBody(
      response,
      request.requestId,
      route,
      targetApiType
    );
    logger.silly('Upstream Response Payload', responseBody);

    // Native OAuth: reverse request-side tool-name renames on the raw response
    // body (JSON string round-trip mirrors the streaming frame reversal).
    const nativeOAuth = (route as any)[NATIVE_OAUTH_STASH];
    if (nativeOAuth?.reverseResponseFrame && responseBody && typeof responseBody === 'object') {
      try {
        responseBody = JSON.parse(nativeOAuth.reverseResponseFrame(JSON.stringify(responseBody)));
      } catch {
        // Leave body untouched if the round-trip fails.
      }
    }

    // Apply provider/model adapters (postDispatch) in reverse order
    if (adapters.length > 0) {
      for (let i = adapters.length - 1; i >= 0; i--) {
        responseBody = adapters[i]!.adapter.postDispatch(responseBody, adapters[i]!.options);
      }
      logger.debug(
        `Adapters applied (postDispatch): [${[...adapters]
          .reverse()
          .map((a) => a.adapter.name)
          .join(', ')}] ` + `for ${route.provider}/${route.model}`
      );
    }

    if (request.requestId) {
      DebugManager.getInstance().addResponseMeta(
        request.requestId,
        response.status,
        this.extractResponseHeaders(response)
      );
      DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
    }

    let unifiedResponse: UnifiedChatResponse;

    if (bypassTransformation) {
      // We still need unified response for usage stats, so we transform purely for that
      // But we set the bypass flag and attach raw response
      const syntheticResponse = await transformer.transformResponse(responseBody);
      unifiedResponse = {
        ...syntheticResponse,
        bypassTransformation: true,
        rawResponse: responseBody,
      };
    } else {
      unifiedResponse = await transformer.transformResponse(responseBody);
    }

    this.enrichResponseWithMetadata(unifiedResponse, route, targetApiType);

    return unifiedResponse;
  }

  async dispatchEmbeddings(request: any): Promise<any> {
    return this.getMediaDispatcher().dispatchEmbeddings(request);
  }

  async dispatchTranscription(
    request: UnifiedTranscriptionRequest
  ): Promise<UnifiedTranscriptionResponse> {
    return this.getMediaDispatcher().dispatchTranscription(request);
  }

  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    return this.getMediaDispatcher().dispatchSpeech(request);
  }

  async dispatchImageGenerations(
    request: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    return this.getMediaDispatcher().dispatchImageGenerations(request);
  }

  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    return this.getMediaDispatcher().dispatchImageEdits(request);
  }
}
