import { logger } from '../../utils/logger';
import type { RouteResult } from '../routing/router';
import type { RetryAttemptRecord } from './dispatcher-types';

export type FailureReasonFormatter = (error: any, includeStatusCode?: boolean) => string;
export type ErrorSummaryFormatter = (value: unknown) => string;

export function appendSkippedAttempt(
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

export function appendSuccessAttempt(
  retryHistory: RetryAttemptRecord[],
  route: RouteResult,
  apiType?: string,
  upstreamModel?: string
): void {
  retryHistory.push({
    index: retryHistory.length + 1,
    provider: route.provider,
    model: route.model,
    upstreamModel,
    apiType,
    status: 'success',
    reason: 'Request completed successfully',
    retryable: false,
  });
}

export function appendFailureAttempt(
  retryHistory: RetryAttemptRecord[],
  route: RouteResult,
  error: any,
  formatFailureReason: FailureReasonFormatter,
  apiType?: string,
  retryable?: boolean,
  upstreamModel?: string
): void {
  const statusCode = error?.routingContext?.statusCode ?? error?.status ?? error?.statusCode;
  retryHistory.push({
    index: retryHistory.length + 1,
    provider: route.provider,
    model: route.model,
    upstreamModel,
    apiType,
    status: 'failed',
    reason: formatFailureReason(error),
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
    retryable,
    providerResponseHeaders: error?.routingContext?.providerResponseHeaders,
  });
}

/**
 * Resolves pricing for the actually-dispatched upstream model.
 * Only uses same-provider config entries; never borrows cross-provider or alias-catalog pricing.
 */
export function resolveUpstreamPricing(
  finalRoute: RouteResult,
  upstreamModel?: string
): { pricing: any; pricingModel: string; pricingFallback: boolean } {
  const routeModel = finalRoute.model;
  const normalized =
    typeof upstreamModel === 'string' && upstreamModel.length > 0 ? upstreamModel : routeModel;
  if (normalized === routeModel) {
    return {
      pricing: finalRoute.modelConfig?.pricing,
      pricingModel: routeModel,
      pricingFallback: false,
    };
  }
  const models = (finalRoute.config as any)?.models;
  if (models && !Array.isArray(models) && models[normalized]?.pricing) {
    return {
      pricing: models[normalized].pricing,
      pricingModel: normalized,
      pricingFallback: false,
    };
  }
  return {
    pricing: finalRoute.modelConfig?.pricing,
    pricingModel: routeModel,
    pricingFallback: true,
  };
}

export function attachAttemptMetadata(
  response: any,
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[],
  finalRoute: RouteResult,
  apiType: string,
  upstreamModel?: string
): void {
  const responseApiType = response?.plexus?.apiType;
  const normalizedUpstream =
    typeof upstreamModel === 'string' && upstreamModel.length > 0 ? upstreamModel : undefined;
  const resolved = resolveUpstreamPricing(finalRoute, normalizedUpstream);
  if (resolved.pricingFallback && normalizedUpstream) {
    logger.warn(
      `Upstream model '${normalizedUpstream}' has no pricing configured under provider '${finalRoute.provider}'; retaining route pricing from '${finalRoute.model}' and marking pricing_fallback`
    );
  }
  // Ensure the winning success entry carries provenance when the caller
  // threaded it through appendSuccessAttempt already; attach is the final
  // guarantee for callers that only pass it here.
  if (normalizedUpstream) {
    for (let i = retryHistory.length - 1; i >= 0; i--) {
      const entry = retryHistory[i];
      if (
        entry &&
        entry.status === 'success' &&
        entry.provider === finalRoute.provider &&
        entry.model === finalRoute.model &&
        !entry.upstreamModel
      ) {
        entry.upstreamModel = normalizedUpstream;
        break;
      }
    }
  }
  response.plexus = {
    ...(response.plexus || {}),
    attemptCount: attemptedProviders.length,
    finalAttemptProvider: finalRoute.provider,
    finalAttemptModel: finalRoute.model,
    upstreamModel: normalizedUpstream,
    allAttemptedProviders: JSON.stringify(attemptedProviders),
    retryHistory: JSON.stringify(retryHistory),
    canonicalModel: finalRoute.canonicalModel,
    provider: finalRoute.provider,
    model: finalRoute.model,
    apiType: responseApiType || apiType,
    pricing: resolved.pricing,
    pricingModel: resolved.pricingModel,
    pricingFallback: resolved.pricingFallback,
    providerDiscount: finalRoute.config.discount,
    config: { estimateTokens: finalRoute.config.estimateTokens },
  } as any;
}

/**
 * Per-attempt annotation for a single `attemptedProviders` entry: an HTTP
 * status code when the failure carried one, `empty` for a failed attempt
 * recorded with HTTP 200 (the empty-completion failover — the call itself
 * succeeded but the completion carried no visible output, so echoing the
 * raw "(200)" next to real failure codes would read like a contradiction;
 * a malformed/unparseable body on an HTTP 200 also lands here, since
 * dispatcher.ts's parse-failure path stamps the attempt with statusCode
 * 200 — same story: the call "succeeded" but yielded nothing usable),
 * a short reason tag when there's no status code (network/transport errors,
 * mid-stream or TTFB stalls), `skipped` for a target that was never
 * actually dispatched, or `undefined` when there's nothing worth surfacing
 * (e.g. no matching retryHistory record).
 */
function describeAttemptTag(entry: RetryAttemptRecord | undefined): string | undefined {
  if (!entry) return undefined;
  if (entry.status === 'skipped') return 'skipped';
  if (entry.status !== 'failed') return undefined;
  if (entry.statusCode === 200) return 'empty';
  if (typeof entry.statusCode === 'number') return String(entry.statusCode);
  return /stall/i.test(entry.reason) ? 'stall' : 'network';
}

/**
 * Renders the "provider/model (tag), provider/model (tag)" summary for the
 * client-visible failover error. `attemptedProviders` stays the single
 * source of truth for WHICH targets are listed and in what order — this
 * only decorates each entry with a tag drawn from its matching retryHistory
 * record, it never adds or removes targets.
 *
 * Dispatch loops push to `attemptedProviders` and append the corresponding
 * retryHistory record (skipped targets never reach `attemptedProviders`) in
 * lockstep, so matching by `provider/model` key — consumed in encountered
 * order to stay correct even if the same target is attempted twice — lines
 * each summary entry up with its own outcome instead of the last one seen.
 */
function formatAttemptedProvidersSummary(
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[]
): string {
  if (attemptedProviders.length === 0) return 'none';

  const byProviderModel = new Map<string, RetryAttemptRecord[]>();
  for (const entry of retryHistory) {
    // Skipped targets never reach `attemptedProviders` (every skip path
    // `continue`s before pushing to it), so they must never occupy a FIFO
    // slot here either. Otherwise a skip that shares a provider/model key
    // with a LATER real attempt would have its slot consumed first,
    // rendering that real attempt's outcome as `(skipped)` instead of its
    // actual status/tag.
    if (entry.status === 'skipped') continue;
    const key = `${entry.provider}/${entry.model}`;
    const queue = byProviderModel.get(key);
    if (queue) {
      queue.push(entry);
    } else {
      byProviderModel.set(key, [entry]);
    }
  }

  return attemptedProviders
    .map((provider) => {
      const tag = describeAttemptTag(byProviderModel.get(provider)?.shift());
      return tag ? `${provider} (${tag})` : provider;
    })
    .join(', ');
}

export function buildAllTargetsFailedError(
  lastError: any,
  attemptedProviders: string[],
  retryHistory: RetryAttemptRecord[],
  formatFailureReason: FailureReasonFormatter,
  compactErrorSummary: ErrorSummaryFormatter
): Error {
  const summary = formatAttemptedProvidersSummary(attemptedProviders, retryHistory);
  const baseMessage = compactErrorSummary(
    formatFailureReason(lastError) || lastError?.message || 'Unknown provider error'
  );
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
