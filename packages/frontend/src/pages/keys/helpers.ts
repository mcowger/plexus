import type { KeyConfig, Provider, UserQuota } from '../../lib/api';

export function isLeakyRollingDef(def: UserQuota | undefined): boolean {
  if (!def) return false;
  return def.type === 'rolling' && (def.limitType === 'requests' || def.limitType === 'tokens');
}

export function isKeyDisabled(key: KeyConfig): boolean {
  return (
    key.disabledAt !== undefined || (key.expiresAt !== undefined && key.expiresAt <= Date.now())
  );
}

export function formatExpiry(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function getQuotaStatusColor(percent: number): string {
  if (percent >= 90) return 'var(--color-danger)';
  if (percent >= 75) return 'var(--color-warning)';
  return 'var(--color-success)';
}

export function getAllModelNames(providers: Provider[]): string[] {
  return Array.from(
    new Set(
      providers.flatMap((provider) =>
        provider.models && !Array.isArray(provider.models) ? Object.keys(provider.models) : []
      )
    )
  ).sort();
}

export function filterKeys(keys: KeyConfig[], search: string): KeyConfig[] {
  const query = search.toLowerCase();
  return keys.filter(
    (key) =>
      key.key.toLowerCase().includes(query) ||
      (key.comment && key.comment.toLowerCase().includes(query)) ||
      key.quotas?.some((name) => name.toLowerCase().includes(query)) ||
      key.allowedModels?.some((model) => model.toLowerCase().includes(query)) ||
      key.allowedProviders?.some((provider) => provider.toLowerCase().includes(query)) ||
      key.excludedModels?.some((model) => model.toLowerCase().includes(query)) ||
      key.excludedProviders?.some((provider) => provider.toLowerCase().includes(query))
  );
}

export function filterQuotas(
  quotas: Record<string, UserQuota>,
  search: string
): Array<[string, UserQuota]> {
  const query = search.toLowerCase();
  return Object.entries(quotas).filter(([name]) => name.toLowerCase().includes(query));
}
