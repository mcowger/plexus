import type { ModelConfig } from '../config';
import type { UnifiedChatRequest } from '../types/unified';
import { estimateInputTokens } from '../utils/estimate-tokens';
import { logger } from '../utils/logger';
import { ModelMetadataManager, mergeOverrides } from './model-metadata-manager';

// Heuristic estimator has ±20–30% variance; inflate the estimate by 10% so we
// err on the side of rejecting a borderline-oversized request rather than
// shipping it upstream and getting an opaque 400.
const ESTIMATE_SAFETY_MULTIPLIER = 1.1;

// Fallback reservation when we have no metadata max_completion_tokens and the
// caller didn't specify max_tokens. Matches a common default completion budget.
const DEFAULT_OUTPUT_RESERVATION = 4096;

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
function resolveMetadata(aliasConfig: ModelConfig) {
  const metadata = aliasConfig.metadata;
  if (!metadata) return undefined;

  let base;
  if (metadata.source !== 'custom') {
    base = ModelMetadataManager.getInstance().getMetadata(metadata.source, metadata.source_path);
  }
  return mergeOverrides(base, metadata.overrides);
}

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
  const merged = resolveMetadata(aliasConfig);

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
