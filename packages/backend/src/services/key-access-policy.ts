/**
 * Shared key-access-policy helpers.
 *
 * Extracted from Dispatcher so the beta pi-ai executor can apply the same
 * policy logic without depending on the full Dispatcher class. Membership
 * decisions (allow/exclude list matching) are delegated to the shared
 * scope-match util.
 */

import type { RouteResult } from './router';
import { isGlobalScope, listAllows, type ScopeLists } from './scope-match';

export type KeyAccessPolicy = ScopeLists;

export interface PolicyRequest {
  model: string;
  metadata?: {
    plexus_metadata?: {
      plexus_key_policy?: KeyAccessPolicy;
    };
  };
}

function buildAccessDeniedError(message: string): Error {
  const error = new Error(message) as Error & {
    routingContext?: Record<string, unknown>;
  };
  error.routingContext = {
    statusCode: 403,
    errorType: 'access_denied',
  };
  return error;
}

export function getKeyAccessPolicy(request: PolicyRequest): KeyAccessPolicy | null {
  const policy = request.metadata?.plexus_metadata?.plexus_key_policy;
  if (!policy) return null;

  if (isGlobalScope(policy)) return null;

  return policy;
}

export function applyKeyAccessPolicy(
  request: PolicyRequest,
  candidates: RouteResult[],
  apiType: string
): RouteResult[] {
  const policy = getKeyAccessPolicy(request);
  if (!policy) return candidates;

  // Model-level: excluded wins, then the model must be on the allowlist (if any).
  if (!listAllows(policy.allowedModels, policy.excludedModels, request.model)) {
    throw buildAccessDeniedError(
      `Key is not allowed to access model '${request.model}' for ${apiType}`
    );
  }

  // Provider-level: excluded wins, then candidates are narrowed to the allowlist (if any).
  const filtered = candidates.filter((candidate) =>
    listAllows(policy.allowedProviders, policy.excludedProviders, candidate.provider)
  );
  if (filtered.length === 0) {
    throw buildAccessDeniedError(
      `Key is not allowed to access any provider configured for model '${request.model}'`
    );
  }

  return filtered;
}
