/**
 * T2.3 + T2.4 — Beta pi-ai executor.
 *
 * Wire-format-agnostic core that:
 *  - Resolves candidates via Router.resolveCandidates / Router.resolve
 *  - Applies the key-access policy
 *  - Filters to beta-compatible candidates (both pi-ai hints present and registry-valid)
 *  - Runs the per-candidate failover loop with:
 *      abort check → attempt timeout → cooldown check → concurrency acquire
 *      → build pi-ai model → call stream()/complete()
 *  - For streaming: wraps the event stream in an async generator that handles
 *      TTFB stall detection (Promise.race on iterator.next()), concurrency
 *      release, timeout cleanup, success/failure marking, usage recording,
 *      quota recording, and debug flushing.
 *  - For non-streaming: marks success, releases concurrency, records usage.
 *  - T2.6: full UsageRecord population from pi-ai Usage + calculateCost
 *  - T2.7: debug integration via DebugManager
 *
 * The executor never imports OpenAI/Anthropic/Gemini types.  Wire-format
 * serialisation happens in the caller-supplied `serializeMessage` /
 * `serializeChunks` callbacks.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { calculateCost } from '@earendil-works/pi-ai';
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';
import { piAiModels, toDispatchModel } from './pi-ai-utils';
import type {
  Context,
  ProviderStreamOptions,
  AssistantMessage,
  AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import type { FastifyRequest } from 'fastify';

import { Router } from '../../services/router';
import type { RouteResult } from '../../services/router';
import { CooldownManager } from '../../services/cooldown-manager';
import { ConcurrencyTracker } from '../../services/concurrency-tracker';
import { DebugManager } from '../../services/debug-manager';
import type { UsageStorageService } from '../../services/usage-storage';
import type { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { recordQuotaUsage } from '../../services/quota/quota-middleware';
import { logger } from '../../utils/logger';
import { getConfig } from '../../config';
import { applyKeyAccessPolicy, type PolicyRequest } from '../../services/key-access-policy';
import {
  buildPiAiModel,
  resolvePiAiModel,
  buildGenerationOptions,
  buildGpuParams,
  computeKwhUsed,
} from './pi-ai-utils';
import type { GenerationIntent } from './generation';
import { splitReasoningSuffix } from './reasoning';
import { consumeTtfb } from './fetch-tap';
import { extractPiAiErrorMessage } from '../../transformers/oauth/type-mappers';
import { enforceContextLimitForRoute } from '../../services/enforce-limits';
import { compactContextForSend } from '../../services/compaction/compaction-service';
import type { CompactionResult, CompactionStrategyName } from '../../services/compaction/types';
import { applyVisionFallthrough, contextHasImages } from './vision-fallthrough';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../../utils/constants';

// ─── AsyncLocalStorage for debug raw-capture correlation ─────────────────────

export const debugRequestIdStorage = new AsyncLocalStorage<string>();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PiAiExecutorInput<TResponse, TChunk extends string = string> {
  requestId: string;
  /** 'chat' | 'messages' | 'responses' | 'gemini' */
  incomingApiType: string;
  /** Original model alias from the client */
  modelAlias: string;
  /** Built by the inbound parser */
  context: Context;
  /**
   * Canonical generation intent from the inbound parser: reasoning + maxTokens,
   * temperature, verbosity, serviceTier. Re-expanded against model capabilities
   * by buildGenerationOptions() at egress.
   */
  generationIntent: GenerationIntent;
  /** tool_choice forwarded verbatim */
  toolChoice?: unknown;
  /** parallel_tool_calls forwarded verbatim */
  parallelToolCalls?: boolean;
  streaming: boolean;
  request: FastifyRequest;
  usageStorage: UsageStorageService;
  quotaEnforcer?: QuotaEnforcer;
  signal?: AbortSignal;
  /** Post-processing hook (e.g. store response for /v1/responses Stage 3). No-op for Stage 1. */
  onSuccess?: (msg: AssistantMessage) => void | Promise<void>;
  /** Number of tools defined (forwarded from parser result) */
  toolsDefined?: number;
  /** Number of non-system messages (forwarded from parser result) */
  messageCount?: number;
  /** Converts a final AssistantMessage to the wire-format response object */
  serializeMessage: (msg: AssistantMessage) => TResponse;
  /** Converts one AssistantMessageEvent to zero or more SSE/NDJSON frame strings */
  serializeChunks: (event: AssistantMessageEvent) => TChunk[];
}

export interface PiAiExecutorResult<TResponse> {
  /** Set for non-streaming — the wire-format response object */
  response?: TResponse;
  /** Set for streaming — async generator of wire-format frame strings */
  stream?: AsyncGenerator<string>;
  /** Set for non-streaming when compaction actually ran and reduced tokens */
  compaction?: {
    strategy: CompactionStrategyName | null;
    tokensBefore: number;
    tokensAfter: number;
  };
}

// ─── Attempt-timeout helper (mirrors Dispatcher.createAttemptTimeout) ─────────

function createAttemptTimeout(
  signal: AbortSignal | undefined,
  providerTimeoutMs: number | null | undefined
): { signal: AbortSignal; isTimedOut: () => boolean; cleanup: () => void } {
  const timeoutMs = providerTimeoutMs ?? (getConfig().timeout?.defaultSeconds ?? 300) * 1000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new DOMException('Upstream request timed out', 'TimeoutError'));
  }, timeoutMs);
  (timeoutId as any).unref?.();

  return {
    signal: signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal,
    isTimedOut: () => timeoutController.signal.aborted,
    cleanup: () => clearTimeout(timeoutId),
  };
}

// ─── Error builders (match Dispatcher shape so route error handlers work) ────

function buildTimeoutError(): Error {
  const err = new Error('Upstream timeout') as any;
  err.routingContext = { statusCode: 504, code: 'upstream_timeout' };
  return err;
}

function buildCancelledError(signal: AbortSignal): Error {
  const isTimeout = signal.reason?.name === 'TimeoutError';
  const err = new Error(isTimeout ? 'Upstream timeout' : 'Client disconnected') as any;
  err.routingContext = {
    statusCode: isTimeout ? 504 : 499,
    code: isTimeout ? 'upstream_timeout' : 'client_disconnected',
  };
  return err;
}

function buildAllTargetsFailedError(
  lastError: any,
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[]
): Error {
  const summary = attemptedProviders.length > 0 ? attemptedProviders.join(', ') : 'none';
  const baseMessage = lastError?.message || 'Unknown provider error';
  const enriched = new Error(`All targets failed: ${summary}. Last error: ${baseMessage}`) as any;
  enriched.cause = lastError;
  enriched.routingContext = {
    ...(lastError?.routingContext || {}),
    allAttemptedProviders: attemptedProviders,
    attemptCount: attemptedProviders.length,
    retryHistory: JSON.stringify(retryHistory),
    statusCode: lastError?.routingContext?.statusCode || 500,
  };
  return enriched;
}

function buildNoBetaCandidatesError(): Error {
  const err = new Error(
    'No beta-compatible candidate found: no configured provider has both pi_ai_provider and pi_ai_model_id set to registry-valid values.'
  ) as any;
  err.routingContext = { statusCode: 400, code: 'no_beta_compatible_candidate' };
  return err;
}

// ─── Retry history ────────────────────────────────────────────────────────────

interface RetryAttemptRecord {
  index: number;
  provider: string;
  model: string;
  apiType?: string;
  status: 'success' | 'failed' | 'skipped';
  reason: string;
  statusCode?: number;
  retryable?: boolean;
}

function appendSkippedAttempt(
  history: RetryAttemptRecord[],
  route: RouteResult,
  reason: string,
  apiType?: string
): void {
  history.push({
    index: history.length + 1,
    provider: route.provider,
    model: route.model,
    apiType,
    status: 'skipped',
    reason,
    retryable: false,
  });
}

function appendSuccessAttempt(
  history: RetryAttemptRecord[],
  route: RouteResult,
  apiType?: string
): void {
  history.push({
    index: history.length + 1,
    provider: route.provider,
    model: route.model,
    apiType,
    status: 'success',
    reason: 'Request completed successfully',
    retryable: false,
  });
}

function appendFailureAttempt(
  history: RetryAttemptRecord[],
  route: RouteResult,
  error: any,
  apiType?: string,
  retryable?: boolean
): void {
  const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;
  const reason = extractPiAiErrorMessage(error) ?? error?.message ?? 'Unknown error';
  history.push({
    index: history.length + 1,
    provider: route.provider,
    model: route.model,
    apiType,
    status: 'failed',
    reason,
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
    retryable,
  });
}

// ─── isRetryable ──────────────────────────────────────────────────────────────

function isRetryable(err: any, signal: AbortSignal | undefined): boolean {
  // Client disconnect → never retry
  if (signal?.aborted) return false;

  // Explicit not-retryable codes
  const code = err?.routingContext?.code;
  if (code === 'client_disconnected') return false;

  // AbortError (from attempt timeout) → upstream_timeout → retryable
  if (err?.name === 'AbortError' || err instanceof DOMException) return true;

  // Network-level errors
  const msg: string = err?.message ?? '';
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) return true;

  // stall errors
  if ((err as any)?.isStallError) return true;

  // 5xx HTTP errors from pi-ai
  const status = err?.routingContext?.statusCode ?? err?.status ?? err?.statusCode;
  if (typeof status === 'number' && status >= 500) return true;

  return false;
}

// ─── TTFB stall helper ────────────────────────────────────────────────────────

function nextWithTtfbTimeout<T>(
  nextPromise: Promise<IteratorResult<T>>,
  ttfbMs: number,
  onTimeout: () => void
): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Wrap in try/catch so a throwing callback cannot escape the setTimeout
      // handler as an unhandled exception before reject() is called.
      try {
        onTimeout();
      } catch {
        // onTimeout must not throw; swallow and fall through to reject below.
      }
      const stallErr = new Error(`Stream stalled: no content event within ${ttfbMs}ms`) as any;
      stallErr.isStallError = true;
      stallErr.name = 'StallError';
      reject(stallErr);
    }, ttfbMs);

    nextPromise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ─── UsageRecord population from pi-ai ───────────────────────────────────────

function buildUsageFromMessage(
  msg: AssistantMessage,
  piModel: ReturnType<typeof getBuiltinModel>,
  startTime: number,
  ttftMs: number | null,
  route: RouteResult
): {
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensCacheWrite: number;
  costInput: number;
  costOutput: number;
  costCached: number;
  costCacheWrite: number;
  costTotal: number;
  finishReason: string;
  toolCallsCount: number;
  ttftMs: number | null;
  durationMs: number;
  tokensPerSec: number | null;
  kwhUsed: number | null;
} {
  const usage = msg.usage;
  const cost = calculateCost(piModel as any, usage);
  const durationMs = Date.now() - startTime;

  const finishReasonMap: Record<string, string> = {
    stop: 'stop',
    length: 'length',
    toolUse: 'tool_calls',
    error: 'error',
    aborted: 'aborted',
  };

  const toolCallsCount = msg.content.filter((b) => b.type === 'toolCall').length;
  const tokensOutput = usage.output;

  // tokensPerSec: for streaming use post-TTFT window; for non-streaming use full duration
  let tokensPerSec: number | null = null;
  if (tokensOutput > 0 && durationMs > 0) {
    const streamingTimeMs = ttftMs != null ? durationMs - ttftMs : durationMs;
    tokensPerSec = streamingTimeMs > 0 ? (tokensOutput / streamingTimeMs) * 1000 : null;
  }

  const kwhUsed = computeKwhUsed(usage.input, tokensOutput, route);

  return {
    tokensInput: usage.input,
    tokensOutput,
    tokensCached: usage.cacheRead,
    tokensCacheWrite: usage.cacheWrite,
    costInput: cost?.input ?? 0,
    costOutput: cost?.output ?? 0,
    costCached: cost?.cacheRead ?? 0,
    costCacheWrite: cost?.cacheWrite ?? 0,
    costTotal: cost?.total ?? 0,
    finishReason: finishReasonMap[msg.stopReason] ?? msg.stopReason,
    toolCallsCount,
    ttftMs,
    durationMs,
    tokensPerSec,
    kwhUsed,
  };
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function runPiAiExecutor<TResponse>(
  input: PiAiExecutorInput<TResponse>
): Promise<PiAiExecutorResult<TResponse>> {
  const {
    requestId,
    incomingApiType,
    modelAlias,
    context,
    generationIntent,
    toolChoice,
    parallelToolCalls,
    streaming,
    request,
    usageStorage,
    quotaEnforcer,
    signal,
    onSuccess,
    toolsDefined,
    messageCount,
    serializeMessage,
    serializeChunks,
  } = input;

  const startTime = Date.now();
  const keyName: string | undefined = (request as any).keyName;
  const sourceIp: string | null = (request as any).ip ?? null;
  const attribution: string | null = (request as any).attribution ?? null;
  const debug = DebugManager.getInstance();

  // ── Emit started ──────────────────────────────────────────────────────────
  usageStorage.emitStartedAsync({
    requestId,
    date: new Date().toISOString(),
    sourceIp,
    incomingApiType,
    startTime,
    isStreamed: streaming,
    responseStatus: 'pending',
    apiKey: keyName ?? null,
    attribution,
    incomingModelAlias: modelAlias,
    toolsDefined: toolsDefined ?? null,
    messageCount: messageCount ?? null,
    parallelToolCallsEnabled: parallelToolCalls ?? null,
  });

  // ── Strip reasoning suffix from the alias (Layer 4) ───────────────────────
  // e.g. "gpt-5:high" routes as "gpt-5" with a fallback intent of effort=high.
  const { alias: routingAlias, intent: suffixIntent } = splitReasoningSuffix(modelAlias);

  // ── Resolve candidates ────────────────────────────────────────────────────
  let candidates = await Router.resolveCandidates(routingAlias, incomingApiType);
  if (candidates.length === 0) {
    try {
      candidates = [await Router.resolve(routingAlias, incomingApiType)];
    } catch {
      throw buildNoBetaCandidatesError();
    }
  }

  // ── Apply key-access policy ───────────────────────────────────────────────
  const policyReq: PolicyRequest = {
    model: routingAlias,
    metadata: (request.body as any)?.metadata,
  };
  candidates = applyKeyAccessPolicy(policyReq, candidates, incomingApiType);

  // ── Filter to beta-compatible candidates ─────────────────────────────────
  // A candidate is beta-compatible when both pi-ai hints are present AND the
  // (provider, modelId) pair resolves to a pi-ai Model — via the custom
  // registries or the built-in registry. resolvePiAiModel returns null (never
  // throws) for unknown pairs, so a null check is the correct gate.
  const betaCandidates = candidates.filter((c) => {
    const piAiProvider = (c.config as any).pi_ai_provider as string | undefined;
    const piAiModelId = (c.modelConfig as any)?.pi_ai_model_id as string | undefined;
    if (!piAiProvider || !piAiModelId) return false;
    return resolvePiAiModel(piAiProvider, piAiModelId) != null;
  });

  if (betaCandidates.length === 0) {
    throw buildNoBetaCandidatesError();
  }

  // ── Failover loop ─────────────────────────────────────────────────────────
  const retryHistory: RetryAttemptRecord[] = [];
  const attemptedProviders: string[] = [];
  let lastError: any = null;
  const failoverEnabled = betaCandidates.length > 1;
  const compactionMemo = new Map<string, CompactionResult>();

  for (let i = 0; i < betaCandidates.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = betaCandidates[i]!;
    const isLast = i === betaCandidates.length - 1;

    // ── Abort check ────────────────────────────────────────────────────────
    if (signal?.aborted) throw buildCancelledError(signal);

    // ── Per-attempt timeout ────────────────────────────────────────────────
    const attemptTimeout = createAttemptTimeout(signal, route.config.timeoutMs ?? null);

    // ── Cooldown check ─────────────────────────────────────────────────────
    const cooldown = CooldownManager.getInstance();
    const healthy = await cooldown.isProviderHealthy(route.provider, route.model);
    if (!healthy) {
      attemptTimeout.cleanup();
      appendSkippedAttempt(retryHistory, route, 'Provider in cooldown', incomingApiType);
      continue;
    }

    // ── Vision fallthrough (opt-in per alias) ──────────────────────────────
    // Mirrors dispatcher.ts:317-365, but operates natively on the pi-ai
    // Context (no UnifiedChatRequest detour). Runs before compaction/limit
    // enforcement so the candidate's estimated token count and context-limit
    // check reflect the post-fallthrough (text-only) content.
    const aliasForRoute = route.canonicalModel
      ? getConfig().models?.[route.canonicalModel]
      : undefined;
    let candidateContext = context;
    let usedVisionFallthrough = false;
    let visionFallthroughModel: string | null = null;
    if (aliasForRoute?.use_image_fallthrough && contextHasImages(candidateContext)) {
      const vfConfig = getConfig().vision_fallthrough;
      if (vfConfig?.descriptor_model) {
        try {
          candidateContext = await applyVisionFallthrough(
            candidateContext,
            vfConfig.descriptor_model,
            vfConfig.default_prompt || DEFAULT_VISION_DESCRIPTION_PROMPT,
            usageStorage,
            { sourceIp, keyName, attribution }
          );
          usedVisionFallthrough = true;
          visionFallthroughModel = vfConfig.descriptor_model;
        } catch (vfError) {
          logger.error('[pi-ai-executor] Error in vision fallthrough:', vfError);
        }
      } else {
        logger.warn(
          `[pi-ai-executor] use_image_fallthrough enabled for alias '${modelAlias}' but 'vision_fallthrough.descriptor_model' not configured globally.`
        );
      }
    }

    // ── Context compaction (opt-in per alias/provider/global) ──────────────
    // Runs before force-limit enforcement so a borderline-oversized request can
    // be rescued by compaction before it would be rejected. Fail-open: on any
    // error the original context is returned. Per-candidate, memoized.
    const compaction = await compactContextForSend(
      candidateContext,
      route,
      modelAlias,
      compactionMemo,
      attemptTimeout.signal
    );
    const sendContext = compaction.compacted ? compaction.context : candidateContext;

    // ── Force-limit enforcement (opt-in per alias) ─────────────────────────
    // Mirrors dispatcher.ts:384-394. Checked AFTER cooldown and BEFORE
    // acquiring a concurrency slot, so a thrown ContextLengthExceededError
    // (client-side; failover won't help) never leaks an acquired slot.
    const aliasForLimit = aliasForRoute;
    try {
      enforceContextLimitForRoute(
        sendContext,
        route,
        aliasForLimit,
        generationIntent.maxTokens,
        incomingApiType
      );
    } catch (limitErr) {
      attemptTimeout.cleanup();
      appendFailureAttempt(retryHistory, route, limitErr, incomingApiType, false);
      throw limitErr;
    }

    // ── Concurrency acquire ────────────────────────────────────────────────
    const concurrency = ConcurrencyTracker.getInstance();
    const acquired = concurrency.acquire(route.provider, route.model);
    if (!acquired) {
      attemptTimeout.cleanup();
      appendSkippedAttempt(retryHistory, route, 'Concurrency limit reached', incomingApiType);
      continue;
    }

    // ── Build pi-ai model (defensive check — filter should have removed invalids) ──
    const piAiProvider = (route.config as any).pi_ai_provider as string;
    const piAiModelId = (route.modelConfig as any)?.pi_ai_model_id as string;
    if (!piAiProvider || !piAiModelId) {
      concurrency.release(route.provider, route.model);
      attemptTimeout.cleanup();
      const err = new Error('Missing pi_ai_provider or pi_ai_model_id on route config') as any;
      err.routingContext = { statusCode: 400, code: 'missing_pi_ai_hint' };
      throw err;
    }

    const piModel = buildPiAiModel(route.config, piAiProvider, piAiModelId, incomingApiType);
    if (!piModel) {
      // Should not happen (beta filter resolves the same way) but fail closed.
      concurrency.release(route.provider, route.model);
      attemptTimeout.cleanup();
      const err = new Error(
        `pi-ai model could not be resolved for ${piAiProvider}/${piAiModelId}`
      ) as any;
      err.routingContext = { statusCode: 400, code: 'unresolved_pi_ai_model' };
      throw err;
    }

    // ── Debug: set provider for this request ──────────────────────────────
    debug.setProviderForRequest(requestId, route.provider);

    // ── Emit routing update ───────────────────────────────────────────────
    usageStorage.emitUpdatedAsync({
      requestId,
      provider: route.provider,
      selectedModelName: route.model,
      canonicalModelName: route.canonicalModel ?? null,
    });

    attemptedProviders.push(`${route.provider}/${route.model}`);

    // ── Assemble ProviderStreamOptions ────────────────────────────────────
    const bodyHasSignal =
      generationIntent.reasoning.effort != null ||
      generationIntent.reasoning.budgetTokens != null ||
      generationIntent.reasoning.enabled != null;
    const chosenReasoning = bodyHasSignal
      ? generationIntent.reasoning
      : (suffixIntent ?? generationIntent.reasoning);
    const effectiveGeneration: GenerationIntent = {
      ...generationIntent,
      reasoning: chosenReasoning,
    };
    const generationOpts = buildGenerationOptions(piModel as any, effectiveGeneration);
    const callOptions: ProviderStreamOptions = {
      ...generationOpts,
      ...(toolChoice != null ? { toolChoice } : {}),
      ...(parallelToolCalls != null ? { parallelToolCalls } : {}),
      apiKey: route.config.api_key,
      headers: route.config.headers,
      signal: attemptTimeout.signal,
      onPayload: (payload: unknown) => {
        // Run within the debug requestId context so the fetch tap can correlate
        debugRequestIdStorage.run(requestId, () => {
          debug.addTransformedRequest(requestId, payload);
        });
        return undefined;
      },
    };

    // ── Stall config ──────────────────────────────────────────────────────
    // Per-provider stallTtfbMs (ms) takes precedence; fall back to global
    // stall.ttfbSeconds (seconds, so multiply by 1000).
    const globalStallTtfbMs =
      getConfig().stall?.ttfbSeconds != null ? getConfig().stall!.ttfbSeconds! * 1000 : null;
    const stallTtfbMs: number | null = (route.config as any).stallTtfbMs ?? globalStallTtfbMs;
    const stallCooldownEnabled: boolean = route.config.stall_cooldown !== false;

    // Compaction metadata surfaced as x-plexus-compaction-* headers on BOTH the
    // non-streaming and streaming paths.
    const compactionMeta = compaction.compacted
      ? {
          strategy: compaction.strategy,
          tokensBefore: compaction.tokensBefore,
          tokensAfter: compaction.tokensAfter,
        }
      : undefined;

    try {
      if (!streaming) {
        // ── Non-streaming ────────────────────────────────────────────────
        const message = await debugRequestIdStorage.run(requestId, () =>
          piAiModels.complete(toDispatchModel(piModel as any), sendContext, callOptions)
        );

        cooldown.markProviderSuccess(route.provider, route.model);
        appendSuccessAttempt(retryHistory, route, incomingApiType);
        concurrency.release(route.provider, route.model);
        attemptTimeout.cleanup();

        // ── Build usage record ─────────────────────────────────────────
        const ttftMs = consumeTtfb(requestId);
        const usageData = buildUsageFromMessage(message, piModel as any, startTime, ttftMs, route);
        const usageRecord = {
          requestId,
          date: new Date().toISOString(),
          sourceIp,
          apiKey: keyName ?? null,
          attribution,
          incomingApiType,
          provider: route.provider,
          attemptCount: i + 1,
          retryHistory: retryHistory.length > 0 ? JSON.stringify(retryHistory) : null,
          incomingModelAlias: modelAlias,
          canonicalModelName: route.canonicalModel ?? null,
          selectedModelName: route.model,
          finalAttemptProvider: route.provider,
          finalAttemptModel: route.model,
          allAttemptedProviders: attemptedProviders.join(', '),
          outgoingApiType: piModel.api,
          isStreamed: false,
          responseStatus: 'success',
          costSource: 'pi-ai',
          toolsDefined: toolsDefined ?? null,
          messageCount: messageCount ?? null,
          parallelToolCallsEnabled: parallelToolCalls ?? null,
          startTime,
          costMetadata: null,
          tokensReasoning: null,
          isVisionFallthrough: usedVisionFallthrough,
          visionFallthroughModel,
          ...usageData,
        };

        debug.addTransformedResponse(requestId, message);
        debug.addTransformedResponseSnapshot(requestId, message);
        await usageStorage.saveRequest(usageRecord as any);
        await usageStorage.updatePerformanceMetrics(
          route.provider,
          route.model,
          route.canonicalModel ?? null,
          null,
          usageData.tokensOutput > 0 ? usageData.tokensOutput : null,
          usageData.durationMs,
          requestId
        );
        if (quotaEnforcer) await recordQuotaUsage(keyName, usageRecord, quotaEnforcer);
        debug.flush(requestId);

        await onSuccess?.(message);

        return {
          response: serializeMessage(message),
          compaction: compactionMeta,
        };
      } else {
        // ── Streaming ────────────────────────────────────────────────────
        const eventStream = await debugRequestIdStorage.run(requestId, () =>
          piAiModels.stream(toDispatchModel(piModel as any), sendContext, callOptions)
        );

        // Build and return the SSE generator — the generator owns
        // release, timeout cleanup, usage, quota, debug flush.
        const gen = buildSSEGenerator({
          requestId,
          eventStream,
          route,
          piModel: piModel as any,
          attemptTimeout,
          stallTtfbMs,
          stallCooldownEnabled,
          cooldown,
          concurrency,
          usageStorage,
          quotaEnforcer,
          keyName,
          sourceIp,
          attribution,
          incomingApiType,
          modelAlias,
          attemptedProviders,
          attemptCount: i + 1,
          retryHistory,
          startTime,
          toolsDefined: toolsDefined ?? null,
          messageCount: messageCount ?? null,
          parallelToolCalls: parallelToolCalls ?? null,
          isVisionFallthrough: usedVisionFallthrough,
          visionFallthroughModel,
          debug,
          onSuccess,
          serializeChunks,
        });

        return { stream: gen, compaction: compactionMeta };
      }
    } catch (err: any) {
      const effectiveErr = attemptTimeout.isTimedOut() ? buildTimeoutError() : err;

      // Clean up any TTFB entry that wasn't consumed (non-streaming error path)
      consumeTtfb(requestId);

      if (signal?.aborted) {
        concurrency.release(route.provider, route.model);
        attemptTimeout.cleanup();
        throw buildCancelledError(signal);
      }

      // Mark cooldown
      if ((effectiveErr as any)?.isStallError) {
        if (stallCooldownEnabled) {
          cooldown.markProviderStallFailure(route.provider, route.model, effectiveErr.message);
        }
      } else {
        cooldown.markProviderFailure(route.provider, route.model);
      }

      concurrency.release(route.provider, route.model);
      attemptTimeout.cleanup();

      const canRetry = failoverEnabled && !isLast && isRetryable(effectiveErr, signal);
      appendFailureAttempt(retryHistory, route, effectiveErr, incomingApiType, canRetry);

      if (canRetry) {
        if (usageStorage) {
          usageStorage
            .saveError(requestId, effectiveErr, { apiType: incomingApiType })
            .catch(() => {});
        }
        lastError = effectiveErr;
        continue;
      }

      lastError = effectiveErr;
      break;
    }
  }

  throw buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
}

// ─── Streaming generator ──────────────────────────────────────────────────────

interface SSEGeneratorParams {
  requestId: string;
  eventStream: AsyncIterable<AssistantMessageEvent>;
  route: RouteResult;
  piModel: any;
  attemptTimeout: ReturnType<typeof createAttemptTimeout>;
  stallTtfbMs: number | null;
  stallCooldownEnabled: boolean;
  cooldown: CooldownManager;
  concurrency: ConcurrencyTracker;
  usageStorage: UsageStorageService;
  quotaEnforcer?: QuotaEnforcer;
  keyName?: string;
  sourceIp: string | null;
  attribution: string | null;
  incomingApiType: string;
  modelAlias: string;
  attemptedProviders: string[];
  attemptCount: number;
  retryHistory: RetryAttemptRecord[];
  startTime: number;
  toolsDefined: number | null;
  messageCount: number | null;
  parallelToolCalls: boolean | null;
  isVisionFallthrough: boolean;
  visionFallthroughModel: string | null;
  debug: DebugManager;
  onSuccess?: (msg: AssistantMessage) => void | Promise<void>;
  serializeChunks: (event: AssistantMessageEvent) => string[];
}

async function* buildSSEGenerator(p: SSEGeneratorParams): AsyncGenerator<string> {
  const {
    requestId,
    eventStream,
    route,
    piModel,
    attemptTimeout,
    stallTtfbMs,
    stallCooldownEnabled,
    cooldown,
    concurrency,
    usageStorage,
    quotaEnforcer,
    keyName,
    sourceIp,
    attribution,
    incomingApiType,
    modelAlias,
    attemptedProviders,
    attemptCount,
    retryHistory,
    startTime,
    toolsDefined,
    messageCount,
    parallelToolCalls,
    isVisionFallthrough,
    visionFallthroughModel,
    debug,
    onSuccess,
    serializeChunks,
  } = p;

  let hasEmittedClientFrame = false;
  let ttftMs: number | null = null;
  let lastMessage: AssistantMessage | null = null;
  let transformedStreamSnapshot = '';
  let released = false;

  const doRelease = () => {
    if (released) return;
    released = true;
    concurrency.release(route.provider, route.model);
    attemptTimeout.cleanup();
  };

  try {
    const iterator = (eventStream as AsyncIterable<AssistantMessageEvent>)[Symbol.asyncIterator]();
    let sawContentEvent = false;
    const streamStart = Date.now();

    while (true) {
      // ── TTFB stall detection ───────────────────────────────────────────
      let nextResult: IteratorResult<AssistantMessageEvent>;
      if (stallTtfbMs != null && !sawContentEvent) {
        nextResult = await nextWithTtfbTimeout(
          iterator.next() as Promise<IteratorResult<AssistantMessageEvent>>,
          stallTtfbMs,
          () => {
            // Side-effects only — do not throw here.
            // nextWithTtfbTimeout creates and rejects with the StallError itself.
          }
        );
      } else {
        nextResult = await (iterator.next() as Promise<IteratorResult<AssistantMessageEvent>>);
      }

      if (nextResult.done) break;

      const event = nextResult.value;

      // Mark when we first see a non-start event
      if (event.type !== 'start' && !sawContentEvent) {
        sawContentEvent = true;
        ttftMs = Date.now() - streamStart;
      }

      // Track last message for debug
      if (event.type === 'done') {
        lastMessage = event.message;
      } else if (event.type === 'error') {
        lastMessage = event.error;
      } else if ('partial' in event) {
        lastMessage = event.partial;
      }

      // Serialize and yield frames
      const frames = serializeChunks(event);
      for (const frame of frames) {
        if (!hasEmittedClientFrame && frame.trim()) {
          hasEmittedClientFrame = true;
        }
        transformedStreamSnapshot += frame;
        yield frame;
      }

      // Terminal events — handle success/error and break
      if (event.type === 'done') {
        const msg = event.message;
        await cooldown.markProviderSuccess(route.provider, route.model);
        appendSuccessAttempt(retryHistory, route, incomingApiType);
        doRelease();

        const usageData = buildUsageFromMessage(msg, piModel, startTime, ttftMs, route);
        const usageRecord = {
          requestId,
          date: new Date().toISOString(),
          sourceIp,
          apiKey: keyName ?? null,
          attribution,
          incomingApiType,
          provider: route.provider,
          attemptCount,
          retryHistory: retryHistory.length > 0 ? JSON.stringify(retryHistory) : null,
          incomingModelAlias: modelAlias,
          canonicalModelName: route.canonicalModel ?? null,
          selectedModelName: route.model,
          finalAttemptProvider: route.provider,
          finalAttemptModel: route.model,
          allAttemptedProviders: attemptedProviders.join(', '),
          outgoingApiType: piModel.api,
          isStreamed: true,
          responseStatus: 'success',
          costSource: 'pi-ai',
          toolsDefined,
          messageCount,
          parallelToolCallsEnabled: parallelToolCalls,
          startTime,
          costMetadata: null,
          tokensReasoning: null,
          isVisionFallthrough,
          visionFallthroughModel,
          ...usageData,
        };

        if (transformedStreamSnapshot) {
          debug.addTransformedResponse(requestId, transformedStreamSnapshot);
          debug.addTransformedResponseSnapshot(requestId, transformedStreamSnapshot);
        } else if (lastMessage) {
          debug.addTransformedResponse(requestId, lastMessage);
          debug.addTransformedResponseSnapshot(requestId, lastMessage);
        }
        await usageStorage.saveRequest(usageRecord as any);
        await usageStorage.updatePerformanceMetrics(
          route.provider,
          route.model,
          route.canonicalModel ?? null,
          usageData.ttftMs,
          usageData.tokensOutput > 0 ? usageData.tokensOutput : null,
          usageData.durationMs,
          requestId
        );
        if (quotaEnforcer) await recordQuotaUsage(keyName, usageRecord, quotaEnforcer);
        await onSuccess?.(msg);
        break;
      }

      if (event.type === 'error') {
        const errorMessage = extractPiAiErrorMessage(event.error) ?? 'Upstream error';
        const usageRecord = {
          requestId,
          date: new Date().toISOString(),
          sourceIp,
          apiKey: keyName ?? null,
          attribution,
          incomingApiType,
          provider: route.provider,
          attemptCount,
          retryHistory: retryHistory.length > 0 ? JSON.stringify(retryHistory) : null,
          incomingModelAlias: modelAlias,
          canonicalModelName: route.canonicalModel ?? null,
          selectedModelName: route.model,
          finalAttemptProvider: route.provider,
          finalAttemptModel: route.model,
          allAttemptedProviders: attemptedProviders.join(', '),
          outgoingApiType: piModel.api,
          isStreamed: true,
          responseStatus: 'error',
          costSource: 'pi-ai',
          toolsDefined,
          messageCount,
          parallelToolCallsEnabled: parallelToolCalls,
          startTime,
          durationMs: Date.now() - startTime,
          costMetadata: null,
          tokensReasoning: null,
          tokensInput: null,
          tokensOutput: null,
          tokensCached: null,
          tokensCacheWrite: null,
          costInput: null,
          costOutput: null,
          costCached: null,
          costCacheWrite: null,
          costTotal: null,
          ttftMs,
          finishReason: 'error',
          toolCallsCount: null,
          isVisionFallthrough,
          visionFallthroughModel,
        };

        if (transformedStreamSnapshot) {
          debug.addTransformedResponse(requestId, transformedStreamSnapshot);
          debug.addTransformedResponseSnapshot(requestId, transformedStreamSnapshot);
        } else {
          debug.addTransformedResponse(requestId, event.error);
          debug.addTransformedResponseSnapshot(requestId, event.error);
        }
        await usageStorage.saveRequest(usageRecord as any);
        await usageStorage.saveError(requestId, new Error(errorMessage), {
          apiType: incomingApiType,
          provider: route.provider,
          targetModel: route.model,
          targetApiType: piModel.api,
          providerResponse: event.error,
        });
        doRelease();
        // Surface error as a final frame then close
        break;
      }
    }
  } catch (err: any) {
    doRelease();

    // Save error usage record
    const usageRecord = {
      requestId,
      date: new Date().toISOString(),
      sourceIp,
      apiKey: keyName ?? null,
      attribution,
      incomingApiType,
      provider: route.provider,
      attemptCount,
      retryHistory: retryHistory.length > 0 ? JSON.stringify(retryHistory) : null,
      incomingModelAlias: modelAlias,
      canonicalModelName: route.canonicalModel ?? null,
      selectedModelName: route.model,
      finalAttemptProvider: route.provider,
      finalAttemptModel: route.model,
      allAttemptedProviders: attemptedProviders.join(', '),
      outgoingApiType: piModel.api,
      isStreamed: true,
      responseStatus: err?.isStallError
        ? 'timeout'
        : err?.name === 'AbortError'
          ? 'timeout'
          : 'error',
      costSource: 'pi-ai',
      toolsDefined,
      messageCount,
      parallelToolCallsEnabled: parallelToolCalls,
      startTime,
      durationMs: Date.now() - startTime,
      costMetadata: null,
      tokensReasoning: null,
      tokensInput: null,
      tokensOutput: null,
      tokensCached: null,
      tokensCacheWrite: null,
      costInput: null,
      costOutput: null,
      costCached: null,
      costCacheWrite: null,
      costTotal: null,
      ttftMs,
      finishReason: 'error',
      toolCallsCount: null,
      isVisionFallthrough,
      visionFallthroughModel,
    };

    usageStorage.saveRequest(usageRecord as any).catch(() => {});
    usageStorage.saveError(requestId, err, { apiType: incomingApiType }).catch(() => {});

    // Stall failures trigger cooldown only when enabled
    if (err?.isStallError) {
      if (stallCooldownEnabled) {
        cooldown.markProviderStallFailure(route.provider, route.model, err.message).catch(() => {});
      }
    } else {
      cooldown.markProviderFailure(route.provider, route.model).catch(() => {});
    }

    // Don't re-throw after first client frame — log and close
    if (hasEmittedClientFrame) {
      logger.error(
        `[pi-ai-executor] Stream error after first client frame on ${route.provider}/${route.model}: ${err?.message}`
      );
    } else {
      throw err;
    }
  } finally {
    doRelease();
    debug.flush(requestId);
  }
}
