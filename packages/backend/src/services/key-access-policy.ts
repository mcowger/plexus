/**
 * Shared key-access-policy helpers.
 *
 * Extracted from Dispatcher so the beta pi-ai executor can apply the same
 * policy logic without depending on the full Dispatcher class.
 */

import type { RouteResult } from './router';

export interface KeyAccessPolicy {
  allowedModels?: string[];
  allowedProviders?: string[];
  excludedModels?: string[];
  excludedProviders?: string[];
}

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

  if (
    (!policy.allowedModels || policy.allowedModels.length === 0) &&
    (!policy.allowedProviders || policy.allowedProviders.length === 0) &&
    (!policy.excludedModels || policy.excludedModels.length === 0) &&
    (!policy.excludedProviders || policy.excludedProviders.length === 0)
  ) {
    return null;
  }

  return policy;
}

export function applyKeyAccessPolicy(
  request: PolicyRequest,
  candidates: RouteResult[],
  apiType: string
): RouteResult[] {
  const policy = getKeyAccessPolicy(request);
  if (!policy) return candidates;

  // Excluded models: block if the requested model is in the denylist
  if (policy.excludedModels && policy.excludedModels.includes(request.model)) {
    throw buildAccessDeniedError(
      `Key is not allowed to access model '${request.model}' for ${apiType}`
    );
  }

  // Allowed models: block if the requested model is NOT in the allowlist
  if (policy.allowedModels && !policy.allowedModels.includes(request.model)) {
    throw buildAccessDeniedError(
      `Key is not allowed to access model '${request.model}' for ${apiType}`
    );
  }

  // Excluded providers: filter out candidates on the denylist
  let filtered = candidates;
  if (policy.excludedProviders && policy.excludedProviders.length > 0) {
    filtered = filtered.filter(
      (candidate) => !policy.excludedProviders!.includes(candidate.provider)
    );
    if (filtered.length === 0) {
      throw buildAccessDeniedError(
        `Key is not allowed to access any provider configured for model '${request.model}'`
      );
    }
  }

  // Allowed providers: filter candidates to only those on the allowlist
  if (policy.allowedProviders && policy.allowedProviders.length > 0) {
    filtered = filtered.filter((candidate) =>
      policy.allowedProviders!.includes(candidate.provider)
    );
    if (filtered.length === 0) {
      throw buildAccessDeniedError(
        `Key is not allowed to access any provider configured for model '${request.model}'`
      );
    }
  }

  return filtered;
}
