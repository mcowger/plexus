import Fuse from 'fuse.js';
import { useState, useEffect, useCallback } from 'react';
import { api, Alias, Provider, Model, Cooldown } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

export interface AliasMatch {
  alias: Alias;
  reason: string;
}

export interface OrphanGroup {
  modelId: string;
  existingAlias?: Alias;
  matchReason?: string;
  aliasMatches: AliasMatch[];
  candidates: Array<{ provider: Provider; model: Model }>;
}

interface AliasSearchEntry {
  alias: Alias;
  value: string;
  normalized: string;
}

const EMPTY_ALIAS: Alias = {
  id: '',
  aliases: [],
  priority: 'selector',
  target_groups: [{ name: 'default', selector: 'random', targets: [] }],
  sticky_session: true,
};

const IMPORT_SUPPRESSIONS_STORAGE_KEY = 'plexus_suppressed_import_models';

const getSuppressedImportKey = (value: string) => value.toLowerCase();

const normalizeModelName = (value: string) =>
  value
    .toLowerCase()
    .split('/')
    .at(-1)!
    .split(':')
    .at(0)!
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const readSuppressedImportModels = () => {
  if (typeof window === 'undefined') return new Set<string>();

  try {
    const raw = window.localStorage.getItem(IMPORT_SUPPRESSIONS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch (error) {
    console.warn('Failed to load suppressed import models from localStorage:', error);
    return new Set<string>();
  }
};

const saveSuppressedImportModels = (suppressed: Set<string>) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      IMPORT_SUPPRESSIONS_STORAGE_KEY,
      JSON.stringify(Array.from(suppressed).sort())
    );
  } catch (error) {
    console.warn('Failed to save suppressed import models to localStorage:', error);
  }
};

const getAliasSearchEntries = (aliasList: Alias[]): AliasSearchEntry[] =>
  aliasList.flatMap((alias) =>
    [alias.id, ...(alias.aliases ?? [])]
      .filter((value) => value.trim().length > 0)
      .map((value) => ({ alias, value, normalized: normalizeModelName(value) }))
  );

const getTokenSet = (value: string) =>
  new Set(normalizeModelName(value).split('-').filter(Boolean));

const getSharedPrefixTokenCount = (leftValue: string, rightValue: string) => {
  const left = normalizeModelName(leftValue).split('-');
  const right = normalizeModelName(rightValue).split('-');
  let count = 0;
  while (left[count] && left[count] === right[count]) count += 1;
  return count;
};

const hasStrongModelRelationship = (modelId: string, aliasValue: string) => {
  const normalizedModel = normalizeModelName(modelId);
  const normalizedAlias = normalizeModelName(aliasValue);
  if (!normalizedModel || !normalizedAlias) return false;
  if (normalizedModel === normalizedAlias) return true;
  if (
    normalizedModel.startsWith(`${normalizedAlias}-`) ||
    normalizedAlias.startsWith(`${normalizedModel}-`)
  ) {
    return true;
  }

  const modelTokens = getTokenSet(modelId);
  const aliasTokens = getTokenSet(aliasValue);
  const shared = Array.from(aliasTokens).filter((token) => modelTokens.has(token));
  const aliasCoverage = shared.length / aliasTokens.size;
  const prefixCount = getSharedPrefixTokenCount(modelId, aliasValue);

  return prefixCount >= 4 && aliasCoverage >= 0.8;
};

const getAliasMatches = (modelId: string, aliasList: Alias[]): AliasMatch[] => {
  const entries = getAliasSearchEntries(aliasList);
  const normalizedModel = normalizeModelName(modelId);
  const matches = new Map<string, AliasMatch>();

  const addMatch = (entry: AliasSearchEntry, reason: string) => {
    if (!matches.has(entry.alias.id)) {
      matches.set(entry.alias.id, { alias: entry.alias, reason });
    }
  };

  for (const entry of entries) {
    if (entry.normalized === normalizedModel) {
      addMatch(
        entry,
        entry.value === entry.alias.id ? 'exact match' : `alias match: ${entry.value}`
      );
    }
  }

  for (const entry of entries) {
    if (matches.has(entry.alias.id)) continue;
    if (normalizedModel.startsWith(`${entry.normalized}-`)) {
      addMatch(entry, `base alias match: ${entry.value}`);
    } else if (entry.normalized.startsWith(`${normalizedModel}-`)) {
      addMatch(entry, `variant alias match: ${entry.value}`);
    }
  }

  const fuse = new Fuse(entries, {
    keys: ['normalized'],
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 4,
  });

  for (const result of fuse.search(normalizedModel)) {
    const entry = result.item;
    if (matches.has(entry.alias.id) || !hasStrongModelRelationship(modelId, entry.value)) continue;
    addMatch(entry, `similar alias: ${entry.value}`);
  }

  return Array.from(matches.values());
};

export const useModels = () => {
  const toast = useToast();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<Alias>(EMPTY_ALIAS);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Test State
  const [testStates, setTestStates] = useState<
    Record<
      string,
      {
        loading: boolean;
        result?: 'success' | 'error';
        message?: string;
        showResult: boolean;
        showMessage?: boolean;
      }
    >
  >({});

  // Import Orphaned Models State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [orphanGroups, setOrphanGroups] = useState<OrphanGroup[]>([]);
  const [selectedImports, setSelectedImports] = useState<Map<string, Set<string>>>(new Map());
  const [selectedImportModels, setSelectedImportModels] = useState<Set<string>>(new Set());
  const [selectedImportAliases, setSelectedImportAliases] = useState<Map<string, string>>(
    new Map()
  );
  const [hasSuppressedImportModels, setHasSuppressedImportModels] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [a, p, m, c] = await Promise.all([
        api.getAliases(),
        api.getProviders(),
        api.getModels(),
        api.getCooldowns(),
      ]);
      setAliases(a);
      setProviders(p);
      setAvailableModels(m);
      setCooldowns(c);
      setIsLoading(false);
    } catch (e) {
      console.error('Failed to load data', e);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleEdit = (alias: Alias) => {
    setOriginalId(alias.id);
    setEditingAlias(JSON.parse(JSON.stringify(alias)));
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setOriginalId(null);
    setEditingAlias(JSON.parse(JSON.stringify(EMPTY_ALIAS)) as Alias);
    setIsModalOpen(true);
  };

  const handleSave = async (alias: Alias, oldId: string | null) => {
    setIsSaving(true);
    try {
      await api.saveAlias(alias, oldId || undefined);
      await loadData();
      setIsModalOpen(false);
      return true;
    } catch (e) {
      console.error('Failed to save alias', e);
      toast.error('Failed to save alias');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (aliasId: string) => {
    try {
      await api.deleteAlias(aliasId);
      await loadData();
      return true;
    } catch (e) {
      console.error('Failed to delete alias', e);
      toast.error('Failed to delete alias');
      return false;
    }
  };

  const handleDeleteAll = async () => {
    try {
      await api.deleteAllAliases();
      await loadData();
      return true;
    } catch (e) {
      console.error('Failed to delete all aliases', e);
      toast.error('Failed to delete all aliases');
      return false;
    }
  };

  const handleToggleTarget = async (
    alias: Alias,
    groupIndex: number,
    targetIndex: number,
    newState: boolean
  ) => {
    const updatedAlias = JSON.parse(JSON.stringify(alias)) as Alias;
    if (updatedAlias.target_groups[groupIndex]?.targets[targetIndex]) {
      updatedAlias.target_groups[groupIndex].targets[targetIndex].enabled = newState;
    }

    setAliases((prev) => prev.map((a) => (a.id === alias.id ? updatedAlias : a)));

    try {
      await api.saveAlias(updatedAlias, alias.id);
    } catch (e) {
      console.error('Toggle error', e);
      toast.error('Failed to update target status: ' + e);
      loadData();
    }
  };

  const handleTestTarget = async (
    _aliasId: string,
    testKey: string,
    provider: string,
    model: string,
    apiTypes: string[]
  ) => {
    setTestStates((prev) => ({
      ...prev,
      [testKey]: { loading: true, showResult: true, showMessage: false },
    }));

    try {
      const results = await Promise.all(
        apiTypes.map((apiType) => api.testModel(provider, model, apiType))
      );

      const allSuccess = results.every((r) => r.success);
      const firstError = results.find((r) => !r.success);
      const totalDuration = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
      const avgDuration = Math.round(totalDuration / results.length);

      setTestStates((prev) => ({
        ...prev,
        [testKey]: {
          loading: false,
          result: allSuccess ? 'success' : 'error',
          message: allSuccess
            ? `Success (${avgDuration}ms avg, ${apiTypes.length} API${apiTypes.length > 1 ? 's' : ''})`
            : `Failed via ${firstError?.apiType || 'unknown'}: ${firstError?.error || 'Test failed'}`,
          showResult: true,
          showMessage: true,
        },
      }));

      setTimeout(
        () => {
          setTestStates((prev) => ({
            ...prev,
            [testKey]: { ...prev[testKey], showResult: false },
          }));
        },
        allSuccess ? 3000 : 1500
      );

      if (allSuccess) {
        setTimeout(() => {
          setTestStates((prev) => ({
            ...prev,
            [testKey]: { ...prev[testKey], showMessage: false },
          }));
        }, 3000);
      }
    } catch (e) {
      setTestStates((prev) => ({
        ...prev,
        [testKey]: {
          loading: false,
          result: 'error',
          message: String(e),
          showResult: true,
          showMessage: true,
        },
      }));
      setTimeout(() => {
        setTestStates((prev) => ({
          ...prev,
          [testKey]: { ...prev[testKey], showResult: false },
        }));
      }, 1500);
    }
  };

  const dismissTestMessage = (testKey: string) => {
    setTestStates((prev) => ({
      ...prev,
      [testKey]: { ...prev[testKey], showMessage: false },
    }));
  };

  const filteredAliases = aliases.filter((a) => a.id.toLowerCase().includes(search.toLowerCase()));

  const handleOpenImport = useCallback(() => {
    const covered = new Set<string>();
    const suppressedImports = readSuppressedImportModels();
    setHasSuppressedImportModels(suppressedImports.size > 0);
    aliases.forEach((alias) => {
      alias.target_groups.forEach((g) => {
        g.targets.forEach((t) => {
          covered.add(`${t.provider}|${t.model}`);
        });
      });
    });

    const orphanMap = new Map<string, Array<{ provider: Provider; model: Model }>>();
    const canonicalIds = new Map<string, string>();
    availableModels.forEach((model) => {
      const key = `${model.providerId}|${model.id}`;
      if (covered.has(key)) return;
      if (suppressedImports.has(getSuppressedImportKey(model.id))) return;

      const groupKey = model.id.toLowerCase();
      if (!canonicalIds.has(groupKey)) {
        canonicalIds.set(groupKey, model.id);
      }

      if (!orphanMap.has(groupKey)) {
        orphanMap.set(groupKey, []);
      }
      const provider = providers.find((p) => p.id === model.providerId);
      if (provider) {
        orphanMap.get(groupKey)!.push({ provider, model });
      }
    });

    const groups: OrphanGroup[] = [];
    orphanMap.forEach((candidates, groupKey) => {
      const modelId = canonicalIds.get(groupKey) || groupKey;
      const aliasMatches = getAliasMatches(modelId, aliases);
      groups.push({
        modelId,
        existingAlias: aliasMatches[0]?.alias,
        matchReason: aliasMatches[0]?.reason,
        aliasMatches,
        candidates,
      });
    });
    groups.sort((a, b) => a.modelId.localeCompare(b.modelId));

    const selections = new Map<string, Set<string>>();
    const aliasSelections = new Map<string, string>();
    groups.forEach((group) => {
      selections.set(group.modelId, new Set(group.candidates.map((c) => c.provider.id)));
      if (group.aliasMatches[0]) {
        aliasSelections.set(group.modelId, group.aliasMatches[0].alias.id);
      }
    });

    setOrphanGroups(groups);
    setSelectedImports(selections);
    setSelectedImportModels(new Set());
    setSelectedImportAliases(aliasSelections);
    setIsImportModalOpen(true);
  }, [aliases, availableModels, providers]);

  const handleSuppressImportModel = useCallback((modelId: string) => {
    const nextSuppressed = readSuppressedImportModels();
    nextSuppressed.add(getSuppressedImportKey(modelId));
    saveSuppressedImportModels(nextSuppressed);
    setHasSuppressedImportModels(true);

    setOrphanGroups((prev) => prev.filter((group) => group.modelId !== modelId));
    setSelectedImports((prev) => {
      const next = new Map(prev);
      next.delete(modelId);
      return next;
    });
    setSelectedImportModels((prev) => {
      const next = new Set(prev);
      next.delete(modelId);
      return next;
    });
    setSelectedImportAliases((prev) => {
      const next = new Map(prev);
      next.delete(modelId);
      return next;
    });
  }, []);

  const handleUnsuppressAllImportModels = useCallback(() => {
    saveSuppressedImportModels(new Set());
    handleOpenImport();
  }, [handleOpenImport]);

  const handleSaveImports = useCallback(async () => {
    setIsImporting(true);
    try {
      for (const modelId of selectedImportModels) {
        const providerIds = selectedImports.get(modelId) ?? new Set<string>();
        if (providerIds.size === 0) continue;

        const group = orphanGroups.find((g) => g.modelId === modelId);
        if (!group) continue;

        const selectedCandidates = group.candidates.filter((c) => providerIds.has(c.provider.id));
        const selectedAliasId = selectedImportAliases.get(modelId);
        const selectedAlias = selectedAliasId
          ? group.aliasMatches.find((match) => match.alias.id === selectedAliasId)?.alias
          : undefined;

        if (selectedAlias) {
          const updatedAlias = JSON.parse(JSON.stringify(selectedAlias)) as Alias;
          if (!updatedAlias.target_groups[0]) {
            updatedAlias.target_groups = [{ name: 'default', selector: 'random', targets: [] }];
          }
          // Merge into the first group of the existing alias
          selectedCandidates.forEach((c) => {
            const alreadyExists = updatedAlias.target_groups[0].targets.some(
              (t) => t.provider === c.provider.id && t.model === c.model.id
            );
            if (!alreadyExists) {
              updatedAlias.target_groups[0].targets.push({
                provider: c.provider.id,
                model: c.model.id,
                enabled: true,
              });
            }
          });
          await api.saveAlias(updatedAlias, selectedAlias.id);
        } else {
          const newAlias: Alias = {
            ...EMPTY_ALIAS,
            id: modelId,
            target_groups: [
              {
                name: 'default',
                selector: 'random',
                targets: selectedCandidates.map((c) => ({
                  provider: c.provider.id,
                  model: c.model.id,
                  enabled: true,
                })),
              },
            ],
          };
          await api.saveAlias(newAlias, undefined);
        }
      }

      await loadData();
      toast.success('Imports saved successfully');
      setIsImportModalOpen(false);
      setSelectedImports(new Map());
      setSelectedImportModels(new Set());
      setSelectedImportAliases(new Map());
      setOrphanGroups([]);
      return true;
    } catch (e) {
      console.error('Failed to save imports', e);
      toast.error('Failed to save imports');
      return false;
    } finally {
      setIsImporting(false);
    }
  }, [selectedImportModels, selectedImports, selectedImportAliases, orphanGroups, loadData, toast]);

  return {
    aliases: filteredAliases,
    allAliases: aliases,
    providers,
    availableModels,
    cooldowns,
    search,
    setSearch,
    isLoading,
    isModalOpen,
    setIsModalOpen,
    editingAlias,
    setEditingAlias,
    originalId,
    isSaving,
    testStates,
    handleEdit,
    handleAddNew,
    handleSave,
    handleDelete,
    handleDeleteAll,
    handleToggleTarget,
    handleTestTarget,
    dismissTestMessage,
    loadData,
    isImportModalOpen,
    setIsImportModalOpen,
    orphanGroups,
    setOrphanGroups,
    selectedImports,
    setSelectedImports,
    selectedImportModels,
    setSelectedImportModels,
    selectedImportAliases,
    setSelectedImportAliases,
    hasSuppressedImportModels,
    isImporting,
    handleOpenImport,
    handleSuppressImportModel,
    handleUnsuppressAllImportModels,
    handleSaveImports,
  };
};
