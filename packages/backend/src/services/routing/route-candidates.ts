import type { UnifiedChatRequest } from '../../types/unified';
import { getConfig } from '../../config';
import { applyKeyAccessPolicy } from './key-access-policy';
import { Router, type RouteResult } from './router';
import { applyAutoRouting } from './auto-router';
import { QuotaEnforcer } from '../quota/quota-enforcer';
import { buildQuotaExceededError } from '../quota/quota-middleware';
import type { RetryAttemptRecord } from '../dispatch/dispatcher-types';

export type AppendSkippedAttempt = (
  retryHistory: RetryAttemptRecord[],
  route: RouteResult,
  reason: string,
  apiType?: string
) => void;

/**
 * Apply the `auto` policy after access/quota eligibility is known. Ordinary
 * aliases (and direct groups to non-auto groups) are returned untouched, so
 * existing selector behavior is unaffected.
 */
async function applyAutoRoutingIfConfigured(
  request: UnifiedChatRequest,
  candidates: RouteResult[],
  signal?: AbortSignal
): Promise<RouteResult[]> {
  const hasAutoCandidate = candidates.some(
    (candidate) => candidate.autoProvenance?.groupSelector === 'auto'
  );
  if (!hasAutoCandidate) return candidates;

  const canonicalModel = candidates[0]?.canonicalModel;
  if (!canonicalModel) return candidates;
  const alias = getConfig().models?.[canonicalModel];
  if (!alias?.target_groups?.some((group) => group.selector === 'auto')) return candidates;

  const { candidates: ordered } = await applyAutoRouting({
    request,
    alias,
    canonicalModel,
    candidates,
    signal,
  });
  return ordered;
}

/** Resolves usable targets for a request, including access and quota filtering. */
export async function resolveRouteCandidates(
  request: UnifiedChatRequest,
  retryHistory: RetryAttemptRecord[],
  sessionKey: string | null,
  appendSkippedAttempt: AppendSkippedAttempt,
  signal?: AbortSignal
): Promise<RouteResult[]> {
  let candidates = await Router.resolveCandidates(
    request.model,
    request.incomingApiType,
    sessionKey
  );

  // Fallback for direct/provider/model syntax and legacy single-route behavior.
  if (candidates.length === 0) {
    candidates = [await Router.resolve(request.model, request.incomingApiType)];
  }

  if (candidates.length === 0) {
    throw new Error(`No route candidates found for model '${request.model}'`);
  }

  const apiType = request.incomingApiType || 'chat';
  candidates = applyKeyAccessPolicy(request, candidates, apiType);

  const quotaContext = request.metadata?.plexus_metadata?.plexus_quota_context ?? null;
  if (!quotaContext) {
    return applyAutoRoutingIfConfigured(request, candidates, signal);
  }

  const { allowed, blocked } = QuotaEnforcer.filterCandidates(quotaContext, candidates);
  for (const { candidate, quota } of blocked) {
    appendSkippedAttempt(retryHistory, candidate, `quota_exceeded:${quota.quotaName}`, apiType);
  }

  if (allowed.length === 0) {
    throw buildQuotaExceededError(
      blocked.map((entry) => entry.quota),
      retryHistory
    );
  }

  return applyAutoRoutingIfConfigured(request, allowed, signal);
}
