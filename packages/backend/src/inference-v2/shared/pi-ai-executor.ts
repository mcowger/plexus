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
import { CodexVersionService } from '../../services/codex-version-service';
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
  isOAuthRoute,
  isClaudeMaskingApiKeyRoute,
} from './pi-ai-utils';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import type { GenerationIntent } from './generation';
import { splitReasoningSuffix } from './reasoning';
import { consumeTtfb } from './fetch-tap';
import { extractPiAiErrorMessage } from '../../transformers/oauth/type-mappers';
import {
  applyClaudeCodeMasking,
  getStainlessHeaders,
  reverseToolRenames,
  REQUIRED_BETAS,
  type RenamePair,
} from './tool-fingerprint';
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

// ─── Assistant provenance alignment (signature replay) ──────────────────────

/**
 * Re-stamp each AssistantMessage's provenance (provider / model / api) to match
 * the resolved dispatch model, returning a new Context when anything changed
 * (never mutates the input).
 *
 * WHY: pi-ai's request serializers gate replay of provider-specific signatures
 * — Gemini `thoughtSignature` on functionCall/text/thinking parts, Anthropic
 * thinking signatures, OpenAI reasoning signatures — on the assistant message's
 * provenance matching the target model. Google's serializer uses
 * `isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id`
 * (see @earendil-works/pi-ai `api/google-shared.js`); the OpenAI-responses
 * serializer additionally checks `msg.api === model.api`.
 *
 * The inference-v2 inbound parsers stamp the CLIENT-FACING provider/alias on
 * assistant messages (e.g. `provider: 'google'`, `model: 'gemini-3.5-flash'`),
 * which never matches the resolved egress pi-ai model (`pi_ai_provider` /
 * `pi_ai_model_id`). Without this alignment pi-ai silently drops the
 * signatures, and Gemini 3.x rejects the next turn with HTTP 400
 * "Function call is missing a thought_signature ... This is required for tools
 * to work correctly". This breaks all multi-turn tool calling for Gemini 3.x
 * thinking models on the second turn.
 *
 * This mirrors the v1 OAuth path, which stamps the resolved model's
 * provider/model/api onto replayed assistant messages for exactly this reason
 * (see transformers/oauth/oauth-transformer.ts). Applied per-candidate so a
 * failover to a different target re-stamps against that target (and pi-ai's
 * own base64 validity check still guards against replaying a foreign-format
 * signature to the wrong provider).
 */
export function alignAssistantProvenance(
  context: Context,
  dispatchModel: { provider: string; id: string; api: string }
): Context {
  let mutated = false;
  const messages = context.messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const asst = m as AssistantMessage;
    if (
      asst.provider === dispatchModel.provider &&
      asst.model === dispatchModel.id &&
      asst.api === dispatchModel.api
    ) {
      return m;
    }
    mutated = true;
    return {
      ...asst,
      provider: dispatchModel.provider,
      model: dispatchModel.id,
      api: dispatchModel.api as AssistantMessage['api'],
    };
  });
  return mutated ? { ...context, messages } : context;
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
  // Also supports OAuth and Claude Masking API key routes natively.
  const betaCandidates = candidates.filter((c) => {
    const isOAuth = isOAuthRoute(c, incomingApiType);
    const isClaudeMasking = isClaudeMaskingApiKeyRoute(c, incomingApiType);
    if (isOAuth || isClaudeMasking) {
      const piAiProvider = isClaudeMasking
        ? 'anthropic'
        : (c.config as any).oauth_provider || c.provider;
      const piAiModelId = c.model;
      return resolvePiAiModel(piAiProvider, piAiModelId) != null;
    }

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

    // ── Resolve pi-ai provider and model ID ──────────────────────────────────
    const isOAuth = isOAuthRoute(route, incomingApiType);
    const isClaudeMasking = isClaudeMaskingApiKeyRoute(route, incomingApiType);
    let piAiProvider: string | undefined;
    let piAiModelId: string | undefined;

    if (isOAuth || isClaudeMasking) {
      piAiProvider = isClaudeMasking
        ? 'anthropic'
        : (route.config as any).oauth_provider || route.provider;
      piAiModelId = route.model;
    } else {
      piAiProvider = (route.config as any).pi_ai_provider as string | undefined;
      piAiModelId = (route.modelConfig as any)?.pi_ai_model_id as string | undefined;
    }

    logger.debug('[pi-ai-executor] RESOLVED_CANDIDATE_ROUTE:', {
      provider: route.provider,
      model: route.model,
      api_base_url: route.config.api_base_url,
      isOAuth,
      isClaudeMasking,
      piAiProvider,
      piAiModelId,
    });

    if (!piAiProvider || !piAiModelId) {
      concurrency.release(route.provider, route.model);
      attemptTimeout.cleanup();
      const err = new Error('Missing pi_ai_provider or pi_ai_model_id on route config') as any;
      err.routingContext = { statusCode: 400, code: 'missing_pi_ai_hint' };
      throw err;
    }

    const configForBuild =
      isOAuth &&
      typeof route.config.api_base_url === 'string' &&
      route.config.api_base_url.startsWith('oauth://')
        ? { ...route.config, api_base_url: '' }
        : route.config;

    const piModel = buildPiAiModel(configForBuild, piAiProvider, piAiModelId, incomingApiType);
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

    // ── Resolve authentication and keys ──────────────────────────────────────
    let apiKey = route.config.api_key;
    let authMode: 'oauth' | 'apiKey' = 'apiKey';
    let accountId = '';

    if (isOAuth || isClaudeMasking) {
      if (isClaudeMasking) {
        apiKey = route.config.api_key?.trim() || '';
        authMode = 'apiKey';
      } else {
        authMode = 'oauth';
        accountId = route.config.oauth_account?.trim() || '';
        if (!accountId) {
          concurrency.release(route.provider, route.model);
          attemptTimeout.cleanup();
          throw new Error(
            `OAuth account is not configured for provider '${route.provider}'. ` +
              `Set providers.${route.provider}.oauth_account in plexus config.`
          );
        }
        const authManager = OAuthAuthManager.getInstance();
        apiKey = await authManager.getApiKey(piAiProvider, accountId);
      }
    }

    const rawApiKey = apiKey;
    if (piAiProvider === 'anthropic' && authMode === 'apiKey') {
      apiKey = `sk-ant-oat-mask-${rawApiKey}`;
    }
    const isClaudeCodeToken = rawApiKey?.includes('sk-ant-oat') ?? false;

    if (
      piAiProvider === 'github-copilot' &&
      apiKey?.includes('proxy-ep=proxy.business.githubcopilot.com') &&
      piModel
    ) {
      logger.debug(
        `[pi-ai-executor] GitHub Business account detected; forcing standard API endpoint`
      );
      piModel.baseUrl = 'https://api.githubcopilot.com';
    }

    logger.debug('[pi-ai-executor] RESOLVED_KEYS:', {
      authMode,
      accountId,
      hasApiKey: !!apiKey,
      isClaudeCodeToken,
      resolvedBaseUrl: piModel?.baseUrl,
    });

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

    let userAgent = '';
    let codexVersion = '';
    if (piAiProvider === 'openai-codex') {
      const codexVersionService = CodexVersionService.getInstance();
      codexVersion = codexVersionService.getVersion();
      userAgent = codexVersionService.getUserAgent();
    }

    const baseHeaders: Record<string, string> = {
      ...((generationOpts as any).headers as Record<string, string>),
      ...(codexVersion ? { Version: codexVersion } : {}),
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(piAiProvider === 'anthropic' && authMode === 'apiKey'
        ? { 'x-api-key': rawApiKey || '' }
        : {}),
      ...(route.config.headers as Record<string, string>),
    };

    if (piAiProvider === 'anthropic' && (isClaudeCodeToken || authMode === 'apiKey')) {
      const stainless = getStainlessHeaders();
      Object.assign(baseHeaders, stainless);
      // pi-ai's own OAuth client only sets 2 of the 8 beta flags real
      // Claude Code sends (claude-code-20250219, oauth-2025-04-20) plus
      // whatever interleaved-thinking/fine-grained-streaming flags apply to
      // the model. `options.headers` is the last-merged (i.e. overriding)
      // header source in pi-ai's `createClient()`, so setting the full
      // list here replaces pi-ai's narrower default rather than fighting it.
      baseHeaders['anthropic-beta'] = REQUIRED_BETAS.join(',');
    }

    let oauthContext = {
      apiKey: apiKey || '',
      isOAuth: isOAuth && authMode === 'oauth',
      toolNamesRemapped: false,
    };

    // Populated inside onPayload from the actual outgoing tool list, then
    // stashed on piModel so the response-side reverseToolRenames() calls
    // (both the non-streaming path below and the streaming path in
    // buildSSEGenerator) can reverse the exact same renames — see
    // tool-fingerprint/registry.ts.
    let toolRenamePairs: RenamePair[] = [];

    const callOptions: ProviderStreamOptions = {
      ...generationOpts,
      ...(toolChoice != null ? { toolChoice } : {}),
      ...(parallelToolCalls != null ? { parallelToolCalls } : {}),
      apiKey,
      headers: baseHeaders,
      signal: attemptTimeout.signal,
      onPayload: (payload: unknown) => {
        let finalPayload = payload;
        if ((isOAuth || isClaudeMasking) && piAiProvider === 'anthropic' && isClaudeCodeToken) {
          const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
          // Full v2 Claude Code OAuth-masking pipeline — see
          // tool-fingerprint/apply-masking.ts for the step-by-step
          // rationale (tool renames computed for the caller's actual tool
          // surface, synthetic tool injection + dedupe, system-prompt
          // identity replacement, CCH signing).
          const masked = applyClaudeCodeMasking(payloadStr);
          finalPayload = masked.payload;
          toolRenamePairs = masked.toolRenamePairs;

          oauthContext = {
            apiKey: apiKey || '',
            isOAuth: true,
            toolNamesRemapped: toolRenamePairs.length > 0,
          };
          (piModel as any).__oauthContext = oauthContext;
          (piModel as any).__toolRenamePairs = toolRenamePairs;
        }

        const payloadStr =
          typeof finalPayload === 'string' ? finalPayload : JSON.stringify(finalPayload);
        logger.debug(`[pi-ai-executor] FULL-OUTGOING-PAYLOAD ${payloadStr}`);

        debugRequestIdStorage.run(requestId, () => {
          debug.addTransformedRequest(requestId, finalPayload);
        });
        return finalPayload;
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

    // ── Align assistant provenance for signature replay ──────────────────
    // Re-stamp replayed assistant messages with the DISPATCH model's
    // provider/model/api so pi-ai's serializers echo provider-specific
    // signatures (Gemini thoughtSignature, Anthropic thinking, OpenAI
    // reasoning) instead of silently dropping them. Must use the dispatch
    // model (post toDispatchModel remap) because that is what pi-ai's
    // isSameProviderAndModel gate compares against.
    const dispatchModel = toDispatchModel(piModel as any);
    const dispatchContext = alignAssistantProvenance(sendContext, {
      provider: dispatchModel.provider,
      id: dispatchModel.id,
      api: dispatchModel.api,
    });

    try {
      if (!streaming) {
        // ── Non-streaming ────────────────────────────────────────────────
        const message = await debugRequestIdStorage.run(requestId, () =>
          piAiModels.complete(dispatchModel, dispatchContext, callOptions)
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

        const serialized = serializeMessage(message);
        let finalResponse = serialized;
        if (isOAuth || isClaudeMasking) {
          const serializedStr = JSON.stringify(serialized);
          const reversedStr = reverseToolRenames(serializedStr, toolRenamePairs);
          finalResponse = JSON.parse(reversedStr);
        }

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
          response: finalResponse,
          compaction: compactionMeta,
        };
      } else {
        // ── Streaming ────────────────────────────────────────────────────
        const eventStream = await debugRequestIdStorage.run(requestId, () =>
          piAiModels.stream(dispatchModel, dispatchContext, callOptions)
        );

        // Build and return the SSE generator — the generator owns
        // release, timeout cleanup, usage, quota, debug flush.
        const gen = buildSSEGenerator({
          requestId,
          eventStream,
          route,
          piModel: piModel as any,
          toolRenamePairs,
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
  toolRenamePairs: RenamePair[];
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
    toolRenamePairs: initialToolRenamePairs,
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
      const isOAuth = isOAuthRoute(route, incomingApiType);
      const isClaudeMasking = isClaudeMaskingApiKeyRoute(route, incomingApiType);
      const frames = serializeChunks(event);
      // `initialToolRenamePairs` is a snapshot taken before pi-ai's lazyStream
      // ran its async setup (which calls onPayload and computes the real
      // rename pairs), so it is always [] here — see pi-ai-executor.ts's
      // onPayload comment. onPayload mutates piModel.__toolRenamePairs
      // in place before emitting any event, so read that live value instead.
      const toolRenamePairs: RenamePair[] =
        (piModel as any).__toolRenamePairs ?? initialToolRenamePairs;
      for (const frame of frames) {
        if (!hasEmittedClientFrame && frame.trim()) {
          hasEmittedClientFrame = true;
        }
        let finalFrame = frame;
        if (isOAuth || isClaudeMasking) {
          finalFrame = reverseToolRenames(frame, toolRenamePairs);
        }
        transformedStreamSnapshot += finalFrame;
        yield finalFrame;
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
