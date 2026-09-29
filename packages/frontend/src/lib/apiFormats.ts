export interface ApiFormat {
  type: string;
  subtype?: string;
}

export type ApiAccess = string | ApiFormat;

export function apiAccessToKey(access: ApiAccess): string {
  if (typeof access === 'string') return access.trim().toLowerCase();
  const type = access.type.trim().toLowerCase();
  const subtype = access.subtype?.trim().toLowerCase();
  return subtype ? `${type}:${subtype}` : type;
}

export function getApiBaseType(apiType: string): string {
  return apiType.trim().toLowerCase().split(':', 1)[0] || '';
}

export function getApiSubtype(apiType: string): string | undefined {
  const normalized = apiType.trim().toLowerCase();
  const separator = normalized.indexOf(':');
  return separator === -1 ? undefined : normalized.slice(separator + 1) || undefined;
}

export function hasApiAccess(access: readonly ApiAccess[] | undefined, key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return access?.some((entry) => apiAccessToKey(entry) === normalizedKey) ?? false;
}

export function toggleApiAccess(
  access: readonly ApiAccess[] | undefined,
  format: ApiFormat
): ApiAccess[] {
  const current = access ? [...access] : [];
  const key = apiAccessToKey(format);
  if (hasApiAccess(current, key)) {
    return current.filter((entry) => apiAccessToKey(entry) !== key);
  }
  return [...current, format.subtype ? format : format.type];
}

export function normalizeApiAccessList(access: readonly ApiAccess[] | undefined): string[] {
  return access?.map(apiAccessToKey).filter(Boolean) ?? [];
}

/**
 * Target protocols able to serve Decisions requests. `systemone` is
 * canonical (TypeSafe's System One protocol); `openrouter-decisions` and
 * `typesafe-decisions` are deprecated aliases still found in stored configs
 * (the backend normalizes them at load time).
 */
const DECISIONS_TARGET_BASE_TYPES: ReadonlySet<string> = new Set([
  'systemone',
  'openrouter-decisions',
  'typesafe-decisions',
]);

/** True when an `access_via` entry (string or {type, subtype}) is Decisions-capable. */
export function isDecisionsTargetAccess(access: ApiAccess): boolean {
  return DECISIONS_TARGET_BASE_TYPES.has(getApiBaseType(apiAccessToKey(access)));
}

function systemOneAccessEntry(entry: ApiAccess): ApiAccess {
  const base = getApiBaseType(apiAccessToKey(entry));
  if (base === 'systemone' || !DECISIONS_TARGET_BASE_TYPES.has(base)) return entry;
  if (typeof entry === 'string') return 'systemone';
  return { ...entry, type: 'systemone' };
}

/**
 * Rewrite legacy Decisions `access_via` entries onto `systemone`,
 * preserving subtypes and collapsing duplicates. Returns undefined when the
 * input is undefined; otherwise always returns a new array.
 */
export function migrateLegacyDecisionsAccess(
  access: readonly ApiAccess[] | undefined
): ApiAccess[] | undefined {
  if (access === undefined) return undefined;
  const seen = new Set<string>();
  const next: ApiAccess[] = [];
  for (const entry of access) {
    const mapped = systemOneAccessEntry(entry);
    const key = apiAccessToKey(mapped);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(mapped);
  }
  return next;
}

/**
 * Rewrite legacy Decisions `apiBaseUrl` keys onto `systemone`. An explicit
 * `systemone` entry always wins; a base of exactly the old preset value
 * (`/api/alpha`) is rewritten to `/api/v1`, while custom bases are kept
 * verbatim. Returns the input unchanged when there is nothing to migrate.
 */
export function migrateLegacyDecisionsBaseUrls<
  T extends string | Record<string, string> | undefined,
>(apiBaseUrl: T): T {
  if (!apiBaseUrl || typeof apiBaseUrl !== 'object' || Array.isArray(apiBaseUrl)) {
    return apiBaseUrl;
  }
  const legacyKeys = Object.keys(apiBaseUrl).filter(
    (key) =>
      DECISIONS_TARGET_BASE_TYPES.has(key.trim().toLowerCase()) &&
      key.trim().toLowerCase() !== 'systemone'
  );
  if (legacyKeys.length === 0) return apiBaseUrl;
  const next: Record<string, string> = { ...(apiBaseUrl as Record<string, string>) };
  for (const key of legacyKeys) {
    const base = next[key] as string;
    delete next[key];
    if (next['systemone'] === undefined) {
      next['systemone'] =
        base.replace(/\/+$/, '').toLowerCase() === 'https://openrouter.ai/api/alpha'
          ? 'https://openrouter.ai/api/v1'
          : base;
    }
  }
  return next as T;
}

export function formatApiTypeLabel(apiType: string | undefined): string {
  if (!apiType) return '?';
  const base = getApiBaseType(apiType);
  const subtype = getApiSubtype(apiType);
  const baseLabel = base.charAt(0).toUpperCase() + base.slice(1);
  return subtype
    ? `${baseLabel} · ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`
    : baseLabel;
}
