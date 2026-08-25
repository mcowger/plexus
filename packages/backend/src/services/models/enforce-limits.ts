import type { Context } from '@earendil-works/pi-ai';
import { getConfig, type ModelConfig } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { estimateContextTokens, estimateInputTokens } from '../../utils/estimate-tokens';
import { logger } from '../../utils/logger';
import { resolveModelMetadata } from './model-metadata-manager';

// Heuristic estimator has ±20–30% variance; inflate the estimate by 10% so we
// err on the side of rejecting a borderline-oversized request rather than
// shipping it upstream and getting an opaque 400.
const ESTIMATE_SAFETY_MULTIPLIER = 1.1;

// Fallback reservation when we have no metadata max_completion_tokens and the
// caller didn't specify max_tokens. Matches a common default completion budget.
const DEFAULT_OUTPUT_RESERVATION = 4096;

function resolveMetadata(aliasConfig: ModelConfig, aliasSlug = '') {
  let providers = {};
  if (!aliasConfig.metadata || aliasConfig.metadata.source === 'auto') {
    try {
      providers = getConfig().providers;
    } catch {
      // Provider hints improve automatic matching but are not required for safe fallback.
    }
  }
  return resolveModelMetadata(aliasSlug, aliasConfig, providers)?.metadata;
}

export interface ContextLengthExceededDetails {
  statusCode: 400;
  code: 'context_length_exceeded';
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  contextLength: number;
  aliasSlug: string;
}

/**
 * Error thrown when the estimated prompt tokens plus the reserved output
 * budget would exceed the model's declared context window. Route handlers
 * read `routingContext` to build the reply envelope.
 */
export class ContextLengthExceededError extends Error {
  readonly routingContext: ContextLengthExceededDetails;

  constructor(message: string, details: ContextLengthExceededDetails) {
    super(message);
    this.name = 'ContextLengthExceededError';
    this.routingContext = details;
  }
}

/**
 * Resolve the effective context window for an alias by merging metadata
 * overrides on top of the catalog entry. Returns undefined when no context
 * length is known from either source — callers should fail open.
 */
/**
 * Enforces the incoming-context-size limit for an alias that has
 * `enforce_limits` enabled. Fast path: one JSON.stringify + one linear
 * heuristic scan + an in-memory Map lookup. Throws
 * `ContextLengthExceededError` on violation; returns silently otherwise.
 *
 * Fail-open behavior: when no context_length can be determined, we log at
 * debug level and let the request through — we can't enforce what we don't
 * know.
 */
export function enforceContextLimit(
  request: UnifiedChatRequest,
  aliasConfig: ModelConfig,
  aliasSlug: string
): void {
  const merged = resolveMetadata(aliasConfig, aliasSlug);

  // Prefer top_provider.context_length (per-deployment) over the model-wide
  // context_length when both are present.
  const contextLength = merged?.top_provider?.context_length ?? merged?.context_length;
  if (!contextLength || contextLength <= 0) {
    logger.debug(
      `[enforce-limits] Skipping '${aliasSlug}': no context_length known (no override, no catalog entry).`
    );
    return;
  }

  // Reserve output space: prefer the caller's max_tokens if specified and
  // smaller than the model's max_completion_tokens — otherwise reserve the
  // model's max. Falls back to a conservative constant when neither is set.
  const metadataMaxOutput = merged?.top_provider?.max_completion_tokens;
  const requestedMaxTokens =
    typeof request.max_tokens === 'number' && request.max_tokens > 0
      ? request.max_tokens
      : undefined;
  let reservedOutput: number;
  if (requestedMaxTokens !== undefined && metadataMaxOutput !== undefined) {
    reservedOutput = Math.min(requestedMaxTokens, metadataMaxOutput);
  } else {
    reservedOutput = requestedMaxTokens ?? metadataMaxOutput ?? DEFAULT_OUTPUT_RESERVATION;
  }

  const apiType = request.incomingApiType || 'chat';
  // Defensive fallback: all inference routes set originalBody, but if it's
  // missing (e.g. a programmatic caller), hand the estimator a minimal
  // messages-only body rather than the full UnifiedChatRequest — whose
  // model/tools/metadata fields would inflate the token estimate.
  const bodyForEstimate = request.originalBody ?? { messages: request.messages };
  const rawEstimate = estimateInputTokens(bodyForEstimate, apiType);
  const estimated = Math.ceil(rawEstimate * ESTIMATE_SAFETY_MULTIPLIER);

  if (estimated + reservedOutput > contextLength) {
    const message =
      `This model's context window is ${contextLength} tokens. ` +
      `Your request is estimated at ~${estimated} input tokens with ${reservedOutput} reserved for the response, ` +
      `which exceeds the limit. Please shorten the prompt or lower max_tokens.`;
    throw new ContextLengthExceededError(message, {
      statusCode: 400,
      code: 'context_length_exceeded',
      estimatedInputTokens: estimated,
      reservedOutputTokens: reservedOutput,
      contextLength,
      aliasSlug,
    });
  }
}

/**
 * Convenience export: resolve the effective context window for an alias.
 * Returns undefined when no context_length is known — callers should fail open.
 * The executor (Task 3) uses this to resolve the per-candidate context window.
 */
export function resolveContextLength(aliasConfig: ModelConfig, aliasSlug = ''): number | undefined {
  const merged = resolveMetadata(aliasConfig, aliasSlug);
  const ctx = merged?.top_provider?.context_length ?? merged?.context_length;
  return ctx && ctx > 0 ? ctx : undefined;
}

export interface ContextLimitOptions {
  /** Resolved context window from the caller. Falls back to alias metadata when omitted. */
  contextLength?: number;
  /** Requested max output tokens (e.g. streamOptions.maxTokens). */
  maxTokens?: number;
  /** apiType for image-token formula parity with v1 (e.g. 'chat' | 'messages' | 'gemini' | 'responses'). */
  apiType?: string;
}

/** Minimal structural view of a RouteResult — avoids importing inference types here. */
export interface EnforceRouteInfo {
  canonicalModel?: string;
}

/**
 * Enforce the context limit for one routing candidate using a context-shaped
 * request. No-op unless the alias has `enforce_limits` AND the candidate has a
 * canonicalModel. Throws ContextLengthExceededError on violation; the caller
 * catches it (no failover on context-length).
 */
export function enforceContextLimitForRoute(
  context: Context,
  route: EnforceRouteInfo,
  aliasConfig: ModelConfig | undefined,
  maxTokens: number | undefined,
  apiType: string
): void {
  if (!aliasConfig?.enforce_limits || !route.canonicalModel) return;
  enforceContextLimitForContext(context, aliasConfig, route.canonicalModel, {
    contextLength: resolveContextLength(aliasConfig, route.canonicalModel),
    maxTokens,
    apiType,
  });
}

/**
 * Context-shaped analogue of enforceContextLimit. Counts tokens from a pi-ai
 * Context and throws ContextLengthExceededError when estimate + reserved output
 * exceeds the resolved context window. Fail-open when no context length is known.
 */
export function enforceContextLimitForContext(
  context: Context,
  aliasConfig: ModelConfig,
  aliasSlug: string,
  opts: ContextLimitOptions = {}
): void {
  const merged = resolveMetadata(aliasConfig, aliasSlug);
  const contextLength =
    opts.contextLength ?? merged?.top_provider?.context_length ?? merged?.context_length;
  if (!contextLength || contextLength <= 0) {
    logger.debug(`[enforce-limits:context] Skipping '${aliasSlug}': no context_length known.`);
    return; // fail open — we can't enforce what we don't know
  }

  const metadataMaxOutput = merged?.top_provider?.max_completion_tokens;
  const requestedMaxTokens =
    typeof opts.maxTokens === 'number' && opts.maxTokens > 0 ? opts.maxTokens : undefined;
  let reservedOutput: number;
  if (requestedMaxTokens !== undefined && metadataMaxOutput !== undefined) {
    reservedOutput = Math.min(requestedMaxTokens, metadataMaxOutput);
  } else {
    reservedOutput = requestedMaxTokens ?? metadataMaxOutput ?? DEFAULT_OUTPUT_RESERVATION;
  }

  const estimated = Math.ceil(
    estimateContextTokens(context, opts.apiType) * ESTIMATE_SAFETY_MULTIPLIER
  );

  if (estimated + reservedOutput > contextLength) {
    const message =
      `This model's context window is ${contextLength} tokens. ` +
      `Your request is estimated at ~${estimated} input tokens with ${reservedOutput} reserved for the response, ` +
      `which exceeds the limit. Please shorten the prompt or lower max_tokens.`;
    throw new ContextLengthExceededError(message, {
      statusCode: 400,
      code: 'context_length_exceeded',
      estimatedInputTokens: estimated,
      reservedOutputTokens: reservedOutput,
      contextLength,
      aliasSlug,
    });
  }
}
