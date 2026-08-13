import type { AliasTargetGroup, Model } from './api';

export const getModelOptionKey = (providerId: string | undefined, modelId: string | undefined) =>
  `${providerId ?? ''}\u0000${modelId ?? ''}`;

export const dedupeModels = <T extends Pick<Model, 'id' | 'providerId'>>(models: T[]): T[] => {
  const seen = new Set<string>();

  return models.filter((model) => {
    const key = getModelOptionKey(model.providerId, model.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();

  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

export const dedupeAliasTargets = (groups: AliasTargetGroup[]): AliasTargetGroup[] => {
  const seen = new Set<string>();

  return groups.map((group) => ({
    ...group,
    targets: group.targets.filter((target) => {
      const key = target.alias
        ? `alias\u0000${target.alias}`
        : getModelOptionKey(target.provider, target.model);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  }));
};
