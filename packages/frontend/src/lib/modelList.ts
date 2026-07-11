import type { Alias, Provider } from './api';

export type ModelListSortField = 'alias' | 'provider' | 'targets';
export type ModelListSortDirection = 'asc' | 'desc';

const normalize = (value: string) => value.trim().toLowerCase();

export const getProviderDisplayLabel = (provider: Provider | undefined, fallbackId = '') => {
  if (!provider) return fallbackId;

  const name = provider.name?.trim() || provider.id || fallbackId;
  if (!name) return fallbackId;

  return name === provider.id ? name : `${name} (${provider.id})`;
};

export const getAliasTargetCount = (alias: Alias) =>
  alias.target_groups.reduce((count, group) => count + group.targets.length, 0);

export const getAliasProviderLabels = (alias: Alias, providers: Provider[]) => {
  const providerById = new Map(providers.map((provider) => [provider.id, provider] as const));
  const labels = new Set<string>();

  for (const group of alias.target_groups) {
    for (const target of group.targets) {
      labels.add(getProviderDisplayLabel(providerById.get(target.provider), target.provider));
    }
  }

  return Array.from(labels).sort((left, right) => left.localeCompare(right));
};

export const getModelListProviderOptions = (aliases: Alias[], providers: Provider[]) => {
  const providerIds = new Set<string>();
  for (const alias of aliases) {
    for (const group of alias.target_groups) {
      for (const target of group.targets) {
        providerIds.add(target.provider);
      }
    }
  }

  return providers
    .filter((provider) => providerIds.has(provider.id))
    .map((provider) => getProviderDisplayLabel(provider))
    .sort((left, right) => left.localeCompare(right));
};

export const aliasMatchesProviderFilters = (
  alias: Alias,
  selectedProviders: string[],
  providers: Provider[]
) => {
  if (selectedProviders.length === 0) return true;

  const providerLabels = getAliasProviderLabels(alias, providers);
  return providerLabels.some((label) => selectedProviders.includes(label));
};

export const aliasMatchesSearch = (alias: Alias, search: string) => {
  const term = normalize(search);
  if (!term) return true;

  return normalize(alias.id).includes(term);
};

const getSortKey = (alias: Alias, providers: Provider[], field: ModelListSortField) => {
  switch (field) {
    case 'provider':
      return getAliasProviderLabels(alias, providers).join(' / ');
    case 'targets':
      return String(getAliasTargetCount(alias)).padStart(6, '0');
    case 'alias':
    default:
      return alias.id;
  }
};

export const sortAliasesForModelsPage = (
  aliases: Alias[],
  providers: Provider[],
  field: ModelListSortField,
  direction: ModelListSortDirection
) => {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...aliases].sort((left, right) => {
    const leftKey = normalize(getSortKey(left, providers, field));
    const rightKey = normalize(getSortKey(right, providers, field));
    const primary = leftKey.localeCompare(rightKey);
    if (primary !== 0) return primary * multiplier;

    return left.id.localeCompare(right.id);
  });
};

export const filterAndSortAliasesForModelsPage = (
  aliases: Alias[],
  providers: Provider[],
  search: string,
  selectedProviders: string[],
  field: ModelListSortField,
  direction: ModelListSortDirection
) => {
  const filtered = aliases.filter(
    (alias) =>
      aliasMatchesSearch(alias, search) &&
      aliasMatchesProviderFilters(alias, selectedProviders, providers)
  );

  return sortAliasesForModelsPage(filtered, providers, field, direction);
};

export const getDefaultModelListSortDirection = (field: ModelListSortField) =>
  field === 'targets' ? 'desc' : 'asc';
