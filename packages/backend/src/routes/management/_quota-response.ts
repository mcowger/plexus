import { QuotaCheckSnapshot, resolveQuotaNames } from '../../services/quota/quota-enforcer';
import type { KeyConfig, PlexusConfig } from '../../config';

/** Wire shape for one entry of the `quotas` array — see task-5 brief. Scope
 * lists are omitted when empty rather than serialized as `[]`. */
export interface QuotaSnapshotJson {
  name: string;
  limitType: 'requests' | 'tokens' | 'cost';
  limit: number;
  currentUsage: number;
  remaining: number;
  allowed: boolean;
  resetsAt: string;
  scope: {
    allowedModels?: string[];
    allowedProviders?: string[];
    excludedModels?: string[];
    excludedProviders?: string[];
  };
  global: boolean;
  shared: boolean;
  warnAt?: number;
  source: 'assigned' | 'default';
}

/**
 * Serialize one `QuotaCheckSnapshot` to its wire JSON shape. Shared by
 * `quota-enforcement.ts` (`GET /quota/status/:key`) and `self.ts`
 * (`GET /self/quota`) so the array-shape mapping lives in exactly one place.
 */
export function serializeQuotaSnapshot(check: QuotaCheckSnapshot): QuotaSnapshotJson {
  const scope: QuotaSnapshotJson['scope'] = {};
  if (check.scope.allowedModels && check.scope.allowedModels.length > 0) {
    scope.allowedModels = check.scope.allowedModels;
  }
  if (check.scope.allowedProviders && check.scope.allowedProviders.length > 0) {
    scope.allowedProviders = check.scope.allowedProviders;
  }
  if (check.scope.excludedModels && check.scope.excludedModels.length > 0) {
    scope.excludedModels = check.scope.excludedModels;
  }
  if (check.scope.excludedProviders && check.scope.excludedProviders.length > 0) {
    scope.excludedProviders = check.scope.excludedProviders;
  }

  return {
    name: check.quotaName,
    limitType: check.limitType,
    limit: check.limit,
    currentUsage: check.currentUsage,
    remaining: check.remaining,
    allowed: check.allowed,
    resetsAt: new Date(check.resetsAtMs).toISOString(),
    scope,
    global: check.global,
    shared: check.shared,
    ...(check.warnAt !== undefined ? { warnAt: check.warnAt } : {}),
    source: check.source,
  };
}

/**
 * Legacy single-quota shim: the most-constrained check in a key's context
 * (smallest remaining/limit ratio). Both routes keep exposing their
 * pre-Phase-5 top-level fields (derived from this) for wire compat,
 * alongside the new `quotas` array.
 */
export function mostConstrained(checks: QuotaCheckSnapshot[]): QuotaCheckSnapshot | null {
  if (checks.length === 0) return null;
  return checks.reduce((min, c) => (c.remaining / c.limit < min.remaining / min.limit ? c : min));
}

/**
 * Effective quota-name set for a key, flattened to a plain name list for
 * membership validation on `/quota/clear` and `/quota/recompute` (which the
 * enforcer itself does not guard). Delegates to the enforcer's own
 * `resolveQuotaNames` so route validation and live enforcement can never
 * drift apart.
 */
export function resolveAttachedQuotaNames(keyConfig: KeyConfig, config: PlexusConfig): string[] {
  return resolveQuotaNames(keyConfig, config)?.names ?? [];
}
