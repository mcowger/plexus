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

export function formatApiTypeLabel(apiType: string | undefined): string {
  if (!apiType) return '?';
  const base = getApiBaseType(apiType);
  const subtype = getApiSubtype(apiType);
  const baseLabel = base.charAt(0).toUpperCase() + base.slice(1);
  return subtype
    ? `${baseLabel} · ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`
    : baseLabel;
}
