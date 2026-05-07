import { useState, useEffect, useCallback } from 'react';
import { api, Alias, Provider, Model, Cooldown } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

export interface OrphanGroup {
  modelId: string;
  existingAlias?: Alias;
  candidates: Array<{ provider: Provider; model: Model }>;
}

const EMPTY_ALIAS: Alias = {
  id: '',
  aliases: [],
  selector: 'random',
  priority: 'selector',
  targets: [],
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
      { loading: boolean; result?: 'success' | 'error'; message?: string; showResult: boolean }
    >
  >({});

  // Import Orphaned Models State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [orphanGroups, setOrphanGroups] = useState<OrphanGroup[]>([]);
  const [selectedImports, setSelectedImports] = useState<Map<string, Set<string>>>(new Map());
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
    setEditingAlias({ ...EMPTY_ALIAS, targets: [] });
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

  const handleToggleTarget = async (alias: Alias, targetIndex: number, newState: boolean) => {
    const updatedAlias = JSON.parse(JSON.stringify(alias));
    updatedAlias.targets[targetIndex].enabled = newState;

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
    aliasId: string,
    targetIndex: number,
    provider: string,
    model: string,
    apiTypes: string[]
  ) => {
    const testKey = `${aliasId}-${targetIndex}`;
    setTestStates((prev) => ({ ...prev, [testKey]: { loading: true, showResult: true } }));

    try {
      const results = await Promise.all(
        apiTypes.map((apiType) => api.testModel(provider, model, apiType))
      );

      const allSuccess = results.every((r) => r.success);
      const firstError = results.find((r) => !r.success);
      const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
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
        },
      }));

      if (allSuccess) {
        setTimeout(() => {
          setTestStates((prev) => ({
            ...prev,
            [testKey]: { ...prev[testKey], showResult: false },
          }));
        }, 3000);
      }
    } catch (e) {
      setTestStates((prev) => ({
        ...prev,
        [testKey]: { loading: false, result: 'error', message: String(e), showResult: true },
      }));
    }
  };

  const filteredAliases = aliases.filter((a) => a.id.toLowerCase().includes(search.toLowerCase()));

  const handleOpenImport = useCallback(() => {
    // Build set of covered (provider, model) pairs from all alias targets
    const covered = new Set<string>();
    aliases.forEach((alias) => {
      alias.targets.forEach((t) => {
        covered.add(`${t.provider}|${t.model}`);
      });
    });

    // Find orphaned models and group by model.id
    const orphanMap = new Map<string, Array<{ provider: Provider; model: Model }>>();
    availableModels.forEach((model) => {
      const key = `${model.providerId}|${model.id}`;
      if (covered.has(key)) return;

      if (!orphanMap.has(model.id)) {
        orphanMap.set(model.id, []);
      }
      const provider = providers.find((p) => p.id === model.providerId);
      if (provider) {
        orphanMap.get(model.id)!.push({ provider, model });
      }
    });

    const groups: OrphanGroup[] = [];
    orphanMap.forEach((candidates, modelId) => {
      const existingAlias = aliases.find((a) => a.id === modelId);
      groups.push({ modelId, existingAlias, candidates });
    });
    groups.sort((a, b) => a.modelId.localeCompare(b.modelId));

    // Default: select all candidates
    const selections = new Map<string, Set<string>>();
    groups.forEach((group) => {
      selections.set(group.modelId, new Set(group.candidates.map((c) => c.provider.id)));
    });

    setOrphanGroups(groups);
    setSelectedImports(selections);
    setIsImportModalOpen(true);
  }, [aliases, availableModels, providers]);

  const handleSaveImports = useCallback(async () => {
    setIsImporting(true);
    try {
      for (const [modelId, providerIds] of selectedImports.entries()) {
        if (providerIds.size === 0) continue;

        const group = orphanGroups.find((g) => g.modelId === modelId);
        if (!group) continue;

        const selectedCandidates = group.candidates.filter((c) => providerIds.has(c.provider.id));

        if (group.existingAlias) {
          // Merge into existing alias
          const updatedAlias = JSON.parse(JSON.stringify(group.existingAlias));
          selectedCandidates.forEach((c) => {
            const alreadyExists = updatedAlias.targets.some(
              (t: { provider: string; model: string }) =>
                t.provider === c.provider.id && t.model === c.model.id
            );
            if (!alreadyExists) {
              updatedAlias.targets.push({
                provider: c.provider.id,
                model: c.model.id,
                enabled: true,
              });
            }
          });
          await api.saveAlias(updatedAlias, group.existingAlias.id);
        } else {
          // Create new alias
          const newAlias: Alias = {
            ...EMPTY_ALIAS,
            id: modelId,
            targets: selectedCandidates.map((c) => ({
              provider: c.provider.id,
              model: c.model.id,
              enabled: true,
            })),
          };
          await api.saveAlias(newAlias, undefined);
        }
      }

      await loadData();
      toast.success('Imports saved successfully');
      setIsImportModalOpen(false);
      setSelectedImports(new Map());
      setOrphanGroups([]);
      return true;
    } catch (e) {
      console.error('Failed to save imports', e);
      toast.error('Failed to save imports');
      return false;
    } finally {
      setIsImporting(false);
    }
  }, [selectedImports, orphanGroups, loadData, toast]);

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
    loadData,
    isImportModalOpen,
    setIsImportModalOpen,
    orphanGroups,
    setOrphanGroups,
    selectedImports,
    setSelectedImports,
    isImporting,
    handleOpenImport,
    handleSaveImports,
  };
};
