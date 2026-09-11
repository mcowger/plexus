import { useState } from 'react';
import { api } from '../../lib/api';
import type { KeyConfig } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { copyToClipboard, generateUUID, isClipboardAvailable } from '../../lib/clipboard';
import type { ExpiryUnit, LoadKeysData } from './types';
import { EMPTY_KEY } from './types';

interface UseKeyActionsOptions {
  loadData: LoadKeysData;
}

export function useKeyActions({ loadData }: UseKeyActionsOptions) {
  const toast = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyConfig>(EMPTY_KEY);
  const [originalKeyName, setOriginalKeyName] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [expiryAmount, setExpiryAmount] = useState('');
  const [expiryUnit, setExpiryUnit] = useState<ExpiryUnit>('days');

  const handleEditKey = (key: KeyConfig) => {
    setOriginalKeyName(key.key);
    setEditingKey({ ...key });
    setExpiryAmount('');
    setIsKeyModalOpen(true);
  };

  const handleAddNewKey = () => {
    setOriginalKeyName(null);
    // New keys default to an open allowlist. 0.0.0.0/0 covers all IPv4 and ::/0
    // all IPv6, so both are needed for "allow all". Existing keys are loaded
    // as-stored, so an empty allowlist stays empty.
    setEditingKey({ ...EMPTY_KEY, allowedIps: ['0.0.0.0/0', '::/0'] });
    setExpiryAmount('');
    setExpiryUnit('days');
    setIsKeyModalOpen(true);
  };

  const handleSaveKey = async () => {
    if (!editingKey.key || !editingKey.secret) return;

    const amount = Number(expiryAmount);
    if (!originalKeyName && expiryAmount && (!Number.isInteger(amount) || amount <= 0)) {
      toast.error('Expiry must be a positive whole number');
      return;
    }
    const minutesPerUnit = { minutes: 1, hours: 60, days: 1_440 };
    const keyToSave =
      !originalKeyName && expiryAmount
        ? { ...editingKey, expiresInMinutes: amount * minutesPerUnit[expiryUnit] }
        : editingKey;
    setIsSavingKey(true);
    try {
      await api.saveKey(keyToSave, originalKeyName || undefined);
      await loadData();
      setIsKeyModalOpen(false);
    } catch (e) {
      console.error('Failed to save key', e);
      toast.error(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDisableKey = async (key: KeyConfig) => {
    const confirmed = await toast.confirm({
      title: 'Disable key?',
      message: `Disable '${key.key}' immediately? This cannot be undone.`,
      confirmLabel: 'Disable',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.disableKey(key.key);
      await loadData();
      toast.success(`Key '${key.key}' disabled`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to disable key');
    }
  };

  const handleDeleteKey = async (keyName: string) => {
    const _ok = await toast.confirm({
      title: 'Delete key?',
      message: `Are you sure you want to delete key '${keyName}'? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!_ok) return;

    try {
      await api.deleteKey(keyName);
      await loadData();
    } catch (e) {
      console.error('Failed to delete key', e);
      toast.error('Failed to delete key');
    }
  };

  const generateKey = () => {
    const uuid = generateUUID();
    setEditingKey({ ...editingKey, secret: `sk-${uuid}` });
  };

  const handleCopy = async (text: string, keyId: string) => {
    if (!isClipboardAvailable()) return;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedKey(keyId);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  return {
    copiedKey,
    isKeyModalOpen,
    setIsKeyModalOpen,
    editingKey,
    setEditingKey,
    originalKeyName,
    isSavingKey,
    expiryAmount,
    setExpiryAmount,
    expiryUnit,
    setExpiryUnit,
    handleEditKey,
    handleAddNewKey,
    handleSaveKey,
    handleDisableKey,
    handleDeleteKey,
    generateKey,
    handleCopy,
  };
}
