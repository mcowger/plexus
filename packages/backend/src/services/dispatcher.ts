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
} from '../types/unified';
import { Router } from './router';
import { applyKeyAccessPolicy } from './key-access-policy';
import { QuotaEnforcer } from './quota/quota-enforcer';
import { buildQuotaExceededError } from './quota/quota-middleware';
import { TransformerFactory } from './transformer-factory';
import { logger } from '../utils/logger';
import { QUOTA_ERROR_PATTERNS } from '../utils/constants';
import { CooldownManager } from './cooldown-manager';
import { StickySessionManager } from './sticky-session-manager';
import { RouteResult } from './router';
import { DebugManager } from './debug-manager';
import { UsageStorageService } from './usage-storage';
import { CooldownParserRegistry } from './cooldown-parsers';
import { getConfig, getProviderTypes } from '../config';
import { applyModelBehaviors } from './model-behaviors';
import { EmbeddingsTransformerFactory } from './embeddings-transformer-factory';
import { resolveAdapters } from './adapter-resolver';
import type { ResolvedAdapter } from '../types/provider-adapter';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { buildGenerationOptions, resolvePiAiModel } from './pi-ai/registry';
import type { GenerationIntent } from './pi-ai/generation';
import { normalizeVerbosity } from './pi-ai/generation';
import type { ReasoningIntent, ReasoningVisibility } from './pi-ai/reasoning';
import { normalizeEffort, normalizeVisibility } from './pi-ai/reasoning';
import type { StallConfig } from './inspectors/stall-inspector';
import { getGlobalStallConfig, resolveStallConfig } from '../utils/stall';
import { VisionDescriptorService } from './vision-descriptor-service';
import { ModelMetadataManager } from './model-metadata-manager';
import { enforceContextLimit } from './enforce-limits';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../utils/constants';
import { UsageRecord } from '../types/usage';
import { calculateCosts } from '../utils/calculate-costs';
import { resolveModelParams, DEFAULT_GPU_PARAMS } from '@plexus/shared';
import type { GpuParams, ModelParams } from '@plexus/shared';
import { ConcurrencyTracker } from './concurrency-tracker';
import { sanitizeHeaders } from '../utils/sanitize-headers';

interface RetryAttemptRecord {
  index: number;
  provider: string;
  model: string;
  apiType?: string;
  status: 'success' | 'failed' | 'skipped';
  reason: string;
  statusCode?: number;
  retryable?: boolean;
  providerResponseHeaders?: Record<string, string>;
}

interface ParseFailureContext {
  rawResponseText: string;
  contentType?: string | null;
}

interface RetryHistoryLikeEntry {
  reason?: unknown;
}

type ResolveTimeoutMs = (timeoutMs?: number | null) => number;

/**
 * Request-level API types (e.g. embeddings, transcriptions) share base URLs
 * with their provider-level counterparts (e.g. chat, gemini). This map defines
 * which provider-level URL keys to try when no exact or default URL is configured.
 */
const API_TYPE_ALIASES: Record<string, string[]> = {
  embeddings: ['chat', 'gemini'],
  transcriptions: ['chat', 'gemini'],
  speech: ['chat', 'gemini'],
  images: ['chat', 'gemini'],
};

function hasOwn(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeReasoningFromUnified(
  reasoning: UnifiedChatRequest['reasoning']
): ReasoningIntent {
  const effort = normalizeEffort(reasoning?.effort);
  const enabled = effort === 'off' ? false : reasoning?.enabled;
  const visibility = normalizeVisibility(reasoning?.summary);
  return {
    ...(effort && effort !== 'off' ? { effort } : {}),
    ...(reasoning?.max_tokens != null ? { budgetTokens: reasoning.max_tokens } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(visibility ? { visibility } : {}),
    ...(reasoning?.summary ? { summaryDetail: reasoning.summary } : {}),
    source: 'client',
  };
}

function extractReasoningIntent(payload: any, request: UnifiedChatRequest): ReasoningIntent {
  const source = payload && typeof payload === 'object' ? payload : {};
  const incomingApiType = request.incomingApiType?.toLowerCase();

  if (incomingApiType === 'messages' && source.thinking && typeof source.thinking === 'object') {
    const thinking = source.thinking;
    const type = typeof thinking.type === 'string' ? thinking.type.toLowerCase() : undefined;
    const display = thinking.display;
    return {
      ...(type === 'disabled' ? { enabled: false } : { enabled: true }),
      ...(type === 'adaptive' ? { adaptive: true } : {}),
      ...(typeof thinking.budget_tokens === 'number'
        ? { budgetTokens: thinking.budget_tokens }
        : {}),
      ...(normalizeVisibility(display) ? { visibility: normalizeVisibility(display) } : {}),
      source: 'client',
    };
  }

  const rawReasoning = source.reasoning ?? request.reasoning;
  if (rawReasoning && typeof rawReasoning === 'object') {
    const effort = normalizeEffort((rawReasoning as any).effort);
    const summaryDetail =
      typeof (rawReasoning as any).summary === 'string' ? (rawReasoning as any).summary : undefined;
    const visibility = normalizeVisibility(summaryDetail);
    return {
      ...(effort === 'off' ? {} : effort ? { effort } : {}),
      ...(effort === 'off' ? { enabled: false } : {}),
      ...(typeof (rawReasoning as any).max_tokens === 'number'
        ? { budgetTokens: (rawReasoning as any).max_tokens }
        : {}),
      ...((rawReasoning as any).enabled !== undefined
        ? { enabled: (rawReasoning as any).enabled === true }
        : {}),
      ...(visibility ? { visibility } : {}),
      ...(summaryDetail ? { summaryDetail } : {}),
      source: 'client',
    };
  }

  const chatEffort = normalizeEffort(source.reasoning_effort);
  if (chatEffort) {
    return chatEffort === 'off'
      ? { enabled: false, source: 'client' }
      : { effort: chatEffort, enabled: true, source: 'client' };
  }

  const thinkingConfig = source.generationConfig?.thinkingConfig;
  if (thinkingConfig && typeof thinkingConfig === 'object') {
    const effort = normalizeEffort(thinkingConfig.thinkingLevel);
    const visibility: ReasoningVisibility | undefined =
      thinkingConfig.includeThoughts === true ? 'summary' : undefined;
    return {
      ...(effort && effort !== 'off' ? { effort } : {}),
      ...(typeof thinkingConfig.thinkingBudget === 'number'
        ? { budgetTokens: thinkingConfig.thinkingBudget }
        : {}),
      ...(thinkingConfig.thinkingBudget === 0 ? { enabled: false } : { enabled: true }),
      ...(visibility ? { visibility } : {}),
      source: 'client',
    };
  }

  return normalizeReasoningFromUnified(request.reasoning);
}

function extractGenerationIntent(payload: any, request: UnifiedChatRequest): GenerationIntent {
  const source = payload && typeof payload === 'object' ? payload : {};
  const maxTokens =
    source.max_output_tokens ??
    source.max_tokens ??
    source.max_completion_tokens ??
    source.generationConfig?.maxOutputTokens ??
    request.max_tokens;
  const temperature =
    source.temperature ?? source.generationConfig?.temperature ?? request.temperature;
  const verbosity = normalizeVerbosity(source.text?.verbosity ?? request.text?.verbosity);
  const serviceTier = source.service_tier ?? request.originalBody?.service_tier;

  return {
    reasoning: extractReasoningIntent(source, request),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(verbosity ? { verbosity } : {}),
    ...(typeof serviceTier === 'string' ? { serviceTier } : {}),
  };
}

function mappedThinkingValue(model: any, effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  const mapped = model.thinkingLevelMap?.[effort];
  return typeof mapped === 'string' ? mapped : effort;
}

function mappedOffValue(model: any): string | undefined {
  const off = model.thinkingLevelMap?.off;
  return typeof off === 'string' ? off : undefined;
}

function shouldDropTemperature(intent: GenerationIntent, options: Record<string, any>): boolean {
  return intent.temperature != null && !hasOwn(options, 'temperature');
}

function projectOpenAiCompletionsAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  const compat = model.compat ?? {};

  if (options.maxTokens != null) {
    if (compat.maxTokensField === 'max_completion_tokens') {
      delete next.max_tokens;
      next.max_completion_tokens = options.maxTokens;
    } else {
      next.max_tokens = options.maxTokens;
    }
  }
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;

  if (!model.reasoning) return next;

  const reasoningEffort =
    typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined;
  const enabled = reasoningEffort != null;
  const explicitOff = options.reasoning === 'off' || intent.reasoning.enabled === false;
  if (!enabled && !explicitOff) return next;

  const mapped = mappedThinkingValue(model, reasoningEffort);
  const off = mappedOffValue(model);

  switch (compat.thinkingFormat) {
    case 'zai':
      next.thinking = enabled ? { type: 'enabled', clear_thinking: false } : { type: 'disabled' };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'qwen':
      next.enable_thinking = enabled;
      break;
    case 'qwen-chat-template':
      next.chat_template_kwargs = {
        ...(next.chat_template_kwargs ?? {}),
        enable_thinking: enabled,
        preserve_thinking: true,
      };
      break;
    case 'chat-template':
      next.chat_template_kwargs = {
        ...(next.chat_template_kwargs ?? {}),
        ...resolveChatTemplateKwargs(model, options),
      };
      break;
    case 'deepseek':
      next.thinking = enabled ? { type: 'enabled' } : { type: 'disabled' };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'openrouter':
      next.reasoning = enabled ? { effort: mapped } : { effort: off ?? 'none' };
      break;
    case 'ant-ling':
      if (enabled && mapped) next.reasoning = { effort: mapped };
      break;
    case 'together':
      next.reasoning = { enabled };
      if (enabled && compat.supportsReasoningEffort && mapped) next.reasoning_effort = mapped;
      break;
    case 'string-thinking':
      next.thinking = enabled ? mapped : (off ?? 'none');
      break;
    default:
      if (enabled && compat.supportsReasoningEffort && mapped) {
        next.reasoning_effort = mapped;
      } else if (!enabled && compat.supportsReasoningEffort && off) {
        next.reasoning_effort = off;
      }
      break;
  }

  return next;
}

function resolveChatTemplateKwargs(model: any, options: Record<string, any>): Record<string, any> {
  const kwargs: Record<string, any> = {};
  const template = model.compat?.chatTemplateKwargs;
  if (!template || typeof template !== 'object') return kwargs;

  for (const [key, value] of Object.entries(template)) {
    const resolved = resolveChatTemplateKwargValue(model, options, value);
    if (resolved !== undefined) kwargs[key] = resolved;
  }
  return kwargs;
}

function resolveChatTemplateKwargValue(model: any, options: Record<string, any>, value: unknown) {
  if (typeof value !== 'object' || value === null) return value;
  const config = value as { $var?: string; omitWhenOff?: boolean };
  const reasoningEffort =
    typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined;
  if (!reasoningEffort && config.omitWhenOff) return undefined;
  if (config.$var === 'thinking.enabled') return !!reasoningEffort;
  const mapped = reasoningEffort
    ? model.thinkingLevelMap?.[reasoningEffort]
    : model.thinkingLevelMap?.off;
  return mapped === undefined ? reasoningEffort : typeof mapped === 'string' ? mapped : undefined;
}

function projectResponsesAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  if (options.maxTokens != null) next.max_output_tokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;
  if (options.serviceTier !== undefined) next.service_tier = options.serviceTier;
  if (options.textVerbosity !== undefined) {
    next.text = { ...(next.text ?? {}), verbosity: options.textVerbosity };
  }
  if (options.reasoningEffort || options.reasoningSummary) {
    next.reasoning = {
      ...(next.reasoning ?? {}),
      effort: mappedThinkingValue(model, options.reasoningEffort) ?? 'medium',
      summary: options.reasoningSummary ?? next.reasoning?.summary ?? 'auto',
    };
    next.include = Array.from(
      new Set([...(Array.isArray(next.include) ? next.include : []), 'reasoning.encrypted_content'])
    );
  } else if (options.reasoning === 'off') {
    next.reasoning = { ...(next.reasoning ?? {}), effort: mappedOffValue(model) ?? 'none' };
  }
  return next;
}

function projectAnthropicAutoCompat(
  payload: Record<string, any>,
  model: any,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload };
  if (options.maxTokens != null) next.max_tokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.temperature;

  if (options.thinkingEnabled === true) {
    const display = options.thinkingDisplay ?? 'summarized';
    if (model.compat?.forceAdaptiveThinking === true) {
      next.thinking = { type: 'adaptive', display };
      if (options.effort) {
        next.output_config = { ...(next.output_config ?? {}), effort: options.effort };
      }
    } else {
      next.thinking = {
        type: 'enabled',
        budget_tokens: options.thinkingBudgetTokens ?? 1024,
        display,
      };
    }
  } else if (options.thinkingEnabled === false) {
    next.thinking = { type: 'disabled' };
  }

  return next;
}

function projectGeminiAutoCompat(
  payload: Record<string, any>,
  intent: GenerationIntent,
  options: Record<string, any>
): Record<string, any> {
  const next = { ...payload, generationConfig: { ...(payload.generationConfig ?? {}) } };
  if (options.maxTokens != null) next.generationConfig.maxOutputTokens = options.maxTokens;
  if (hasOwn(options, 'temperature')) next.generationConfig.temperature = options.temperature;
  else if (shouldDropTemperature(intent, options)) delete next.generationConfig.temperature;

  if (options.thinking?.enabled === true) {
    next.generationConfig.thinkingConfig = {
      includeThoughts: options.thinking.includeThoughts !== false,
      ...(options.thinking.level !== undefined ? { thinkingLevel: options.thinking.level } : {}),
      ...(options.thinking.budgetTokens !== undefined
        ? { thinkingBudget: options.thinking.budgetTokens }
        : {}),
    };
  } else if (options.thinking?.enabled === false) {
    next.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  return next;
}

/**
 * Strips trailing /v1beta* path segments from Gemini base URLs.
 * Gemini's transformer adds /v1beta to the path, so we need to ensure
 * the base URL doesn't include it to avoid duplication like /v1beta/v1beta/...
 * Only strips beta versions (e.g. /v1beta, /v1beta1) — plain /v1 is valid for other APIs.
 */

function stripTrailingApiVersion(url: string): string {
  return url.replace(/\/(v\d+beta\d*)$/i, '');
}

export class Dispatcher {
  private usageStorage?: UsageStorageService;

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
      return `HTTP ${statusCode}: ${extracted}`.slice(0, 500);
    }

    return String(extracted).slice(0, 500);
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
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    // 1. Route (ordered candidates)
    const sessionKey = StickySessionManager.computeSessionKey(request);
    let candidates = await Router.resolveCandidates(
      request.model,
      request.incomingApiType,
      sessionKey
    );

    // Fallback for direct/provider/model syntax and legacy single-route behavior
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, request.incomingApiType);
      candidates = [singleRoute];
    }

    if (candidates.length === 0) {
      throw new Error(`No route candidates found for model '${request.model}'`);
    }

    candidates = applyKeyAccessPolicy(request, candidates, request.incomingApiType || 'chat');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(
      request,
      candidates,
      retryHistory,
      request.incomingApiType || 'chat'
    );

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    // Check if this is already a vision descriptor request to prevent recursion
    const isVisionDescriptorRequest = (request as any)._isVisionDescriptorRequest === true;

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) throw this.buildCancelledError(signal);
      let currentRequest = { ...request };
      const route = targets[i]!;
      const attemptTimeout = this.createAttemptTimeout(
        signal,
        route.config.timeoutMs,
        resolveTimeoutMs
      );

      // Vision Fallthrough (Image-to-Text Preprocessing)
      // Check if:
      // 1. Opt-in is enabled for this alias
      // 2. We're not already in a descriptor call (recursion guard)
      // 3. Request contains images
      // Look up use_image_fallthrough from the alias configuration (not provider's model config)
      const aliasConfig = route.canonicalModel ? config.models?.[route.canonicalModel] : undefined;
      const hasImages = VisionDescriptorService.hasImages(currentRequest.messages);
      logger.debug(
        `Checking: canonicalModel='${route.canonicalModel}', use_image_fallthrough='${aliasConfig?.use_image_fallthrough}', hasImages='${hasImages}', isVisionDescriptorRequest='${isVisionDescriptorRequest}'`
      );
      if (!isVisionDescriptorRequest && aliasConfig?.use_image_fallthrough && hasImages) {
        const vfConfig = config.vision_fallthrough;
        if (vfConfig?.descriptor_model) {
          try {
            logger.debug(
              `Before process: ${JSON.stringify(currentRequest.messages.map((m) => ({ role: m.role, contentCount: Array.isArray(m.content) ? m.content.length : 'string' })))}`
            );
            currentRequest = await VisionDescriptorService.process(
              currentRequest,
              vfConfig.descriptor_model,
              vfConfig.default_prompt || DEFAULT_VISION_DESCRIPTION_PROMPT,
              this.usageStorage // Pass usage storage to record descriptor call
            );
            logger.debug(
              `After process: ${JSON.stringify(currentRequest.messages.map((m) => ({ role: m.role, contentCount: Array.isArray(m.content) ? m.content.length : 'string' })))}`
            );

            // Verify if images are actually gone in the modified request
            const stillHasImages = VisionDescriptorService.hasImages(currentRequest.messages);
            if (stillHasImages) {
              logger.error(
                `CRITICAL: VisionDescriptorService.process returned a request that STILL contains images!`
              );
            }

            // Tag the request as having undergone fallthrough
            (currentRequest as any)._hasVisionFallthrough = true;
            (currentRequest as any)._visionFallthroughModel = vfConfig.descriptor_model;
            logger.debug(`Successfully preprocessed images for ${route.provider}/${route.model}`);
          } catch (vfError) {
            logger.error(`Error in descriptor service:`, vfError);
          }
        } else {
          logger.warn(
            `Feature enabled for alias '${request.model}' but 'vision_fallthrough.descriptor_model' not configured globally.`
          );
        }
      }

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        attemptTimeout.cleanup();
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`
        );
        continue;
      }

      // Pre-dispatch context limit enforcement (opt-in per alias). Runs on
      // the finalized per-target request — after any vision fallthrough has
      // expanded the prompt and after cooldown has selected a live target —
      // so we reject oversized prompts locally with a 400 instead of
      // burning an upstream round trip on a guaranteed failure. Checked
      // BEFORE acquiring a concurrency slot so that a thrown
      // ContextLengthExceededError (a client-side problem; failing over to
      // another target won't help) never leaks an acquired slot.
      if (aliasConfig?.enforce_limits && route.canonicalModel) {
        enforceContextLimit(currentRequest, aliasConfig, route.canonicalModel);
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        attemptTimeout.cleanup();
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(currentRequest.requestId, route);

      try {
        // Determine Target API Type
        const { targetApiType, selectionReason } = this.selectTargetApiType(
          route,
          currentRequest.incomingApiType
        );

        logger.info(
          `Dispatcher: Selected API type '${targetApiType}' for model '${route.model}'. Reason: ${selectionReason}`
        );

        // 2. Get Transformer
        const transformerType = this.isPiAiRoute(route, targetApiType) ? 'oauth' : targetApiType;
        const transformer = TransformerFactory.getTransformer(transformerType);

        // 3. Transform Request
        const requestWithTargetModel = { ...currentRequest, model: route.model };

        // Resolve adapters for this specific provider+model combination
        const adapters = resolveAdapters(route);

        const { payload: providerPayload, bypassTransformation } =
          await this.transformRequestPayload(
            requestWithTargetModel,
            route,
            transformer,
            targetApiType,
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

        if (this.isPiAiRoute(route, targetApiType)) {
          try {
            const oauthResponse = await this.dispatchOAuthRequest(
              providerPayload,
              currentRequest,
              route,
              targetApiType,
              transformer,
              attemptTimeout.signal,
              effectiveStallConfig
            );
            attemptTimeout.cleanup();
            await this.recordAttemptMetric(route, currentRequest.requestId, true, {
              isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
              isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
              visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
            });
            this.appendSuccessAttempt(retryHistory, route, targetApiType);
            this.attachAttemptMetadata(
              oauthResponse,
              attemptedProviders,
              retryHistory,
              route,
              targetApiType
            );
            try {
              CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
              this.recordStickySession(sessionKey, route, currentRequest);
              return oauthResponse;
            } finally {
              doRelease();
            }
          } catch (oauthError: any) {
            const effectiveOAuthError = attemptTimeout.isTimedOut()
              ? this.buildTimeoutError()
              : oauthError;
            if (signal?.aborted) throw this.buildCancelledError(signal);
            lastError = effectiveOAuthError;

            // Handle TTFB stall errors with failover support
            const isStallError = (effectiveOAuthError as any).isStallError === true;
            if (isStallError) {
              const canRetryStall = failoverEnabled && i < targets.length - 1;
              this.appendFailureAttempt(
                retryHistory,
                route,
                effectiveOAuthError,
                targetApiType,
                canRetryStall
              );

              if (canRetryStall) {
                attemptTimeout.cleanup();
                await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                  isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                  isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                  visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
                });
                CooldownManager.getInstance().markProviderStallFailure(
                  route.provider,
                  route.model,
                  this.formatFailureReason(effectiveOAuthError)
                );
                this.saveIntermediateError(
                  currentRequest.requestId,
                  targetApiType || 'chat',
                  effectiveOAuthError
                );
                logger.info(
                  `TTFB stall: OAuth request timed out for ${route.provider}/${route.model}, retrying`
                );
                doRelease();
                continue;
              }

              doRelease();

              // Mark stall failure for cooldown tracking even on the last target
              CooldownManager.getInstance().markProviderStallFailure(
                route.provider,
                route.model,
                this.formatFailureReason(effectiveOAuthError)
              );
              throw effectiveOAuthError;
            }

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              (attemptTimeout.isTimedOut() || this.isRetryableOAuthError(effectiveOAuthError));

            this.appendFailureAttempt(
              retryHistory,
              route,
              effectiveOAuthError,
              targetApiType,
              canRetry
            );

            if (canRetry) {
              attemptTimeout.cleanup();
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
              });
              await this.markOAuthProviderFailure(route, effectiveOAuthError);
              this.saveIntermediateError(
                currentRequest.requestId,
                targetApiType || 'chat',
                effectiveOAuthError
              );
              logger.warn(
                `Failover: retrying after OAuth error from ${route.provider}/${route.model}: ${effectiveOAuthError.message}`
              );
              doRelease();
              continue;
            }

            attemptTimeout.cleanup();
            await this.markOAuthProviderFailure(route, effectiveOAuthError);
            doRelease();
            throw effectiveOAuthError;
          }
        }

        // 4. Execute Request (non-OAuth)
        const incomingApi = currentRequest.incomingApiType || 'unknown';
        const url = this.buildRequestUrl(route, transformer, requestWithTargetModel, targetApiType);
        const headers = this.setupHeaders(route, targetApiType, requestWithTargetModel);

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
          const combinedSignal = AbortSignal.any([
            attemptTimeout.signal,
            stallAbortController.signal,
          ]);

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
            response = await this.executeProviderRequest(
              url,
              headers,
              providerPayload,
              combinedSignal
            );
          } catch (fetchError: any) {
            // Client disconnected takes priority over stall detection —
            // if the client is gone, no point retrying.
            if (signal?.aborted) {
              clearTimeout(ttfbTimerId);
              throw this.buildCancelledError(signal);
            }

            // If the error was caused by our TTFB stall timeout, synthesize
            // a stall result instead of treating it as a generic network error.
            if (stallAbortController.signal.aborted) {
              clearTimeout(ttfbTimerId);
              const stallError = new Error(
                `Stream stalled: TTFB timeout — no response within ${ttfbMs}ms`
              );
              lastError = stallError;

              const canRetryStall =
                failoverEnabled &&
                i < targets.length - 1 &&
                (this.isRetryableNetworkError(stallError, failover?.retryableErrors || []) ||
                  stallError.message?.includes('stalled'));

              if (canRetryStall) {
                attemptTimeout.cleanup();
                await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                  isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                  isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                  visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
                });
                this.appendFailureAttempt(retryHistory, route, stallError, targetApiType, true);
                CooldownManager.getInstance().markProviderStallFailure(
                  route.provider,
                  route.model,
                  this.formatFailureReason(stallError)
                );
                this.saveIntermediateError(
                  currentRequest.requestId,
                  targetApiType || 'chat',
                  stallError
                );
                logger.info(
                  `TTFB stall: fetch timed out after ${ttfbMs}ms for ${route.provider}/${route.model}, retrying with next provider`
                );
                doRelease();
                continue;
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
          response = await this.executeProviderRequest(
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
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              targetApiType,
              currentRequest.requestId
            );
          } catch (e: any) {
            if (signal?.aborted) throw this.buildCancelledError(signal);
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, targetApiType, canRetry);

            if (canRetry) {
              attemptTimeout.cleanup();
              doRelease();
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
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
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(currentRequest.requestId, targetApiType || 'chat', e);
              logger.warn(
                `Failover: retrying after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
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
          const streamProbe = await this.probeStreamingStart(response, effectiveStallConfig);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              (this.isRetryableNetworkError(error, failover?.retryableErrors || []) ||
                error.message?.includes('stalled'));

            if (canRetry) {
              attemptTimeout.cleanup();
              await this.recordAttemptMetric(route, currentRequest.requestId, false, {
                isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
                isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
                visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
              });
              this.appendFailureAttempt(retryHistory, route, error, targetApiType, true);
              if (error.message?.includes('stalled')) {
                CooldownManager.getInstance().markProviderStallFailure(
                  route.provider,
                  route.model,
                  this.formatFailureReason(error)
                );
              } else {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(error)
                );
              }
              this.saveIntermediateError(currentRequest.requestId, targetApiType || 'chat', error);
              logger.warn(
                `Failover: retrying stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              doRelease();
              continue;
            }

            doRelease();
            throw error;
          }

          const streamResponse = this.handleStreamingResponse(
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

          await this.recordAttemptMetric(route, currentRequest.requestId, true, {
            isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
            isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
            visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
          });
          CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
          this.recordStickySession(sessionKey, route, currentRequest);
          this.appendSuccessAttempt(retryHistory, route, targetApiType);
          this.attachAttemptMetadata(
            streamResponse,
            attemptedProviders,
            retryHistory,
            route,
            targetApiType
          );
          attemptTimeout.cleanup();
          return streamResponse;
        }

        const nonStreamingResponse = await this.handleNonStreamingResponse(
          response,
          currentRequest,
          route,
          targetApiType,
          transformer,
          bypassTransformation,
          adapters
        );
        await this.recordAttemptMetric(route, currentRequest.requestId, true, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });

        if ((currentRequest as any)._isVisionDescriptorRequest && this.usageStorage) {
          // ... (this part is fine)
        }

        CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
        this.recordStickySession(sessionKey, route, currentRequest);
        this.appendSuccessAttempt(retryHistory, route, targetApiType);
        this.attachAttemptMetadata(
          nonStreamingResponse,
          attemptedProviders,
          retryHistory,
          route,
          targetApiType
        );
        doRelease();
        attemptTimeout.cleanup();
        return nonStreamingResponse;
      } catch (error: any) {
        const effectiveError = attemptTimeout.isTimedOut() ? this.buildTimeoutError() : error;
        lastError = effectiveError;
        attemptTimeout.cleanup();
        doRelease();

        // If the client disconnected (abort signal), don't treat this as a
        // retryable error — throw a proper client_disconnected error so the
        // route handler records it as cancelled, not as an inference error.
        if (signal?.aborted) throw this.buildCancelledError(signal);

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
              this.formatFailureReason(effectiveError)
            );
          } else {
            CooldownManager.getInstance().markProviderFailure(
              route.provider,
              route.model,
              undefined,
              this.formatFailureReason(effectiveError)
            );
          }
        }
        await this.recordAttemptMetric(route, currentRequest.requestId, false, {
          isVisionFallthrough: (currentRequest as any)._hasVisionFallthrough,
          isDescriptorRequest: (currentRequest as any)._isVisionDescriptorRequest,
          visionFallthroughModel: (currentRequest as any)._visionFallthroughModel,
        });

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          (isUpstreamTimeout ||
            this.isRetryableNetworkError(effectiveError, failover?.retryableErrors || []) ||
            effectiveError.message?.includes('stalled'));

        this.appendFailureAttempt(retryHistory, route, effectiveError, undefined, canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(
            currentRequest.requestId,
            effectiveError?.routingContext?.targetApiType || 'chat',
            effectiveError
          );
          logger.warn(
            `Failover: retrying after network/transport error from ${route.provider}/${route.model}: ${effectiveError.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  private isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
    return retryableStatusCodes.includes(statusCode);
  }

  /**
   * Determines if an OAuth error is retryable.
   * Retryable errors include network issues, rate limiting, and transient failures.
   */
  private isRetryableOAuthError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode;

    // Retry on network errors (no status code means network failure)
    if (!statusCode) {
      return true;
    }

    // Retry on 5xx server errors
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }

    // Retry on 429 rate limiting
    if (statusCode === 429) {
      return true;
    }

    // Retry on specific transient error messages
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'ECONNREFUSED',
      'etimedout',
      'ETIMEDOUT',
      'network',
      'socket',
      'temporary',
      'unavailable',
      'service unavailable',
    ];

    for (const pattern of retryablePatterns) {
      if (errorMessage.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private isRetryableNetworkError(error: any, retryableErrors: string[]): boolean {
    if (!error) return false;
    const code = String(error.code || '').toUpperCase();
    const message = String(error.message || '').toUpperCase();
    return retryableErrors.some((token) => {
      const normalized = token.toUpperCase();
      return code.includes(normalized) || message.includes(normalized);
    });
  }

  private async probeStreamingStart(
    response: Response,
    stallConfig?: StallConfig | null
  ): Promise<
    { ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }
  > {
    if (!response.body) {
      return { ok: true, response };
    }

    // When TTFB stall detection is configured, probe the stream until we've
    // received ttfbBytes or the TTFB timeout fires. This allows the
    // failover loop to retry with a different provider when a provider is
    // slow to start responding.
    if (stallConfig?.ttfbMs != null) {
      logger.debug(
        `probeStreamingStart: using stall-aware probe (ttfbMs=${stallConfig.ttfbMs}, ttfbBytes=${stallConfig.ttfbBytes})`
      );
      return this.probeStreamingStartWithStallCheck(response, stallConfig);
    }

    // Original 100ms probe — if the first byte doesn't arrive within 100ms,
    // let the stream continue in the background.
    const reader = response.body.getReader();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timeout: true }), 100);
    });

    try {
      const readPromise = reader.read();
      const readResult = await Promise.race([readPromise, timeoutPromise]);

      if ((readResult as any).timeout) {
        const passthrough = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const first = await readPromise;
              if (!first.done && first.value) {
                controller.enqueue(first.value);
              } else if (first.done) {
                controller.close();
              }
            } catch (error) {
              controller.error(error);
            }
          },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                controller.close();
              } else {
                controller.enqueue(next.value);
              }
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return {
          ok: true,
          response: new Response(passthrough, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
        };
      }

      const first = readResult as ReadableStreamReadResult<Uint8Array>;
      const replay = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!first.done && first.value) {
            controller.enqueue(first.value);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return {
        ok: true,
        response: new Response(replay, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted: false,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Stall-aware stream probe: reads from the stream until we've received
   * `stallConfig.ttfbBytes` bytes or the TTFB timeout fires.
   *
   * - If TTFB threshold is met → returns ok:true, stream continues normally.
   * - If TTFB timeout fires → returns ok:false with a stall error, which the
   *   failover loop treats as retryable (same as a network error before first byte).
   */
  private async probeStreamingStartWithStallCheck(
    response: Response,
    stallConfig: StallConfig
  ): Promise<
    { ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }
  > {
    const reader = response.body!.getReader();
    const ttfbBytes = stallConfig.ttfbBytes;
    const ttfbMs = stallConfig.ttfbMs!;

    // Collected chunks to replay into the response stream
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let streamStarted = false;

    // TTFB stall timer
    let ttfbTimerId: ReturnType<typeof setTimeout> | undefined;
    const ttfbTimeoutPromise = new Promise<'ttfb_timeout'>((resolve) => {
      ttfbTimerId = setTimeout(() => resolve('ttfb_timeout'), ttfbMs);
    });

    try {
      // Read chunks until we hit the TTFB byte threshold or the timeout
      while (totalBytes < ttfbBytes) {
        const readPromise = reader.read();
        const result = await Promise.race([readPromise, ttfbTimeoutPromise]);

        if (result === 'ttfb_timeout') {
          // TTFB stall detected — abort the reader
          reader
            .cancel(new DOMException('Stream stalled: TTFB timeout', 'TimeoutError'))
            .catch(() => {});
          logger.info(
            `TTFB stall probe: received ${totalBytes} bytes within ${ttfbMs}ms ` +
              `(threshold: ${ttfbBytes} bytes)`
          );
          return {
            ok: false,
            error: new Error(
              `Stream stalled: TTFB timeout — received ${totalBytes} bytes in ${ttfbMs}ms ` +
                `(threshold: ${ttfbBytes} bytes within ${ttfbMs}ms)`
            ),
            streamStarted,
          };
        }

        const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
        if (done) {
          // Stream ended before we got enough bytes — not a stall, just a short response
          break;
        }

        chunks.push(value);
        totalBytes += value.length;
        streamStarted = true;
      }

      // TTFB threshold met (or stream ended naturally) — build replay stream
      const replayChunks = [...chunks];
      let chunkIndex = 0;
      const replay = new ReadableStream<Uint8Array>({
        start(controller) {
          // Replay buffered chunks
          while (chunkIndex < replayChunks.length) {
            controller.enqueue(replayChunks[chunkIndex]!);
            chunkIndex++;
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return {
        ok: true,
        response: new Response(replay, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted,
      };
    } finally {
      if (ttfbTimerId) clearTimeout(ttfbTimerId);
    }
  }

  private attachAttemptMetadata(
    response: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[],
    finalRoute: RouteResult,
    apiType: string
  ): void {
    const responseApiType = response?.plexus?.apiType;

    response.plexus = {
      ...(response.plexus || {}),
      attemptCount: attemptedProviders.length,
      finalAttemptProvider: finalRoute.provider,
      finalAttemptModel: finalRoute.model,
      allAttemptedProviders: JSON.stringify(attemptedProviders),
      retryHistory: JSON.stringify(retryHistory),
      canonicalModel: finalRoute.canonicalModel,
      provider: finalRoute.provider,
      model: finalRoute.model,
      // Preserve the response-declared API type (e.g. oauth) so downstream
      // stream transformation uses the correct transformer.
      apiType: responseApiType || apiType,
      pricing: finalRoute.modelConfig?.pricing,
      providerDiscount: finalRoute.config.discount,
      config: {
        estimateTokens: finalRoute.config.estimateTokens,
      },
      // GPU params — read directly from the resolved numeric fields.
      // The frontend (or config hydration) resolves named profiles to concrete
      // values before they reach this point. Fall back to H100 only if no GPU
      // fields are set at all (i.e. no GPU profile was configured).
      gpuParams: {
        ram_gb: finalRoute.config.gpu_ram_gb ?? DEFAULT_GPU_PARAMS.ram_gb,
        bandwidth_tb_s: finalRoute.config.gpu_bandwidth_tb_s ?? DEFAULT_GPU_PARAMS.bandwidth_tb_s,
        flops_tflop: finalRoute.config.gpu_flops_tflop ?? DEFAULT_GPU_PARAMS.flops_tflop,
        power_draw_watts:
          finalRoute.config.gpu_power_draw_watts ?? DEFAULT_GPU_PARAMS.power_draw_watts,
      },
      modelParams: resolveModelParams(finalRoute.modelArchitecture),
    } as any;
  }

  private appendSkippedAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    reason: string,
    apiType?: string
  ): void {
    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'skipped',
      reason,
      retryable: false,
    });
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
    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'success',
      reason: 'Request completed successfully',
      retryable: false,
    });
  }

  private appendFailureAttempt(
    retryHistory: RetryAttemptRecord[],
    route: RouteResult,
    error: any,
    apiType?: string,
    retryable?: boolean
  ): void {
    const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;
    const reason = this.formatFailureReason(error);

    retryHistory.push({
      index: retryHistory.length + 1,
      provider: route.provider,
      model: route.model,
      apiType,
      status: 'failed',
      reason,
      statusCode: typeof statusCode === 'number' ? statusCode : undefined,
      retryable,
      providerResponseHeaders: error?.routingContext?.providerResponseHeaders,
    });
  }

  private buildAllTargetsFailedError(
    lastError: any,
    attemptedProviders: string[],
    retryHistory: RetryAttemptRecord[] = []
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Set Accept header based on streaming
    if (request.stream) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Accept'] = 'application/json';
    }

    // Use static API key
    if (route.config.api_key) {
      const type = apiType.toLowerCase();
      if (type === 'messages') {
        headers['x-api-key'] = route.config.api_key;
        headers['anthropic-version'] = '2023-06-01';
      } else if (type === 'gemini') {
        headers['x-goog-api-key'] = route.config.api_key;
      } else {
        // Default to Bearer for Chat (OpenAI) and others
        headers['Authorization'] = `Bearer ${route.config.api_key}`;
      }
    } else {
      throw new Error(`No API key configured for provider '${route.provider}'`);
    }

    if (route.config.headers) {
      Object.assign(headers, route.config.headers);
    }

    // Forward cache routing headers for Responses API prompt caching.
    // These headers enable server-side cache routing at the upstream provider
    // (e.g. theclawbay, OpenAI). Without them, each request may land on a
    // different backend server, causing cache misses.
    if (request.cacheRoutingHeaders) {
      if (request.cacheRoutingHeaders.session_id) {
        headers['session_id'] = request.cacheRoutingHeaders.session_id;
      }
      if (request.cacheRoutingHeaders['x-client-request-id']) {
        headers['x-client-request-id'] = request.cacheRoutingHeaders['x-client-request-id'];
      }
    }

    return headers;
  }

  private getApiMetadata(metadata: Record<string, any>): Record<string, any> {
    const { plexus_metadata: _stripped, ...apiMetadata } = metadata || {};
    return apiMetadata;
  }

  /**
   * Extracts provider types using the helper function that infers from api_base_url
   */
  private extractProviderTypes(route: RouteResult): string[] {
    return getProviderTypes(route.config);
  }

  /**
   * Determines which API type to use based on configuration and incoming request type
   * @returns Selected API type and human-readable reason for selection
   */
  private selectTargetApiType(
    route: RouteResult,
    incomingApiType?: string
  ): { targetApiType: string; selectionReason: string } {
    const providerTypes = this.extractProviderTypes(route);

    // Check if model specific access_via is defined
    const modelSpecificTypes = route.modelConfig?.access_via;

    // The available types for this specific routing
    // If model specific types are defined and not empty, use them. Otherwise fallback to provider types.
    const availableTypes =
      modelSpecificTypes && modelSpecificTypes.length > 0 ? modelSpecificTypes : providerTypes;

    let targetApiType = availableTypes[0]; // Default to first one

    if (!targetApiType) {
      throw new Error(
        `No available API type found for provider '${route.provider}' and model '${route.model}'. Check configuration.`
      );
    }
    let selectionReason = 'default (first available)';

    // Try to match incoming
    if (incomingApiType) {
      const incoming = incomingApiType.toLowerCase();
      // Case-insensitive match
      const match = availableTypes.find((t: string) => t.toLowerCase() === incoming);
      if (match) {
        targetApiType = match;
        selectionReason = `matched incoming request type '${incoming}'`;
      } else {
        selectionReason = `incoming type '${incoming}' not supported, defaulted to '${targetApiType}'`;
      }
    }

    return { targetApiType, selectionReason };
  }

  /**
   * Resolves the provider base URL from configuration, handling both string and record formats
   * @returns Normalized base URL without trailing slash
   */
  private resolveBaseUrl(route: RouteResult, targetApiType: string): string {
    let rawBaseUrl: string;

    if (typeof route.config.api_base_url === 'string') {
      rawBaseUrl = route.config.api_base_url;
    } else {
      // It's a record/map
      const urlMap = route.config.api_base_url;
      const typeKey = targetApiType.toLowerCase();
      // Check exact match first, then fallback to just looking for keys that might match?
      // Actually the config keys should probably match the api types (chat, messages, etc)
      const specificUrl = urlMap[typeKey];
      const defaultUrl = urlMap['default'];

      if (specificUrl) {
        rawBaseUrl = specificUrl;
        logger.debug(`Dispatcher: Using specific base URL for '${targetApiType}'.`);
      } else if (defaultUrl) {
        rawBaseUrl = defaultUrl;
        logger.debug(`Dispatcher: Using default base URL.`);
      } else {
        // Resolve via API_TYPE_ALIASES before falling back to the first key.
        const aliases = API_TYPE_ALIASES[typeKey];
        const aliasKey = aliases?.find((a) => urlMap[a]);

        if (aliasKey) {
          rawBaseUrl = urlMap[aliasKey]!;
          logger.debug(`Dispatcher: Using '${aliasKey}' base URL for api type '${targetApiType}'.`);
        } else {
          const firstKey = Object.keys(urlMap)[0];

          if (firstKey) {
            const firstUrl = urlMap[firstKey];
            if (firstUrl) {
              rawBaseUrl = firstUrl;
              logger.warn(
                `No specific base URL found for api type '${targetApiType}'. using '${firstKey}' as fallback.`
              );
            } else {
              throw new Error(
                `No base URL configured for api type '${targetApiType}' and no default found.`
              );
            }
          } else {
            throw new Error(
              `No base URL configured for api type '${targetApiType}' and no default found.`
            );
          }
        }
      }
    }

    // Ensure api_base_url doesn't end with slash and strip trailing /v1beta if present
    // (the transformer adds its own /v1beta path segment)
    return stripTrailingApiVersion(rawBaseUrl.replace(/\/$/, ''));
  }

  /**
   * Converts reasoning field to thinkingConfig for Gemini API.
   * Gemini's OpenAI-compatible endpoint doesn't support 'reasoning' at top level,
   * so we map request.reasoning.effort to generationConfig.thinkingConfig instead.
   */
  private applyGeminiThinkingConfig(route: RouteResult, targetApiType: string, payload: any): any {
    const baseUrl = this.resolveBaseUrl(route, targetApiType).toLowerCase();
    const isGemini = baseUrl.includes('generativelanguage.googleapis.com');
    const enabled = route.config.geminiThinkingEnabled === true;

    // Gemini's OpenAI-compatible endpoint doesn't support 'reasoning' at top level
    // Always strip it, and if enabled, map reasoning.effort to thinkingConfig
    if (isGemini && payload.reasoning && enabled) {
      const { reasoning, ...restPayload } = payload;
      const result: any = { ...restPayload };

      // Map reasoning.effort to Gemini's thinkingLevel
      // OpenAI ThinkLevel: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
      // Gemini ThinkingLevel: 'low' | 'medium' | 'high'
      const effort = reasoning?.effort;
      if (effort && effort !== 'none' && effort !== 'minimal') {
        let thinkingLevel: 'low' | 'medium' | 'high';
        if (effort === 'low') {
          thinkingLevel = 'low';
        } else if (effort === 'medium') {
          thinkingLevel = 'medium';
        } else {
          // 'high' or 'xhigh' map to 'high'
          thinkingLevel = 'high';
        }

        result.generationConfig = {
          ...payload.generationConfig,
          thinkingConfig: {
            thinkingLevel,
          },
        };
      }

      return result;
    } else if (isGemini && payload.reasoning) {
      // Config not enabled but have reasoning - just strip it
      const { reasoning: _, ...restPayload } = payload;
      return restPayload;
    }

    return payload;
  }

  private isOAuthRoute(route: RouteResult, targetApiType: string): boolean {
    if (targetApiType.toLowerCase() === 'oauth') return true;
    if (typeof route.config.api_base_url === 'string') {
      return route.config.api_base_url.startsWith('oauth://');
    }
    const urlMap = route.config.api_base_url as Record<string, string>;
    return Object.values(urlMap).some((value) => value.startsWith('oauth://'));
  }

  private isClaudeMaskingApiKeyRoute(route: RouteResult, targetApiType: string): boolean {
    if (this.isOAuthRoute(route, targetApiType)) {
      return false;
    }

    if (targetApiType.toLowerCase() !== 'messages') {
      return false;
    }

    return route.config.useClaudeMasking === true;
  }

  private isPiAiRoute(route: RouteResult, targetApiType: string): boolean {
    return (
      this.isOAuthRoute(route, targetApiType) ||
      this.isClaudeMaskingApiKeyRoute(route, targetApiType)
    );
  }

  private isAsyncIterable<T>(input: any): input is AsyncIterable<T> {
    return input && typeof input[Symbol.asyncIterator] === 'function';
  }

  private isReadableStream<T>(input: any): input is ReadableStream<T> {
    return !!input && typeof input.getReader === 'function';
  }

  private normalizeOAuthStream(result: any): ReadableStream<any> {
    if (this.isReadableStream(result)) {
      return result;
    }

    if (this.isAsyncIterable(result)) {
      return this.streamFromAsyncIterable(result);
    }

    throw new Error('OAuth provider returned an unsupported stream type');
  }

  private buildOAuthStreamEventError(event: any): Error {
    const message =
      event?.error?.errorMessage ||
      event?.errorMessage ||
      event?.error?.message ||
      event?.message ||
      'OAuth provider error';

    const error = new Error(message) as Error & { piAiResponse?: unknown };
    error.piAiResponse = event;
    return error;
  }

  private buildOAuthRawStreamError(value: unknown): Error | null {
    let text: string | null = null;

    if (typeof value === 'string') {
      text = value;
    } else if (value instanceof Uint8Array) {
      text = new TextDecoder().decode(value);
    } else if (value instanceof ArrayBuffer) {
      text = new TextDecoder().decode(value);
    }

    if (!text) return null;

    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return null;

    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed?.error || typeof parsed.error !== 'object') return null;

      const message =
        parsed.error.message ||
        parsed.error.errorMessage ||
        parsed.message ||
        'OAuth provider error';
      const error = new Error(message) as Error & { piAiResponse?: unknown };
      error.piAiResponse = parsed;
      return error;
    } catch {
      return null;
    }
  }

  private async probeOAuthStreamStart(
    stream: ReadableStream<any>,
    stallConfig?: StallConfig | null
  ): Promise<
    { ok: true; stream: ReadableStream<any> } | { ok: false; error: Error; streamStarted: boolean }
  > {
    // Pi-ai streams begin with bookkeeping events (type 'start', 'text_start',
    // 'thinking_start', etc.) that carry no content and precede any error events.
    // If we declare ok:true on the first such event, a 429 error arriving as the
    // SECOND event will be seen after the HTTP response is already committed —
    // too late to retry.  Instead, buffer bookkeeping events and keep reading
    // until we see either:
    //   - An error event  → ok:false → dispatcher retries
    //   - Empty stream    → ok:false → dispatcher retries (quota exhausted)
    //   - A content event → ok:true  → replay all buffered events + rest of stream
    const BOOKKEEPING_TYPES = new Set([
      'start',
      'text_start',
      'text_end',
      'thinking_start',
      'thinking_end',
      'toolcall_start',
      'toolcall_end',
    ]);

    const reader = stream.getReader();
    const buffered: any[] = [];
    const ttfbMs = stallConfig?.ttfbMs;

    try {
      if (ttfbMs != null) {
        // TTFB deadline mode: race each read against remaining time from
        // a single absolute deadline. The deadline never resets after each
        // bookkeeping event — a slow trickle of bookkeeping events cannot
        // avoid timeout. TTFB for OAuth is "time to first non-bookkeeping event".
        const deadline = Date.now() + ttfbMs;
        const stallReason = new DOMException(
          `Stream stalled: TTFB timeout — no response within ${ttfbMs}ms`,
          'TimeoutError'
        );

        while (true) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            try {
              await reader.cancel(stallReason);
            } catch {}
            try {
              reader.releaseLock();
            } catch {}
            return {
              ok: false,
              error: new Error(stallReason.message),
              streamStarted: false,
            };
          }

          let readTimerId: ReturnType<typeof setTimeout> | undefined;
          try {
            const readPromise = reader.read();
            const timeoutPromise = new Promise<never>((_, reject) => {
              readTimerId = setTimeout(() => reject(stallReason), remaining);
              readTimerId.unref?.();
            });

            const { value, done } = await Promise.race([readPromise, timeoutPromise]);

            if (done) {
              try {
                await reader.cancel();
              } catch {}
              try {
                reader.releaseLock();
              } catch {}
              return {
                ok: false,
                error: new Error('OAuth provider returned empty stream (quota exhausted)'),
                streamStarted: false,
              };
            }

            if (value?.type === 'error' || value?.reason === 'error') {
              try {
                await reader.cancel();
              } catch {}
              try {
                reader.releaseLock();
              } catch {}
              return {
                ok: false,
                error: this.buildOAuthStreamEventError(value),
                streamStarted: false,
              };
            }

            const rawError = this.buildOAuthRawStreamError(value);
            if (rawError) {
              try {
                await reader.cancel();
              } catch {}
              try {
                reader.releaseLock();
              } catch {}
              return {
                ok: false,
                error: rawError,
                streamStarted: false,
              };
            }

            buffered.push(value);

            // If this event is not pure bookkeeping, the stream is healthy.
            if (!BOOKKEEPING_TYPES.has(value?.type)) {
              break;
            }
          } catch (err: any) {
            if (err?.name === 'TimeoutError' || err?.message?.includes('stalled')) {
              try {
                await reader.cancel(err);
              } catch {}
              try {
                reader.releaseLock();
              } catch {}
              return {
                ok: false,
                error: err instanceof Error ? err : new Error(String(err)),
                streamStarted: false,
              };
            }
            throw err;
          } finally {
            if (readTimerId !== undefined) {
              clearTimeout(readTimerId);
            }
          }
        }
      } else {
        // No TTFB deadline — use existing indefinite read loop
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            // Stream closed — quota exhausted (no events) or provider gave up.
            reader.releaseLock();
            return {
              ok: false,
              error: new Error('OAuth provider returned empty stream (quota exhausted)'),
              streamStarted: false,
            };
          }

          if (value?.type === 'error' || value?.reason === 'error') {
            reader.releaseLock();
            return {
              ok: false,
              error: this.buildOAuthStreamEventError(value),
              streamStarted: false,
            };
          }

          const rawError = this.buildOAuthRawStreamError(value);
          if (rawError) {
            reader.releaseLock();
            return {
              ok: false,
              error: rawError,
              streamStarted: false,
            };
          }

          buffered.push(value);

          // If this event is not pure bookkeeping, the stream is healthy.
          // Replay all buffered events then continue from the reader.
          if (!BOOKKEEPING_TYPES.has(value?.type)) {
            break;
          }
        }
      }

      // Stream is healthy — replay buffered events then stream the rest.
      // The replay stream takes ownership of the reader; do NOT releaseLock here.
      const snapshot = buffered.slice();
      const replay = new ReadableStream<any>({
        start(controller) {
          for (const ev of snapshot) {
            controller.enqueue(ev);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return { ok: true, stream: replay };
    } catch (error: any) {
      try {
        reader.releaseLock();
      } catch {}
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        streamStarted: false,
      };
    }
  }

  private describeStreamResult(result: any): Record<string, any> {
    return {
      isPromise: !!result && typeof result.then === 'function',
      isAsyncIterable: this.isAsyncIterable(result),
      isReadableStream: this.isReadableStream(result),
      hasIterator: !!result && typeof result[Symbol.asyncIterator] === 'function',
      hasGetReader: !!result && typeof result.getReader === 'function',
      constructorName: result?.constructor?.name || typeof result,
    };
  }

  private streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
    const iterator = iterable[Symbol.asyncIterator]();
    let closed = false;
    let reading = false;

    return new ReadableStream<T>({
      async pull(controller) {
        if (closed || reading) return;
        reading = true;
        try {
          const { value, done } = await iterator.next();
          if (done) {
            closed = true;
            controller.close();
          } else if (!closed) {
            controller.enqueue(value);
          }
        } catch (error) {
          if (!closed) {
            logger.error('OAuth: Stream pull failed', error as Error);
            closed = true;
            controller.error(error);
          }
        } finally {
          reading = false;
        }
      },
      async cancel(reason) {
        closed = true;
        await iterator.return?.(reason);
      },
    });
  }

  /**
   * Wraps an OAuth pi-ai ReadableStream with a transparent monitor that detects
   * error events and triggers a provider cooldown asynchronously.
   *
   * This is needed because pi-ai retries HTTP 429s internally with exponential
   * backoff (delays of 1 s, 2 s, 4 s …), so the final error event may arrive
   * many seconds after the probe has already declared the stream
   * healthy.  Without this wrapper the cooldown is never triggered and the
   * exhausted provider keeps receiving traffic.
   */
  private monitorOAuthStreamForErrors(
    stream: ReadableStream<any>,
    route: RouteResult
  ): ReadableStream<any> {
    const dispatcher = this;
    let readerRef: ReadableStreamDefaultReader<any> | null = null;

    return new ReadableStream<any>({
      async start(controller) {
        readerRef = stream.getReader();
        let eventsEmitted = 0;

        try {
          while (true) {
            const { value, done } = await readerRef.read();
            if (done) {
              // If the stream closed without emitting any events, the upstream
              // provider silently exhausted quota (pi-ai retries 429s internally
              // with exponential backoff and then just closes the stream — no
              // error event is emitted).  Treat this as a provider failure so
              // that a cooldown is triggered and the account is not hammered.
              if (eventsEmitted === 0) {
                logger.warn(
                  `OAuth: Stream closed with 0 events for ${route.provider}/${route.model} — ` +
                    `treating as quota exhaustion and triggering cooldown`
                );

                const syntheticError = new Error(
                  'OAuth provider returned empty stream (quota exhausted)'
                ) as Error & {
                  piAiResponse?: unknown;
                };
                syntheticError.piAiResponse = {
                  stopReason: 'error',
                  errorMessage: 'quota exhausted',
                };

                const wrappedError = dispatcher.wrapOAuthError(
                  syntheticError,
                  route,
                  'oauth'
                ) as any;

                dispatcher.markOAuthProviderFailure(route, wrappedError).catch((e) => {
                  logger.error('OAuth: Failed to mark provider failure from empty stream', e);
                });
              }

              controller.close();
              break;
            }

            // Detect pi-ai error events and trigger cooldown asynchronously.
            // The event shape is: { type: "error", reason: "error"|"aborted", error: AssistantMessage }
            if (value?.type === 'error') {
              const errorMessage =
                value?.error?.errorMessage ||
                value?.errorMessage ||
                value?.error?.message ||
                value?.message ||
                'OAuth provider error';

              logger.warn(
                `OAuth: Stream error event detected for ${route.provider}/${route.model}: ${errorMessage}`
              );

              // Build a synthetic error so wrapOAuthError can determine if this
              // is a quota exhaustion, compute cooldown duration, etc.
              const syntheticError = new Error(errorMessage) as Error & {
                piAiResponse?: unknown;
              };
              syntheticError.piAiResponse = value;

              const wrappedError = dispatcher.wrapOAuthError(syntheticError, route, 'oauth') as any;

              // Trigger cooldown without awaiting so the stream is not blocked.
              dispatcher.markOAuthProviderFailure(route, wrappedError).catch((e) => {
                logger.error('OAuth: Failed to mark provider failure from stream error', e);
              });

              // Do NOT forward the raw provider error event to the client.
              // Close the stream cleanly so the client gets a proper termination
              // rather than raw provider JSON leaking through as completion content.
              // We cannot use controller.error() here because the HTTP response is
              // already committed (message_start was already sent), and erroring an
              // in-flight ReadableStream causes unhandled promise rejections downstream.
              controller.close();
              return;
            }

            eventsEmitted++;
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        } finally {
          readerRef.releaseLock();
          readerRef = null;
        }
      },
      cancel(reason) {
        if (readerRef) {
          readerRef.cancel(reason).catch(() => {});
        }
      },
    });
  }

  private async dispatchOAuthRequest(
    context: any,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string,
    transformer: any,
    signal?: AbortSignal,
    effectiveStallConfig?: StallConfig | null
  ): Promise<UnifiedChatResponse> {
    if (!transformer.executeRequest) {
      throw new Error('OAuth transformer missing executeRequest()');
    }

    try {
      const oauthProvider = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? 'anthropic'
        : route.config.oauth_provider || route.provider;
      const oauthAccount = route.config.oauth_account?.trim();
      const authConfig = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? {
            authMode: 'apiKey' as const,
            apiKey: route.config.api_key?.trim() || '',
          }
        : {
            authMode: 'oauth' as const,
            accountId: oauthAccount || '',
          };

      if (authConfig.authMode === 'oauth' && !authConfig.accountId) {
        throw new Error(
          `OAuth account is not configured for provider '${route.provider}'. ` +
            `Set providers.${route.provider}.oauth_account in plexus config.`
        );
      }

      if (authConfig.authMode === 'apiKey' && !authConfig.apiKey) {
        throw new Error(
          `API key is not configured for Claude masking provider '${route.provider}'. ` +
            `Set providers.${route.provider}.api_key in plexus config.`
        );
      }

      if (authConfig.authMode === 'oauth') {
        this.assertOAuthModelSupported(oauthProvider, route.model);
      }
      const oauthContext = context?.context ? context.context : context;
      const oauthOptions = context?.options;

      logger.debug('OAuth: Dispatching request', {
        routeProvider: route.provider,
        oauthProvider,
        oauthAccount: authConfig.authMode === 'oauth' ? authConfig.accountId : undefined,
        authMode: authConfig.authMode,
        model: route.model,
        targetApiType,
        streaming: !!request.stream,
        hasOptions: !!oauthOptions,
      });

      logger.debug('OAuth: Stall detection config', {
        ttfbMs: effectiveStallConfig?.ttfbMs,
        ttfbBytes: effectiveStallConfig?.ttfbBytes,
        minBytesPerSecond: effectiveStallConfig?.minBytesPerSecond,
        provider: route.provider,
      });

      if (!oauthContext.systemPrompt) {
        oauthContext.systemPrompt =
          this.resolveOAuthInstructions(request, oauthProvider) || oauthContext.systemPrompt;
      }

      // TTFB stall detection for streaming OAuth requests.
      // The stallAbortController is separate from the client signal — aborting
      // it means the provider is too slow to start responding, not that the
      // client disconnected. We intercept stall aborts BEFORE wrapOAuthError
      // can swallow them — the OAuth transformer converts AbortError
      // to generic 'Upstream timeout', losing the stall message).
      const originalSignal = signal;
      let requestSignal = signal;
      let stallAbortController: AbortController | undefined;
      let ttfbTimerId: ReturnType<typeof setTimeout> | undefined;
      let raceTimerId: ReturnType<typeof setTimeout> | undefined;
      const dispatchStartTime = Date.now();

      if (request.stream && effectiveStallConfig?.ttfbMs != null) {
        stallAbortController = new AbortController();
        requestSignal = originalSignal
          ? AbortSignal.any([originalSignal, stallAbortController.signal])
          : stallAbortController.signal;

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
      }

      try {
        // Race executeRequest against the TTFB deadline. The abort signal
        // is passed for cooperative cancellation, but if the upstream
        // doesn't observe it, the Promise.race ensures we don't hang.
        let executePromise: Promise<any>;
        if (request.stream && stallAbortController && effectiveStallConfig?.ttfbMs != null) {
          const deadlineMs = effectiveStallConfig.ttfbMs!;
          executePromise = Promise.race([
            transformer.executeRequest(
              oauthContext,
              oauthProvider,
              route.model,
              !!request.stream,
              oauthOptions,
              authConfig,
              requestSignal
            ),
            new Promise<never>((_, reject) => {
              // Redundant with the timer above, but guarantees we reject
              // even if the upstream ignores the abort signal.
              raceTimerId = setTimeout(
                () => {
                  reject(
                    new DOMException(
                      `Stream stalled: TTFB timeout — no response within ${deadlineMs}ms`,
                      'TimeoutError'
                    )
                  );
                },
                deadlineMs - (Date.now() - dispatchStartTime)
              );
            }),
          ]);
        } else {
          executePromise = transformer.executeRequest(
            oauthContext,
            oauthProvider,
            route.model,
            !!request.stream,
            oauthOptions,
            authConfig,
            requestSignal
          );
        }

        const result = await executePromise;

        // executeRequest succeeded — clear stall timer
        if (ttfbTimerId !== undefined) {
          clearTimeout(ttfbTimerId);
          ttfbTimerId = undefined;
        }
        if (raceTimerId !== undefined) {
          clearTimeout(raceTimerId);
          raceTimerId = undefined;
        }

        // Client disconnect check after executeRequest
        if (originalSignal?.aborted) throw this.buildCancelledError(originalSignal);

        if (request.stream) {
          // Compute remaining TTFB for the probe using absolute deadline
          let probeStallConfig: StallConfig | null = effectiveStallConfig ?? null;
          if (effectiveStallConfig?.ttfbMs != null) {
            const deadline = dispatchStartTime + effectiveStallConfig.ttfbMs;
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
              // Deadline already exceeded after executeRequest — cancel the
              // returned stream before failing, otherwise the upstream
              // connection leaks while failover proceeds.
              try {
                const rawStream = this.normalizeOAuthStream(result);
                if (rawStream && typeof rawStream.cancel === 'function') {
                  await rawStream.cancel();
                }
              } catch {}
              const err = new Error(
                `Stream stalled: TTFB timeout — no response within ${effectiveStallConfig.ttfbMs}ms`
              ) as any;
              err.isStallError = true;
              throw err;
            }
            probeStallConfig = { ...effectiveStallConfig, ttfbMs: remainingMs };
          }

          const rawStream = this.normalizeOAuthStream(result);
          const streamProbe = await this.probeOAuthStreamStart(rawStream, probeStallConfig);

          if (!streamProbe.ok) {
            throw streamProbe.error;
          }

          logger.debug('OAuth: Normalized stream result', this.describeStreamResult(result));

          // Wrap the probed stream with an error monitor so that quota/error events
          // arriving AFTER the 100ms probe timeout still trigger a cooldown.  This
          // is necessary because pi-ai retries HTTP 429s with exponential backoff
          // (1 s, 2 s, 4 s) before emitting the final error event, which takes far
          // longer than the probe's window.
          const monitoredStream = this.monitorOAuthStreamForErrors(streamProbe.stream, route);

          const streamResponse: UnifiedChatResponse = {
            id: 'stream-' + Date.now(),
            model: request.model,
            content: null,
            stream: monitoredStream,
            bypassTransformation: false,
          };

          this.enrichResponseWithMetadata(streamResponse, route, 'oauth');
          return streamResponse;
        }

        const unified = await transformer.transformResponse(result);
        this.enrichResponseWithMetadata(unified, route, 'oauth');
        return unified;
      } catch (error: any) {
        // ALWAYS clear timer on any error
        if (ttfbTimerId !== undefined) {
          clearTimeout(ttfbTimerId);
          ttfbTimerId = undefined;
        }
        if (raceTimerId !== undefined) {
          clearTimeout(raceTimerId);
          raceTimerId = undefined;
        }

        // Client disconnect takes priority over stall detection
        if (originalSignal?.aborted) throw this.buildCancelledError(originalSignal);

        // TTFB stall abort — re-throw with correct stall message BEFORE
        // wrapOAuthError can swallow it
        if (stallAbortController?.signal.aborted) {
          const stallError = new Error(
            `Stream stalled: TTFB timeout — no response within ${effectiveStallConfig?.ttfbMs}ms`
          );
          (stallError as any).isStallError = true;
          throw stallError;
        }

        // Non-stall error — let wrapOAuthError handle it
        throw error;
      }
    } catch (error: any) {
      throw this.wrapOAuthError(error, route, targetApiType);
    }
  }

  private createAttemptTimeout(
    signal: AbortSignal | undefined,
    providerTimeoutMs: number | null | undefined,
    resolveTimeoutMs?: ResolveTimeoutMs
  ): { signal: AbortSignal; isTimedOut: () => boolean; cleanup: () => void } {
    const timeoutMs = resolveTimeoutMs
      ? resolveTimeoutMs(providerTimeoutMs ?? null)
      : (providerTimeoutMs ?? (getConfig().timeout?.defaultSeconds ?? 300) * 1000);
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new DOMException('Upstream request timed out', 'TimeoutError'));
    }, timeoutMs);
    timeoutId.unref?.();

    return {
      signal: signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal,
      isTimedOut: () => timeoutController.signal.aborted,
      cleanup: () => clearTimeout(timeoutId),
    };
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

  private assertOAuthModelSupported(oauthProvider: string, modelId: string) {
    const supportedModels = getBuiltinModels(oauthProvider as any);
    if (!supportedModels || supportedModels.length === 0) {
      throw new Error(`OAuth provider '${oauthProvider}' has no known models.`);
    }

    const isSupported = supportedModels.some((model) => model.id === modelId);
    if (!isSupported) {
      const modelList = supportedModels
        .map((model) => model.id)
        .sort()
        .join(', ');
      throw new Error(
        `OAuth model '${modelId}' is not supported for provider '${oauthProvider}'. ` +
          `Supported models: ${modelList}`
      );
    }
  }

  private wrapOAuthError(error: Error, route: RouteResult, targetApiType: string): Error {
    const rawProviderResponse = this.stringifyOAuthProviderResponse((error as any)?.piAiResponse);
    const message = error?.message || 'OAuth provider error';
    const providerResponse =
      this.extractFailureReason((error as any)?.piAiResponse) || rawProviderResponse;
    const errorText = providerResponse || message;
    const isQuotaError = this.isQuotaExhaustedError(errorText);
    let statusCode = (error as any)?.status || (error as any)?.statusCode;

    if (!statusCode) {
      statusCode = 500;

      if (isQuotaError) {
        statusCode = 429;
      }

      if (
        message.includes('Not authenticated') ||
        message.includes('re-authenticate') ||
        message.includes('expired')
      ) {
        statusCode = 401;
      } else if (message.toLowerCase().includes('model') && message.toLowerCase().includes('not')) {
        statusCode = 400;
      }
    }

    const cooldownTriggered =
      statusCode !== 413 && statusCode !== 422 && !(statusCode === 400 && !isQuotaError);
    const cooldownDuration =
      (statusCode === 429 || isQuotaError) && errorText
        ? this.parseCooldownDurationForProvider(
            this.resolveCooldownProviderType(route),
            errorText,
            'OAuth'
          )
        : undefined;

    const enriched = new Error(message) as any;
    enriched.status = statusCode;
    enriched.statusCode = statusCode;
    enriched.routingContext = {
      provider: route.provider,
      oauthProvider: route.config.oauth_provider || route.provider,
      oauthAccount: route.config.oauth_account,
      targetModel: route.model,
      targetApiType,
      statusCode,
      providerResponse,
      rawProviderResponse,
      cooldownTriggered,
      cooldownDuration,
    };

    return enriched;
  }

  private resolveCooldownProviderType(route: RouteResult): string | undefined {
    if (typeof route.config.oauth_provider === 'string' && route.config.oauth_provider.trim()) {
      return route.config.oauth_provider.trim();
    }

    const providerTypes = this.extractProviderTypes(route);
    return providerTypes[0];
  }

  private parseCooldownDurationForProvider(
    providerType: string | undefined,
    errorText: string,
    source: 'HTTP' | 'OAuth'
  ): number | undefined {
    if (!providerType) {
      return undefined;
    }

    const parsedDuration = CooldownParserRegistry.parseCooldown(providerType, errorText);

    if (parsedDuration !== null) {
      logger.info(
        `${source}: Parsed cooldown duration for ${providerType}: ${parsedDuration}ms (${parsedDuration / 1000}s)`
      );
      return parsedDuration;
    }

    logger.debug(`${source}: No cooldown duration parsed for ${providerType}, using default`);
    return undefined;
  }

  private stringifyOAuthProviderResponse(response: unknown): string | undefined {
    if (response === undefined || response === null) {
      return undefined;
    }

    if (typeof response === 'string') {
      return response;
    }

    try {
      return JSON.stringify(response);
    } catch {
      return String(response);
    }
  }

  private async markOAuthProviderFailure(route: RouteResult, oauthError: any): Promise<void> {
    if (!oauthError?.routingContext?.cooldownTriggered) {
      return;
    }

    const failureReason = this.formatFailureReason(oauthError, true);

    await CooldownManager.getInstance().markProviderFailure(
      route.provider,
      route.model,
      oauthError?.routingContext?.cooldownDuration,
      failureReason
    );
  }

  private resolveOAuthInstructions(
    request: UnifiedChatRequest,
    oauthProvider: string
  ): string | undefined {
    const requestInstructions = request.originalBody?.instructions;
    if (typeof requestInstructions === 'string' && requestInstructions.trim()) {
      return requestInstructions;
    }

    const systemMessage = request.messages.find((msg) => msg.role === 'system');
    const developerMessage = (request.messages as any[]).find((msg) => msg.role === 'developer');
    const instructionSource = systemMessage || developerMessage;
    const instructionContent = instructionSource?.content;
    if (typeof instructionContent === 'string' && instructionContent.trim()) {
      return instructionContent;
    }

    if (oauthProvider === 'openai-codex') {
      logger.info('OAuth: Inserted default instructions for openai-codex');
      return 'You are a helpful coding assistant.';
    }

    return undefined;
  }

  /**
   * Determines if pass-through optimization should be used
   */
  private shouldUsePassThrough(
    request: UnifiedChatRequest,
    targetApiType: string,
    route: RouteResult
  ): boolean {
    // If vision fallthrough was applied, we must use the translated pathway
    // to ensure the modified messages (text instead of images) are sent.
    if ((request as any)._hasVisionFallthrough) {
      return false;
    }

    // pi-ai routes (OAuth + Claude-masking) require pi-ai Context format built by
    // the OAuth transformer's transformRequest. Pass-through would hand the raw
    // client body straight to pi-ai, and its transformMessages() would crash on
    // string-valued assistant content (issue #162).
    if (this.isPiAiRoute(route, targetApiType)) {
      return false;
    }

    const isCompatible =
      !!request.incomingApiType?.toLowerCase() &&
      request.incomingApiType?.toLowerCase() === targetApiType.toLowerCase();

    return isCompatible && !!request.originalBody;
  }

  /**
   * Transforms the request payload or uses pass-through optimization
   * @returns Transformed payload and bypass flag
   */
  private async transformRequestPayload(
    request: UnifiedChatRequest,
    route: RouteResult,
    transformer: any,
    targetApiType: string,
    adapters: ResolvedAdapter[] = []
  ): Promise<{ payload: any; bypassTransformation: boolean }> {
    let providerPayload: any;
    let bypassTransformation = false;

    if (this.shouldUsePassThrough(request, targetApiType, route)) {
      logger.debug(
        `Pass-through optimization active: ${request.incomingApiType} -> ${targetApiType}` +
          (adapters.length > 0 ? ` (with ${adapters.length} adapter(s))` : '')
      );
      providerPayload = JSON.parse(JSON.stringify(request.originalBody));
      providerPayload.model = route.model;

      // Add metadata from request
      if (request.metadata) {
        const apiMetadata = this.getApiMetadata(request.metadata);
        if (Object.keys(apiMetadata).length > 0) {
          providerPayload.metadata = apiMetadata;
        }
      }

      bypassTransformation = true;
    } else {
      // Inject OAuth provider into metadata so transformers can set provider/model
      // on assistant messages for thought-signature replay (required by Gemini 3).
      const oauthProvider = this.isClaudeMaskingApiKeyRoute(route, targetApiType)
        ? 'anthropic'
        : route.config.oauth_provider || route.provider;
      if (oauthProvider) {
        request = {
          ...request,
          metadata: {
            ...(request.metadata || {}),
            plexus_metadata: {
              ...((request.metadata as any)?.plexus_metadata || {}),
              oauthProvider,
            },
          },
        };
      }
      providerPayload = await transformer.transformRequest(request);
    }

    // Convert reasoning field to thinkingConfig for Gemini API
    providerPayload = this.applyGeminiThinkingConfig(route, targetApiType, providerPayload);

    providerPayload = this.applyRegistryAutoCompat(providerPayload, request, route, targetApiType);

    // Merge provider-level extraBody first
    if (route.config.extraBody) {
      providerPayload = { ...providerPayload, ...route.config.extraBody };
    }

    // Then merge model-level extraBody (overrides provider-level)
    if (route.modelConfig?.extraBody) {
      providerPayload = { ...providerPayload, ...route.modelConfig.extraBody };
    }

    // Apply alias-level advanced behaviors (e.g. strip_adaptive_thinking)
    // Also merge alias-level extraBody (overrides both provider and model level)
    if (route.canonicalModel) {
      const aliasConfig = getConfig().models?.[route.canonicalModel];
      if (aliasConfig?.extraBody) {
        providerPayload = { ...providerPayload, ...aliasConfig.extraBody };
      }
      if (aliasConfig?.advanced) {
        providerPayload = applyModelBehaviors(providerPayload, aliasConfig.advanced, {
          incomingApiType: request.incomingApiType ?? '',
          canonicalModel: route.canonicalModel,
        });
      }
    }

    // Apply provider/model adapters (preDispatch) in configured order
    for (const { adapter, options } of adapters) {
      providerPayload = adapter.preDispatch(providerPayload, options);
    }

    if (adapters.length > 0) {
      logger.debug(
        `Adapters applied (preDispatch): [${adapters.map((a) => a.adapter.name).join(', ')}] ` +
          `for ${route.provider}/${route.model}`
      );
    }

    return { payload: providerPayload, bypassTransformation };
  }

  private applyRegistryAutoCompat(
    providerPayload: any,
    request: UnifiedChatRequest,
    route: RouteResult,
    targetApiType: string
  ): any {
    const autoCompat = route.config.auto_compat === true || route.modelConfig?.auto_compat === true;
    if (!autoCompat) return providerPayload;

    const piAiProvider = route.config.pi_ai_provider;
    const piAiModelId = route.modelConfig?.pi_ai_model_id;
    if (!piAiProvider || !piAiModelId) return providerPayload;

    const piAiModel = resolvePiAiModel(piAiProvider, piAiModelId);
    if (!piAiModel) {
      logger.debug(
        `Registry auto-compat skipped: ${route.provider}/${route.model} references unresolved ` +
          `pi-ai model ${piAiProvider}/${piAiModelId}`
      );
      return providerPayload;
    }

    const intent = extractGenerationIntent(providerPayload, request);
    const options = buildGenerationOptions(piAiModel, intent);

    const api = (piAiModel.api as string | undefined) ?? targetApiType;
    let nextPayload: any;
    if (
      api === 'openai-responses' ||
      api === 'openai-codex-responses' ||
      api === 'azure-openai-responses'
    ) {
      nextPayload = projectResponsesAutoCompat(providerPayload, piAiModel, intent, options);
    } else if (api === 'anthropic-messages') {
      nextPayload = projectAnthropicAutoCompat(providerPayload, piAiModel, intent, options);
    } else if (api === 'google-generative-ai' || api === 'google-generative-ai-vertex') {
      nextPayload = projectGeminiAutoCompat(providerPayload, intent, options);
    } else {
      nextPayload = projectOpenAiCompletionsAutoCompat(providerPayload, piAiModel, intent, options);
    }

    logger.debug(`Registry auto-compat applied for ${route.provider}/${route.model}`, {
      piAiProvider,
      piAiModelId,
      api,
      optionKeys: Object.keys(options),
    });

    return nextPayload;
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
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
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
        cooldownDuration = this.parseCooldownDurationForProvider(
          this.resolveCooldownProviderType(route),
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
        `HTTP ${response.status}: ${errorText.slice(0, 500)}`
      );
    }

    // Create enriched error with routing context
    const error = new Error(`Provider failed: ${response.status} ${errorText}`) as any;
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

  /**
   * Dispatch embeddings request to provider
   * Uses EmbeddingsTransformerFactory for provider-type-aware:
   * - URL construction (e.g. Gemini /v1beta/models/{model}:embedContent)
   * - Auth headers (e.g. x-goog-api-key for Gemini)
   * - Request/response transformation
   */
  async dispatchEmbeddings(request: any): Promise<any> {
    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'embeddings');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'embeddings');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'embeddings');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(request, candidates, retryHistory, 'embeddings');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'embeddings'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'embeddings'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(request.requestId, route);

      try {
        const providerTypes = getProviderTypes(route.config);
        const transformer = EmbeddingsTransformerFactory.resolveTransformer(providerTypes);
        const requestWithModel = { ...request, model: route.model };

        const baseUrl = this.resolveBaseUrl(route, 'embeddings');
        const endpoint = transformer.getEndpoint
          ? transformer.getEndpoint(requestWithModel)
          : transformer.defaultEndpoint;
        const url = `${baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (route.config.api_key) {
          if (transformer.getAuthHeaders) {
            transformer.getAuthHeaders(route.config.api_key, headers);
          } else {
            headers['Authorization'] = `Bearer ${route.config.api_key}`;
          }
        }
        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        let payload = await transformer.transformRequest(requestWithModel);
        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }
        // Merge model-level extraBody (overrides provider level)
        if (route.modelConfig?.extraBody) {
          Object.assign(payload, route.modelConfig.extraBody);
        }
        // Merge alias-level extraBody (overrides provider and model level)
        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          if (aliasConfig?.extraBody) {
            Object.assign(payload, aliasConfig.extraBody);
          }
        }

        logger.info(`Dispatching embeddings ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Embeddings Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await this.executeProviderRequest(url, headers, payload);

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            this.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Embeddings request failed: ${url}`, {
            status: response.status,
            error: errorText,
          });
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'embeddings',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, 'embeddings', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(request.requestId, 'embeddings', e);
              logger.warn(
                `Failover: retrying embeddings after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const rawResponseBody = await this.parseJsonResponseBody(
          response,
          request.requestId,
          route,
          'embeddings'
        );
        logger.silly('Embeddings Response Payload', rawResponseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, rawResponseBody);
        }
        const transformedResponse = await transformer.transformResponse(
          rawResponseBody,
          requestWithModel
        );
        const enrichedResponse: any = {
          ...transformedResponse,
          plexus: {
            provider: route.provider,
            model: route.model,
            apiType: 'embeddings',
            isPassthrough: true,
            pricing: route.modelConfig?.pricing,
            providerDiscount: route.config.discount,
            canonicalModel: route.canonicalModel,
            config: route.config,
          },
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        CooldownManager.getInstance().markProviderSuccess(route.provider, route.model);
        this.appendSuccessAttempt(retryHistory, route, 'embeddings');
        this.attachAttemptMetadata(
          enrichedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'embeddings'
        );
        doRelease();
        return enrichedResponse;
      } catch (error: any) {
        lastError = error;
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'embeddings', canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(request.requestId, 'embeddings', error);
          logger.warn(
            `Failover: retrying embeddings after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          doRelease();
          continue;
        }

        doRelease();
        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches audio transcription requests
   * Handles multipart/form-data file uploads to OpenAI-compatible transcription endpoints
   */
  async dispatchTranscription(
    request: UnifiedTranscriptionRequest
  ): Promise<UnifiedTranscriptionResponse> {
    const { TranscriptionsTransformer } = await import('../transformers/transcriptions');
    const transformer = new TranscriptionsTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'transcriptions');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'transcriptions');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'transcriptions');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(request, candidates, retryHistory, 'transcriptions');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'transcriptions'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'transcriptions'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'transcriptions');
        const url = `${baseUrl}/audio/transcriptions`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        logger.info(
          `Dispatching transcription ${request.model} to ${route.provider}:${route.model}`
        );
        logger.silly('Transcription Request', { model: request.model, filename: request.filename });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            mimeType: request.mimeType,
            language: request.language,
            prompt: request.prompt,
            response_format: request.response_format,
            temperature: request.temperature,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            this.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'transcriptions',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, 'transcriptions', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(request.requestId, 'transcriptions', e);
              logger.warn(
                `Failover: retrying transcription after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseFormat = request.response_format || 'json';
        let responseBody: any;

        if (responseFormat === 'text') {
          responseBody = await response.text();
        } else {
          responseBody = await response.json();
        }

        logger.silly('Transcription Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformResponse(responseBody, responseFormat);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'transcriptions',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'transcriptions');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'transcriptions'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'transcriptions', canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(request.requestId, 'transcriptions', error);
          logger.warn(
            `Failover: retrying transcription after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches text-to-speech requests
   * Handles JSON body requests to OpenAI-compatible speech endpoints
   * Supports both binary audio responses and SSE streaming
   */
  async dispatchSpeech(request: UnifiedSpeechRequest): Promise<UnifiedSpeechResponse> {
    const { SpeechTransformer } = await import('../transformers/speech');
    const transformer = new SpeechTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'speech');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'speech');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'speech');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(request, candidates, retryHistory, 'speech');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'speech'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'speech'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'speech');
        const url = `${baseUrl}/audio/speech`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = await transformer.transformRequest({
          ...request,
          model: route.model,
        });

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        // Merge alias-level extraBody (overrides provider level)
        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          if (aliasConfig?.extraBody) {
            Object.assign(payload, aliasConfig.extraBody);
          }
        }

        logger.info(`Dispatching speech ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Speech Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const isStreamed = request.stream_format === 'sse';
        const acceptHeader = isStreamed ? 'text/event-stream' : 'audio/*';
        headers['Accept'] = acceptHeader;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            this.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'speech',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, 'speech', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(request.requestId, 'speech', e);
              logger.warn(
                `Failover: retrying speech after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        let responseForProcessing = response;
        if (isStreamed) {
          const streamProbe = await this.probeStreamingStart(response, null);

          if (!streamProbe.ok) {
            const error = streamProbe.error;
            lastError = error;

            const canRetry =
              failoverEnabled &&
              i < targets.length - 1 &&
              !streamProbe.streamStarted &&
              this.isRetryableNetworkError(error, failover?.retryableErrors || []);

            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              this.appendFailureAttempt(retryHistory, route, error, 'speech', true);
              // Always mark as failed when retrying — provider couldn't serve this request
              CooldownManager.getInstance().markProviderFailure(
                route.provider,
                route.model,
                undefined,
                error.message
              );
              this.saveIntermediateError(request.requestId, 'speech', error);
              logger.warn(
                `Failover: retrying speech stream before first byte after ${route.provider}/${route.model} failure: ${error.message}`
              );
              continue;
            }

            throw error;
          }

          responseForProcessing = streamProbe.response;
        }

        const responseBuffer = Buffer.from(await responseForProcessing.arrayBuffer());
        logger.silly('Speech Response', { size: responseBuffer.length, isStreamed });

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, {
            size: responseBuffer.length,
            isStreamed,
          });
        }

        const unifiedResponse = await transformer.transformResponse(responseBuffer, {
          stream_format: request.stream_format,
          response_format: request.response_format,
        });

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'speech',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'speech');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'speech'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'speech', canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(request.requestId, 'speech', error);
          logger.warn(
            `Failover: retrying speech after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image generation requests
   * Handles JSON body requests to OpenAI-compatible image generation endpoints
   */
  async dispatchImageGenerations(
    request: UnifiedImageGenerationRequest
  ): Promise<UnifiedImageGenerationResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'images');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(request, candidates, retryHistory, 'images');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'images'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'images'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/generations`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const payload = await transformer.transformGenerationRequest({
          ...request,
          model: route.model,
        });

        if (route.config.extraBody) {
          Object.assign(payload, route.config.extraBody);
        }

        // Merge alias-level extraBody (overrides provider level)
        if (route.canonicalModel) {
          const aliasConfig = getConfig().models?.[route.canonicalModel];
          if (aliasConfig?.extraBody) {
            Object.assign(payload, aliasConfig.extraBody);
          }
        }

        logger.info(
          `Dispatching image generation ${request.model} to ${route.provider}:${route.model}`
        );
        logger.silly('Image Generation Request Payload', payload);

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, payload);
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            this.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'images',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(request.requestId, 'images', e);
              logger.warn(
                `Failover: retrying image generation after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly('Image Generation Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformGenerationResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'images');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'images'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(request.requestId, 'images', error);
          logger.warn(
            `Failover: retrying image generation after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }

  /**
   * Dispatches image editing requests
   * Handles multipart/form-data requests to OpenAI-compatible image editing endpoints
   * Supports single image upload with optional mask
   */
  async dispatchImageEdits(request: UnifiedImageEditRequest): Promise<UnifiedImageEditResponse> {
    const { ImageTransformer } = await import('../transformers/image');
    const transformer = new ImageTransformer();

    const config = getConfig();
    const failover = config.failover;
    const failoverEnabled = failover?.enabled !== false;

    let candidates = await Router.resolveCandidates(request.model, 'images');
    if (candidates.length === 0) {
      const singleRoute = await Router.resolve(request.model, 'images');
      candidates = [singleRoute];
    }

    candidates = applyKeyAccessPolicy(request, candidates, 'images');

    const retryHistory: RetryAttemptRecord[] = [];
    candidates = this.applyQuotaFilter(request, candidates, retryHistory, 'images');

    const targets = failoverEnabled ? candidates : [candidates[0]!];
    const attemptedProviders: string[] = [];
    let lastError: any = null;

    for (let i = 0; i < targets.length; i++) {
      const route = targets[i]!;

      // Re-check cooldown status before attempting this target
      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        route.provider,
        route.model
      );
      if (!isHealthy) {
        logger.warn(`Skipping ${route.provider}/${route.model} - provider is on cooldown`);
        lastError = new Error(`Provider ${route.provider}/${route.model} is on cooldown`);
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} is on cooldown`,
          'images'
        );
        continue;
      }

      // Acquire concurrency slot before upstream request
      const acquired = ConcurrencyTracker.getInstance().acquire(route.provider, route.model);
      if (!acquired) {
        logger.warn(`Skipping ${route.provider}/${route.model} - concurrency limit exceeded`);
        lastError = new Error(
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`
        );
        this.appendSkippedAttempt(
          retryHistory,
          route,
          `Provider ${route.provider}/${route.model} concurrency limit exceeded`,
          'images'
        );
        continue;
      }

      attemptedProviders.push(`${route.provider}/${route.model}`);

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          ConcurrencyTracker.getInstance().release(route.provider, route.model);
        }
      };

      this.emitRoutingUpdate(request.requestId, route);

      try {
        const baseUrl = this.resolveBaseUrl(route, 'images');
        const url = `${baseUrl}/images/edits`;

        const headers: Record<string, string> = {};

        if (route.config.api_key) {
          headers['Authorization'] = `Bearer ${route.config.api_key}`;
        }

        if (route.config.headers) {
          Object.assign(headers, route.config.headers);
        }

        const formData = await transformer.transformEditRequest({
          ...request,
          model: route.model,
        });

        logger.info(`Dispatching image edit ${request.model} to ${route.provider}:${route.model}`);
        logger.silly('Image Edit Request', {
          model: request.model,
          filename: request.filename,
          hasMask: !!request.mask,
        });

        if (request.requestId) {
          DebugManager.getInstance().addTransformedRequest(request.requestId, {
            model: request.model,
            filename: request.filename,
            hasMask: !!request.mask,
          });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        // Capture response metadata for debug logging
        if (request.requestId) {
          DebugManager.getInstance().addResponseMeta(
            request.requestId,
            response.status,
            this.extractResponseHeaders(response)
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          const canRetry =
            failoverEnabled &&
            i < targets.length - 1 &&
            this.isRetryableStatus(response.status, failover?.retryableStatusCodes || []);

          try {
            await this.handleProviderError(
              response,
              route,
              errorText,
              url,
              headers,
              'images',
              request.requestId
            );
          } catch (e: any) {
            lastError = e;
            this.appendFailureAttempt(retryHistory, route, e, 'images', canRetry);
            if (canRetry) {
              await this.recordAttemptMetric(route, request.requestId, false);
              // Only mark as failed if cooldown was actually triggered (not a caller error)
              if (e?.routingContext?.cooldownTriggered) {
                CooldownManager.getInstance().markProviderFailure(
                  route.provider,
                  route.model,
                  undefined,
                  this.formatFailureReason(e, true)
                );
              }
              this.saveIntermediateError(request.requestId, 'images', e);
              logger.warn(
                `Failover: retrying image edit after HTTP ${response.status} from ${route.provider}/${route.model}`
              );
              continue;
            }
            throw e;
          }
        }

        const responseBody = await response.json();
        logger.silly('Image Edit Response', responseBody);

        if (request.requestId) {
          DebugManager.getInstance().addRawResponse(request.requestId, responseBody);
        }

        const unifiedResponse = await transformer.transformEditResponse(responseBody);

        unifiedResponse.plexus = {
          provider: route.provider,
          model: route.model,
          apiType: 'images',
          pricing: route.modelConfig?.pricing,
          providerDiscount: route.config.discount,
          canonicalModel: route.canonicalModel,
          config: route.config,
        };

        await this.recordAttemptMetric(route, request.requestId, true);
        this.appendSuccessAttempt(retryHistory, route, 'images');
        this.attachAttemptMetadata(
          unifiedResponse,
          attemptedProviders,
          retryHistory,
          route,
          'images'
        );
        doRelease();
        return unifiedResponse;
      } catch (error: any) {
        lastError = error;
        doRelease();
        // handleProviderError already called markProviderFailure for HTTP errors.
        // Only call it here for pure network/transport errors (no statusCode).
        if (error?.routingContext?.statusCode === undefined) {
          CooldownManager.getInstance().markProviderFailure(
            route.provider,
            route.model,
            undefined,
            this.formatFailureReason(error)
          );
        }
        await this.recordAttemptMetric(route, request.requestId, false);

        const canRetryNetwork =
          failoverEnabled &&
          i < targets.length - 1 &&
          this.isRetryableNetworkError(error, failover?.retryableErrors || []);

        this.appendFailureAttempt(retryHistory, route, error, 'images', canRetryNetwork);

        if (canRetryNetwork) {
          this.saveIntermediateError(request.requestId, 'images', error);
          logger.warn(
            `Failover: retrying image edit after network/transport error from ${route.provider}/${route.model}: ${error.message}`
          );
          continue;
        }

        throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
      }
    }

    throw this.buildAllTargetsFailedError(lastError, attemptedProviders, retryHistory);
  }
}
