import type { UnifiedChatRequest } from '../../types/unified';
import { applyKeyAccessPolicy } from './key-access-policy';
import { Router, type RouteResult } from './router';
import { QuotaEnforcer } from '../quota/quota-enforcer';
import { buildQuotaExceededError } from '../quota/quota-middleware';
import type { RetryAttemptRecord } from '../dispatch/dispatcher-types';

export type AppendSkippedAttempt = (
  retryHistory: RetryAttemptRecord[],
  route: RouteResult,
  reason: string,
  apiType?: string
) => void;

/** Resolves usable targets for a request, including access and quota filtering. */
export async function resolveRouteCandidates(
  request: UnifiedChatRequest,
  retryHistory: RetryAttemptRecord[],
  sessionKey: string | null,
  appendSkippedAttempt: AppendSkippedAttempt
): Promise<RouteResult[]> {
  // `<alias>@<tier>` picks a service tier by model name. Route and authorize against the bare
  // alias; `request.model` keeps what the client sent (it is logged as the incoming alias).
  const { model: routedModel, serviceTier } = Router.splitServiceTier(request.model);
  if (serviceTier) request.serviceTier = serviceTier;

  let candidates = await Router.resolveCandidates(routedModel, request.incomingApiType, sessionKey);

  // Fallback for direct/provider/model syntax and legacy single-route behavior.
  if (candidates.length === 0) {
    candidates = [await Router.resolve(routedModel, request.incomingApiType)];
  }

  if (candidates.length === 0) {
    throw new Error(`No route candidates found for model '${request.model}'`);
  }

  const apiType = request.incomingApiType || 'chat';
  candidates = applyKeyAccessPolicy(
    { ...request, baseModel: serviceTier ? routedModel : undefined },
    candidates,
    apiType
  );

  const quotaContext = request.metadata?.plexus_metadata?.plexus_quota_context ?? null;
  if (!quotaContext) return candidates;

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

  return allowed;
}
