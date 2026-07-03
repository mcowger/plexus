/**
 * Shared provider/model scope-matching utility.
 *
 * Originally the allow/exclude list logic embedded in API-key access policy
 * (see key-access-policy.ts); extracted here so quota scoping can reuse the
 * exact same semantics. Exact string equality only — no wildcards/globs.
 *
 * Semantics:
 *   - excluded wins: a value on the excluded list is blocked even if it is
 *     also on the allowed list.
 *   - empty/absent allowed list = allow all (no restriction).
 *   - empty/absent excluded list = no exclusions (no-op).
 */

export interface ScopeLists {
  allowedModels?: string[];
  allowedProviders?: string[];
  excludedModels?: string[];
  excludedProviders?: string[];
}

/** Exact-match membership rule: excluded wins; empty/absent allowed list = allow all. */
export function listAllows(
  allowed: string[] | undefined,
  excluded: string[] | undefined,
  value: string
): boolean {
  if (excluded && excluded.includes(value)) return false;
  if (allowed && allowed.length > 0 && !allowed.includes(value)) return false;
  return true;
}

/**
 * 4-list AND over (provider, model): providers axis via
 * listAllows(allowedProviders, excludedProviders, provider), models axis via
 * listAllows(allowedModels, excludedModels, model). All-empty scope matches
 * everything.
 */
export function scopeMatches(scope: ScopeLists, provider: string, model: string): boolean {
  return (
    listAllows(scope.allowedProviders, scope.excludedProviders, provider) &&
    listAllows(scope.allowedModels, scope.excludedModels, model)
  );
}

/** True when all four lists are absent or empty. */
export function isGlobalScope(scope: ScopeLists): boolean {
  return (
    (!scope.allowedModels || scope.allowedModels.length === 0) &&
    (!scope.allowedProviders || scope.allowedProviders.length === 0) &&
    (!scope.excludedModels || scope.excludedModels.length === 0) &&
    (!scope.excludedProviders || scope.excludedProviders.length === 0)
  );
}
