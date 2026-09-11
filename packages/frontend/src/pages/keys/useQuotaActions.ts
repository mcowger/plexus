import { useState } from 'react';
import { api } from '../../lib/api';
import type { UserQuota } from '../../lib/api';
import type { Dispatch, SetStateAction } from 'react';
import { useToast } from '../../contexts/ToastContext';
import type { EditingQuota, LoadKeysData, QuotaStatusResponse } from './types';
import { EMPTY_QUOTA } from './types';

interface UseQuotaActionsOptions {
  defaultQuotaNames: string[];
  setDefaultQuotaNames: Dispatch<SetStateAction<string[]>>;
  loadData: LoadKeysData;
  quotaStatuses: Record<string, QuotaStatusResponse>;
}

export function useQuotaActions({
  defaultQuotaNames,
  setDefaultQuotaNames,
  loadData,
  quotaStatuses,
}: UseQuotaActionsOptions) {
  const toast = useToast();
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<EditingQuota>(EMPTY_QUOTA);
  const [originalQuotaName, setOriginalQuotaName] = useState<string | null>(null);
  const [isSavingQuota, setIsSavingQuota] = useState(false);
  const [isQuotaDetailOpen, setIsQuotaDetailOpen] = useState(false);
  const [selectedQuotaName, setSelectedQuotaName] = useState<string | null>(null);
  const [selectedQuotaStatus, setSelectedQuotaStatus] = useState<QuotaStatusResponse | null>(null);
  const [recomputingQuota, setRecomputingQuota] = useState<string | null>(null);

  const handleEditQuota = (name: string, quota: UserQuota) => {
    setOriginalQuotaName(name);
    setEditingQuota({ name, ...quota });
    setIsQuotaModalOpen(true);
  };

  const handleAddNewQuota = () => {
    setOriginalQuotaName(null);
    setEditingQuota({ ...EMPTY_QUOTA });
    setIsQuotaModalOpen(true);
  };

  const handleSaveQuota = async () => {
    if (!editingQuota.name) return;

    // Validate based on type
    if (editingQuota.type === 'rolling' && !editingQuota.duration) {
      toast.error('Rolling quotas require a duration');
      return;
    }
    if (
      editingQuota.warnAt !== undefined &&
      (editingQuota.warnAt <= 0 || editingQuota.warnAt >= 1)
    ) {
      toast.error('Warn threshold must be between 0% and 100% (exclusive)');
      return;
    }

    setIsSavingQuota(true);
    try {
      const { name, allowedProviders, excludedProviders, allowedModels, excludedModels, ...rest } =
        editingQuota;

      // Empty scope arrays are semantically "unscoped" — send undefined
      // instead of `[]` so the definition doesn't carry pointless empty
      // fields around.
      const quotaData: UserQuota = {
        ...rest,
        ...(allowedProviders && allowedProviders.length > 0 ? { allowedProviders } : {}),
        ...(excludedProviders && excludedProviders.length > 0 ? { excludedProviders } : {}),
        ...(allowedModels && allowedModels.length > 0 ? { allowedModels } : {}),
        ...(excludedModels && excludedModels.length > 0 ? { excludedModels } : {}),
      };

      // If name changed, delete old quota first
      if (originalQuotaName && originalQuotaName !== name) {
        await api.deleteUserQuota(originalQuotaName);
      }

      await api.saveUserQuota(name, quotaData);
      await loadData();
      setIsQuotaModalOpen(false);
    } catch (e: any) {
      console.error('Failed to save quota', e);
      toast.error(e.message || 'Failed to save quota');
    } finally {
      setIsSavingQuota(false);
    }
  };

  const handleDeleteQuota = async (name: string) => {
    const _okq = await toast.confirm({
      title: 'Delete quota?',
      message: `Are you sure you want to delete quota '${name}'? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!_okq) return;

    try {
      await api.deleteUserQuota(name);
      await loadData();
    } catch (e: any) {
      console.error('Failed to delete quota', e);
      toast.error(e.message || 'Failed to delete quota');
    }
  };

  const handleClearQuota = async (keyName: string, quotaName?: string) => {
    const _okr = await toast.confirm({
      title: 'Reset quota?',
      message: quotaName
        ? `Reset usage for quota '${quotaName}' on key '${keyName}'?`
        : `Reset usage for every quota attached to key '${keyName}'?`,
      confirmLabel: 'Reset',
    });
    if (!_okr) return;

    try {
      await api.clearQuota(keyName, quotaName);
      const statuses = await loadData();
      // Keep the detail modal open (if open) showing fresh numbers, reusing
      // the status loadData just fetched instead of a second round trip.
      if (selectedQuotaName === keyName && statuses?.[keyName]) {
        setSelectedQuotaStatus(statuses[keyName]);
      }
    } catch (e) {
      console.error('Failed to clear quota', e);
      toast.error(e instanceof Error ? e.message : 'Failed to clear quota');
    }
  };

  const handleRecomputeQuota = async (keyName: string, quotaName: string) => {
    setRecomputingQuota(quotaName);
    try {
      await api.recomputeQuota(keyName, quotaName);
      toast.success(`Quota '${quotaName}' recomputed`);
      const statuses = await loadData();
      if (selectedQuotaName === keyName && statuses?.[keyName]) {
        setSelectedQuotaStatus(statuses[keyName]);
      }
    } catch (e) {
      console.error('Failed to recompute quota', e);
      toast.error(e instanceof Error ? e.message : 'Failed to recompute quota');
    } finally {
      setRecomputingQuota(null);
    }
  };

  const handleSaveDefaultQuotas = async (names: string[]) => {
    setIsSavingDefaults(true);
    const previous = defaultQuotaNames;
    setDefaultQuotaNames(names);
    try {
      await api.setDefaultQuotas(names);
      await loadData();
    } catch (e) {
      console.error('Failed to save default quotas', e);
      toast.error(e instanceof Error ? e.message : 'Failed to save default quotas');
      setDefaultQuotaNames(previous);
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleViewQuotaStatus = (keyName: string) => {
    const status = quotaStatuses[keyName];
    if (status) {
      setSelectedQuotaName(keyName);
      setSelectedQuotaStatus(status);
      setIsQuotaDetailOpen(true);
    }
  };

  return {
    isSavingDefaults,
    isQuotaModalOpen,
    setIsQuotaModalOpen,
    editingQuota,
    setEditingQuota,
    originalQuotaName,
    isSavingQuota,
    isQuotaDetailOpen,
    setIsQuotaDetailOpen,
    selectedQuotaName,
    selectedQuotaStatus,
    recomputingQuota,
    handleEditQuota,
    handleAddNewQuota,
    handleSaveQuota,
    handleDeleteQuota,
    handleClearQuota,
    handleRecomputeQuota,
    handleSaveDefaultQuotas,
    handleViewQuotaStatus,
  };
}
