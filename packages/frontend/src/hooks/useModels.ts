import { useState, useEffect, useCallback } from 'react';
import { api, Alias, Provider, Model, Cooldown } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

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
  };
};
