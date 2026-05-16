import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, KeyConfig, UserQuota } from '../lib/api';
import { Input } from '../components/ui/Input';
import { TagSelect } from '../components/ui/TagSelect';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useToast } from '../contexts/ToastContext';
import {
  Search,
  Plus,
  Trash2,
  Edit2,
  Copy,
  RefreshCw,
  Check,
  Shield,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { formatNumber, formatCost } from '../lib/format';
import { isClipboardAvailable, copyToClipboard, generateUUID } from '../lib/clipboard';

const EMPTY_KEY: KeyConfig = {
  key: '',
  secret: '',
  comment: '',
};

const EMPTY_QUOTA: UserQuota & { name: string } = {
  name: '',
  type: 'rolling',
  limitType: 'requests',
  limit: 1000,
  duration: '1h',
};

interface QuotaStatus {
  key: string;
  quota_name: string | null;
  allowed: boolean;
  current_usage: number;
  limit: number | null;
  remaining: number | null;
  resets_at: string | null;
}

export const Keys = () => {
  const toast = useToast();
  const { t } = useTranslation();
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [quotas, setQuotas] = useState<Record<string, UserQuota>>({});
  const [quotaStatuses, setQuotaStatuses] = useState<Record<string, QuotaStatus>>({});
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [aliasIds, setAliasIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'keys' | 'quotas'>('keys');

  // Key Modal State
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyConfig>(EMPTY_KEY);
  const [originalKeyName, setOriginalKeyName] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);

  // Quota Modal State
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<typeof EMPTY_QUOTA>(EMPTY_QUOTA);
  const [originalQuotaName, setOriginalQuotaName] = useState<string | null>(null);
  const [isSavingQuota, setIsSavingQuota] = useState(false);

  // Quota Detail Modal State
  const [isQuotaDetailOpen, setIsQuotaDetailOpen] = useState(false);
  const [selectedQuotaName, setSelectedQuotaName] = useState<string | null>(null);
  const [selectedQuotaStatus, setSelectedQuotaStatus] = useState<QuotaStatus | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [k, q, provs, aliases] = await Promise.all([
        api.getKeys(),
        api.getUserQuotas(),
        api.getProviders(),
        api.getAliases(),
      ]);
      setKeys(k);
      setQuotas(q);
      setProviderIds(
        provs
          .filter((p) => p.enabled)
          .map((p) => p.id)
          .sort()
      );
      setAliasIds(aliases.map((a) => a.id).sort());

      // Load quota status for all keys that have quotas
      const statuses: Record<string, QuotaStatus> = {};
      for (const key of k) {
        if (key.quota) {
          try {
            const status = await api.getQuotaStatus(key.key);
            if (status) {
              statuses[key.key] = status;
            }
          } catch (e) {
            console.error(`Failed to load quota status for ${key.key}`, e);
          }
        }
      }
      setQuotaStatuses(statuses);
    } catch (e) {
      console.error('Failed to load data', e);
    }
  };

  // Key Handlers
  const handleEditKey = (key: KeyConfig) => {
    setOriginalKeyName(key.key);
    setEditingKey({ ...key });
    setIsKeyModalOpen(true);
  };

  const handleAddNewKey = () => {
    setOriginalKeyName(null);
    setEditingKey({ ...EMPTY_KEY });
    setIsKeyModalOpen(true);
  };

  const handleSaveKey = async () => {
    if (!editingKey.key || !editingKey.secret) return;

    setIsSavingKey(true);
    try {
      await api.saveKey(editingKey, originalKeyName || undefined);
      await loadData();
      setIsKeyModalOpen(false);
    } catch (e) {
      console.error('Failed to save key', e);
      toast.error(t('keys.deleteKey.saveFailed'));
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDeleteKey = async (keyName: string) => {
    const _ok = await toast.confirm({
      title: t('keys.deleteKey.title'),
      message: t('keys.deleteKey.message', { name: keyName }),
      confirmLabel: t('keys.deleteKey.confirmLabel'),
      variant: 'danger',
    });
    if (!_ok) return;

    try {
      await api.deleteKey(keyName);
      await loadData();
    } catch (e) {
      console.error('Failed to delete key', e);
      toast.error(t('keys.deleteKey.deleteFailed'));
    }
  };

  // Quota Handlers
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
      toast.error(t('keys.deleteQuota.rollingNeedsDuration'));
      return;
    }

    setIsSavingQuota(true);
    try {
      const { name, ...quotaData } = editingQuota;

      // If name changed, delete old quota first
      if (originalQuotaName && originalQuotaName !== name) {
        await api.deleteUserQuota(originalQuotaName);
      }

      await api.saveUserQuota(name, quotaData);
      await loadData();
      setIsQuotaModalOpen(false);
    } catch (e: any) {
      console.error('Failed to save quota', e);
      toast.error(e.message || t('keys.deleteQuota.saveFailed'));
    } finally {
      setIsSavingQuota(false);
    }
  };

  const handleDeleteQuota = async (name: string) => {
    const _okq = await toast.confirm({
      title: t('keys.deleteQuota.title'),
      message: t('keys.deleteQuota.message', { name }),
      confirmLabel: t('keys.deleteQuota.confirmLabel'),
      variant: 'danger',
    });
    if (!_okq) return;

    try {
      await api.deleteUserQuota(name);
      await loadData();
    } catch (e: any) {
      console.error('Failed to delete quota', e);
      toast.error(e.message || t('keys.deleteQuota.deleteFailed'));
    }
  };

  const handleClearQuota = async (keyName: string) => {
    const _okr = await toast.confirm({
      title: t('keys.resetQuotaConfirm.title'),
      message: t('keys.resetQuotaConfirm.message', { name: keyName }),
      confirmLabel: t('keys.resetQuotaConfirm.confirmLabel'),
    });
    if (!_okr) return;

    try {
      await api.clearQuota(keyName);
      await loadData();
    } catch (e) {
      console.error('Failed to clear quota', e);
      toast.error(t('keys.resetQuotaConfirm.failed'));
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

  const filteredKeys = keys.filter(
    (k) =>
      k.key.toLowerCase().includes(search.toLowerCase()) ||
      (k.comment && k.comment.toLowerCase().includes(search.toLowerCase())) ||
      (k.quota && k.quota.toLowerCase().includes(search.toLowerCase())) ||
      k.allowedModels?.some((model) => model.toLowerCase().includes(search.toLowerCase())) ||
      k.allowedProviders?.some((provider) =>
        provider.toLowerCase().includes(search.toLowerCase())
      ) ||
      k.excludedModels?.some((model) => model.toLowerCase().includes(search.toLowerCase())) ||
      k.excludedProviders?.some((provider) => provider.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredQuotas = Object.entries(quotas).filter(([name]) =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  const getQuotaUsagePercent = (status: QuotaStatus) => {
    if (!status.limit || status.limit === 0) return 0;
    return Math.min(100, (status.current_usage / status.limit) * 100);
  };

  const getQuotaStatusColor = (percent: number) => {
    if (percent >= 90) return 'var(--color-danger)';
    if (percent >= 75) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={t('keys.title')}
        subtitle={t('keys.subtitle')}
        actions={
          activeTab === 'keys' ? (
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNewKey} size="sm">
              {t('keys.createKey')}
            </Button>
          ) : (
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNewQuota} size="sm">
              {t('keys.addQuota')}
            </Button>
          )
        }
      >
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'keys' | 'quotas')}
          items={[
            { value: 'keys', label: t('keys.tabKeys', { count: keys.length }) },
            { value: 'quotas', label: t('keys.tabQuotas', { count: Object.keys(quotas).length }) },
          ]}
        />
      </PageHeader>

      <PageContainer>
        {/* Hidden old tabs (to avoid further JSX restructuring) */}
        <div className="hidden">
          <div>
            <button
              className={`px-4 py-2 font-body text-sm font-medium transition-colors ${
                activeTab === 'keys'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setActiveTab('keys')}
            >
              {t('keys.tabKeys', { count: keys.length })}
            </button>
            <button
              className={`px-4 py-2 font-body text-sm font-medium transition-colors ${
                activeTab === 'quotas'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setActiveTab('quotas')}
            >
              {t('keys.tabQuotas', { count: Object.keys(quotas).length })}
            </button>
          </div>
        </div>

        {/* Search */}
        <Card className="mb-6">
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-secondary)',
              }}
            />
            <Input
              placeholder={
                activeTab === 'keys'
                  ? t('keys.searchKeysPlaceholder')
                  : t('keys.searchQuotasPlaceholder')
              }
              style={{ paddingLeft: '36px' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </Card>

        {/* Keys Tab */}
        {activeTab === 'keys' && (
          <Card title={t('keys.keysSection.title')} className="mb-6">
            <div className="space-y-3 md:hidden">
              {filteredKeys.length === 0 ? (
                <div className="py-10 text-center text-sm text-text-muted">
                  {t('keys.keysSection.empty')}
                </div>
              ) : (
                filteredKeys.map((key) => {
                  const status = quotaStatuses[key.key];
                  const usagePercent = status ? getQuotaUsagePercent(status) : 0;

                  return (
                    <article
                      key={key.key}
                      className="rounded-md border border-border-glass bg-bg-subtle p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => handleEditKey(key)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate font-heading text-sm font-semibold text-text">
                            {key.key}
                          </div>
                          {key.comment && (
                            <div className="mt-1 truncate text-xs text-text-muted">
                              {key.comment}
                            </div>
                          )}
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditKey(key)}
                            aria-label={t('keys.keysSection.ariaEdit', { name: key.key })}
                          >
                            <Edit2 size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteKey(key.key)}
                            className="text-danger"
                            aria-label={t('keys.keysSection.ariaDelete', { name: key.key })}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-text-muted">
                            {t('keys.keysSection.secret')}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="min-w-0 truncate font-mono text-text">
                              {key.secret.substring(0, 5)}...
                            </span>
                            <button
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-hover hover:text-primary"
                              onClick={() => handleCopy(key.secret, key.key)}
                              title={t('keys.keysSection.copySecret')}
                              type="button"
                            >
                              {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-text-muted">
                            {t('keys.keysSection.quota')}
                          </div>
                          <div className="mt-1 truncate font-medium text-text-secondary">
                            {key.quota || '-'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded border border-border-glass bg-bg-glass px-2 py-2">
                        {status ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-text-muted">{t('keys.keysSection.usage')}</span>
                              <span className="font-medium text-text">
                                {quotas[key.quota || '']?.limitType === 'cost'
                                  ? `${formatCost(status.current_usage, 5)} / ${formatCost(status.limit || 0, 5)}`
                                  : `${formatNumber(status.current_usage)} / ${formatNumber(status.limit || 0)}`}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${usagePercent}%`,
                                  backgroundColor: getQuotaStatusColor(usagePercent),
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewQuotaStatus(key.key)}
                                leftIcon={<BarChart3 size={14} />}
                              >
                                {t('keys.keysSection.details')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearQuota(key.key)}
                                leftIcon={<RefreshCw size={14} />}
                              >
                                {t('keys.keysSection.reset')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-text-muted">
                            {key.quota
                              ? t('keys.keysSection.loadingQuotaStatus')
                              : t('keys.keysSection.noQuotaAssigned')}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                  <tr>
                    <th
                      className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                      style={{ paddingLeft: '24px' }}
                    >
                      {t('keys.keysSection.table.keyName')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.keysSection.table.secret')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.keysSection.table.quota')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.keysSection.table.status')}
                    </th>
                    <th
                      className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                      style={{ paddingRight: '24px', textAlign: 'right' }}
                    >
                      {t('keys.keysSection.table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeys.map((key) => {
                    const status = quotaStatuses[key.key];
                    const usagePercent = status ? getQuotaUsagePercent(status) : 0;

                    return (
                      <tr key={key.key} className="hover:bg-bg-hover">
                        <td
                          className="px-4 py-3 text-left border-b border-border-glass text-text"
                          style={{ fontWeight: 600, paddingLeft: '24px' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {key.key}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                backgroundColor: 'var(--color-bg-subtle)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {key.secret.substring(0, 5)}...
                            </span>
                            <button
                              className="bg-transparent border-0 text-text-muted p-1.5 rounded-sm cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-bg-hover hover:text-primary active:scale-95"
                              onClick={() => handleCopy(key.secret, key.key)}
                              title={t('keys.keysSection.copySecretTitle')}
                              style={copiedKey === key.key ? { color: 'var(--color-success)' } : {}}
                            >
                              {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          {key.quota ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary">
                              <Shield size={12} />
                              {key.quota}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                              -
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          {status ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div
                                style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  backgroundColor: getQuotaStatusColor(usagePercent),
                                }}
                              />
                              <span style={{ fontSize: '12px' }}>
                                {quotas[key.quota || '']?.limitType === 'cost'
                                  ? `${formatCost(status.current_usage, 5)} / ${formatCost(status.limit || 0, 5)}`
                                  : `${formatNumber(status.current_usage)} / ${formatNumber(status.limit || 0)}`}
                              </span>
                              <button
                                className="bg-transparent border-0 text-text-muted p-1 rounded-sm cursor-pointer hover:text-primary"
                                onClick={() => handleViewQuotaStatus(key.key)}
                                title={t('keys.keysSection.viewDetails')}
                              >
                                <BarChart3 size={14} />
                              </button>
                            </div>
                          ) : key.quota ? (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                              {t('keys.keysSection.loading')}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                              -
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 text-left border-b border-border-glass text-text"
                          style={{ paddingRight: '24px', textAlign: 'right' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <Button variant="ghost" size="sm" onClick={() => handleEditKey(key)}>
                              <Edit2 size={14} />
                            </Button>
                            {key.quota && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearQuota(key.key)}
                                title={t('keys.keysSection.resetQuota')}
                              >
                                <RefreshCw size={14} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteKey(key.key)}
                              style={{ color: 'var(--color-danger)' }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredKeys.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-text-muted p-12">
                        {t('keys.keysSection.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Quotas Tab */}
        {activeTab === 'quotas' && (
          <Card title={t('keys.quotasSection.title')} className="mb-6">
            <div className="space-y-3 md:hidden">
              {filteredQuotas.length === 0 ? (
                <div className="py-10 text-center text-sm text-text-muted">
                  {Object.keys(quotas).length === 0
                    ? t('keys.quotasSection.emptyDefined')
                    : t('keys.quotasSection.emptySearch')}
                </div>
              ) : (
                filteredQuotas.map(([name, quota]) => {
                  const keysUsingQuota = keys.filter((k) => k.quota === name).length;

                  return (
                    <article
                      key={name}
                      className="rounded-md border border-border-glass bg-bg-subtle p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-heading text-sm font-semibold text-text">
                            {name}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {quota.type}
                            {quota.type === 'rolling' && quota.duration
                              ? ` (${quota.duration})`
                              : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditQuota(name, quota)}
                            aria-label={t('keys.quotasSection.ariaEdit', { name })}
                          >
                            <Edit2 size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteQuota(name)}
                            className="text-danger"
                            aria-label={t('keys.quotasSection.ariaDelete', { name })}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-text-muted">
                            {t('keys.quotasSection.limit')}
                          </div>
                          <div className="truncate font-mono text-text">
                            {quota.limitType === 'cost'
                              ? `${formatCost(quota.limit, 5)} ${quota.limitType}`
                              : `${formatNumber(quota.limit)} ${quota.limitType}`}
                          </div>
                        </div>
                        <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-text-muted">
                            {t('keys.quotasSection.keys')}
                          </div>
                          <div className="truncate font-medium text-text-secondary">
                            {t('keys.quotasSection.keysCount', { count: keysUsingQuota })}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                  <tr>
                    <th
                      className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                      style={{ paddingLeft: '24px' }}
                    >
                      {t('keys.quotasSection.table.name')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.quotasSection.table.type')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.quotasSection.table.limit')}
                    </th>
                    <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                      {t('keys.quotasSection.table.keysUsing')}
                    </th>
                    <th
                      className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                      style={{ paddingRight: '24px', textAlign: 'right' }}
                    >
                      {t('keys.quotasSection.table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotas.map(([name, quota]) => {
                    const keysUsingQuota = keys.filter((k) => k.quota === name).length;

                    return (
                      <tr key={name} className="hover:bg-bg-hover">
                        <td
                          className="px-4 py-3 text-left border-b border-border-glass text-text"
                          style={{ fontWeight: 600, paddingLeft: '24px' }}
                        >
                          {name}
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-bg-subtle text-text-secondary">
                            {quota.type}
                            {quota.type === 'rolling' && quota.duration && (
                              <span className="text-text-muted">({quota.duration})</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          <span className="font-mono text-xs">
                            {quota.limitType === 'cost'
                              ? `${formatCost(quota.limit, 5)} ${quota.limitType}`
                              : `${formatNumber(quota.limit)} ${quota.limitType}`}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md ${
                              keysUsingQuota > 0
                                ? 'bg-primary/10 text-primary'
                                : 'bg-bg-subtle text-text-muted'
                            }`}
                          >
                            {t('keys.quotasSection.keysCount', { count: keysUsingQuota })}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 text-left border-b border-border-glass text-text"
                          style={{ paddingRight: '24px', textAlign: 'right' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditQuota(name, quota)}
                            >
                              <Edit2 size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteQuota(name)}
                              style={{ color: 'var(--color-danger)' }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredQuotas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-text-muted p-12">
                        {Object.keys(quotas).length === 0
                          ? t('keys.quotasSection.emptyDefined')
                          : t('keys.quotasSection.emptySearch')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Key Modal */}
        <Modal
          isOpen={isKeyModalOpen}
          onClose={() => setIsKeyModalOpen(false)}
          title={originalKeyName ? t('keys.keyModal.titleEdit') : t('keys.keyModal.titleAdd')}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsKeyModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSaveKey}
                isLoading={isSavingKey}
                disabled={!editingKey.key || !editingKey.secret}
              >
                {t('keys.keyModal.save')}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex flex-col gap-2">
              <Input
                label={t('keys.keyModal.keyNameLabel')}
                value={editingKey.key}
                onChange={(e) => setEditingKey({ ...editingKey, key: e.target.value })}
                placeholder={t('keys.keyModal.keyNamePlaceholder')}
                disabled={!!originalKeyName}
              />
              <p className="text-xs text-text-muted">
                {originalKeyName
                  ? t('keys.keyModal.keyNameHelpLocked')
                  : t('keys.keyModal.keyNameHelpNew')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                {t('keys.keyModal.secretLabel')}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <Input
                    value={editingKey.secret}
                    onChange={(e) => setEditingKey({ ...editingKey, secret: e.target.value })}
                    placeholder={t('keys.keyModal.secretPlaceholder')}
                    type="password"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={generateKey}
                  title={t('keys.keyModal.generateTitle')}
                  className="w-full sm:w-auto"
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <p className="text-xs text-text-muted mt-1">{t('keys.keyModal.secretHelp')}</p>
            </div>

            <Input
              label={t('keys.keyModal.commentLabel')}
              value={editingKey.comment || ''}
              onChange={(e) => setEditingKey({ ...editingKey, comment: e.target.value })}
              placeholder={t('keys.keyModal.commentPlaceholder')}
            />

            <TagSelect
              label={t('keys.keyModal.excludedModelsLabel')}
              placeholder={t('keys.keyModal.excludedModelsPlaceholder')}
              options={aliasIds}
              selected={editingKey.excludedModels || []}
              onChange={(excludedModels) =>
                setEditingKey({
                  ...editingKey,
                  excludedModels: excludedModels.length > 0 ? excludedModels : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">{t('keys.keyModal.excludedModelsHelp')}</p>

            <TagSelect
              label={t('keys.keyModal.allowedModelsLabel')}
              placeholder={t('keys.keyModal.allowedModelsPlaceholder')}
              options={aliasIds}
              selected={editingKey.allowedModels || []}
              onChange={(allowedModels) =>
                setEditingKey({
                  ...editingKey,
                  allowedModels: allowedModels.length > 0 ? allowedModels : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">{t('keys.keyModal.allowedModelsHelp')}</p>

            <TagSelect
              label={t('keys.keyModal.excludedProvidersLabel')}
              placeholder={t('keys.keyModal.excludedProvidersPlaceholder')}
              options={providerIds}
              selected={editingKey.excludedProviders || []}
              onChange={(excludedProviders) =>
                setEditingKey({
                  ...editingKey,
                  excludedProviders: excludedProviders.length > 0 ? excludedProviders : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              {t('keys.keyModal.excludedProvidersHelp')}
            </p>

            <TagSelect
              label={t('keys.keyModal.allowedProvidersLabel')}
              placeholder={t('keys.keyModal.allowedProvidersPlaceholder')}
              options={providerIds}
              selected={editingKey.allowedProviders || []}
              onChange={(allowedProviders) =>
                setEditingKey({
                  ...editingKey,
                  allowedProviders: allowedProviders.length > 0 ? allowedProviders : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              {t('keys.keyModal.allowedProvidersHelp')}
            </p>

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                {t('keys.keyModal.quotaAssignmentLabel')}
              </label>
              <select
                className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                value={editingKey.quota || ''}
                onChange={(e) =>
                  setEditingKey({ ...editingKey, quota: e.target.value || undefined })
                }
              >
                <option value="">{t('keys.keyModal.quotaNoneOption')}</option>
                {Object.entries(quotas).map(([name, quota]) => (
                  <option key={name} value={name}>
                    {name} ({quota.type},{' '}
                    {quota.limitType === 'cost'
                      ? `${formatCost(quota.limit, 5)} ${quota.limitType}`
                      : `${quota.limit} ${quota.limitType}`}
                    )
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">{t('keys.keyModal.quotaAssignmentHelp')}</p>
            </div>
          </div>
        </Modal>

        {/* Quota Modal */}
        <Modal
          isOpen={isQuotaModalOpen}
          onClose={() => setIsQuotaModalOpen(false)}
          title={originalQuotaName ? t('keys.quotaModal.titleEdit') : t('keys.quotaModal.titleAdd')}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsQuotaModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSaveQuota}
                isLoading={isSavingQuota}
                disabled={!editingQuota.name}
              >
                {t('keys.quotaModal.save')}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex flex-col gap-2">
              <Input
                label={t('keys.quotaModal.nameLabel')}
                value={editingQuota.name}
                onChange={(e) => setEditingQuota({ ...editingQuota, name: e.target.value })}
                placeholder={t('keys.quotaModal.namePlaceholder')}
                disabled={!!originalQuotaName}
              />
              <p className="text-xs text-text-muted">
                {originalQuotaName
                  ? t('keys.quotaModal.nameHelpLocked')
                  : t('keys.quotaModal.nameHelpNew')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                {t('keys.quotaModal.typeLabel')}
              </label>
              <select
                className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                value={editingQuota.type}
                onChange={(e) =>
                  setEditingQuota({ ...editingQuota, type: e.target.value as UserQuota['type'] })
                }
              >
                <option value="rolling">{t('keys.quotaModal.typeOptions.rolling')}</option>
                <option value="daily">{t('keys.quotaModal.typeOptions.daily')}</option>
                <option value="weekly">{t('keys.quotaModal.typeOptions.weekly')}</option>
                <option value="monthly">{t('keys.quotaModal.typeOptions.monthly')}</option>
              </select>
              <p className="text-xs text-text-muted">
                {t(`keys.quotaModal.typeDescription.${editingQuota.type}`)}
              </p>
            </div>

            {editingQuota.type === 'rolling' && (
              <div className="flex flex-col gap-2">
                <Input
                  label={t('keys.quotaModal.durationLabel')}
                  value={editingQuota.duration || ''}
                  onChange={(e) => setEditingQuota({ ...editingQuota, duration: e.target.value })}
                  placeholder={t('keys.quotaModal.durationPlaceholder')}
                />
                <p className="text-xs text-text-muted">{t('keys.quotaModal.durationHelp')}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                {t('keys.quotaModal.limitTypeLabel')}
              </label>
              <select
                className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                value={editingQuota.limitType}
                onChange={(e) =>
                  setEditingQuota({
                    ...editingQuota,
                    limitType: e.target.value as UserQuota['limitType'],
                  })
                }
              >
                <option value="requests">{t('keys.quotaModal.limitTypeOptions.requests')}</option>
                <option value="tokens">{t('keys.quotaModal.limitTypeOptions.tokens')}</option>
                <option value="cost">{t('keys.quotaModal.limitTypeOptions.cost')}</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Input
                label={t('keys.quotaModal.limitLabel')}
                type="number"
                value={editingQuota.limit}
                onChange={(e) =>
                  setEditingQuota({ ...editingQuota, limit: parseInt(e.target.value) || 0 })
                }
                placeholder={t('keys.quotaModal.limitPlaceholder')}
              />
              <p className="text-xs text-text-muted">
                {t('keys.quotaModal.maxAllowed', {
                  type: t(`keys.quotaModal.maxAllowedType.${editingQuota.limitType}`),
                })}
              </p>
            </div>
          </div>
        </Modal>

        {/* Quota Detail Modal */}
        <Modal
          isOpen={isQuotaDetailOpen}
          onClose={() => setIsQuotaDetailOpen(false)}
          title={t('keys.quotaDetailModal.title', { name: selectedQuotaName ?? '' })}
          size="sm"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsQuotaDetailOpen(false)}>
                {t('common.close')}
              </Button>
              {selectedQuotaStatus && (
                <Button
                  onClick={() => {
                    handleClearQuota(selectedQuotaStatus.key);
                    setIsQuotaDetailOpen(false);
                  }}
                  variant="secondary"
                >
                  {t('keys.quotaDetailModal.resetUsage')}
                </Button>
              )}
            </div>
          }
        >
          {selectedQuotaStatus && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="flex items-center gap-3 p-3 bg-bg-subtle rounded-md">
                {selectedQuotaStatus.allowed ? (
                  <Check className="text-success" size={24} />
                ) : (
                  <AlertCircle className="text-danger" size={24} />
                )}
                <div>
                  <p className="font-medium text-text">
                    {selectedQuotaStatus.allowed
                      ? t('keys.quotaDetailModal.active')
                      : t('keys.quotaDetailModal.exhausted')}
                  </p>
                  <p className="text-sm text-text-secondary">{selectedQuotaStatus.quota_name}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-text-secondary">{t('keys.quotaDetailModal.usage')}</span>
                    <span className="font-medium text-text">
                      {quotas[selectedQuotaStatus.quota_name || '']?.limitType === 'cost'
                        ? `${formatCost(selectedQuotaStatus.current_usage, 5)} / ${formatCost(selectedQuotaStatus.limit || 0, 5)}`
                        : `${formatNumber(selectedQuotaStatus.current_usage)} / ${formatNumber(selectedQuotaStatus.limit || 0)}`}
                    </span>
                  </div>
                  <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, getQuotaUsagePercent(selectedQuotaStatus))}%`,
                        backgroundColor: getQuotaStatusColor(
                          getQuotaUsagePercent(selectedQuotaStatus)
                        ),
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="p-3 bg-bg-subtle rounded-md">
                    <p className="text-xs text-text-secondary mb-1">
                      {t('keys.quotaDetailModal.remaining')}
                    </p>
                    <p className="font-mono text-lg text-text">
                      {selectedQuotaStatus.remaining !== null
                        ? quotas[selectedQuotaStatus.quota_name || '']?.limitType === 'cost'
                          ? formatCost(selectedQuotaStatus.remaining, 5)
                          : formatNumber(selectedQuotaStatus.remaining)
                        : '-'}
                    </p>
                  </div>
                  <div className="p-3 bg-bg-subtle rounded-md">
                    <p className="text-xs text-text-secondary mb-1">
                      {t('keys.quotaDetailModal.resetsAt')}
                    </p>
                    <p className="font-mono text-sm text-text">
                      {selectedQuotaStatus.resets_at
                        ? new Date(selectedQuotaStatus.resets_at).toLocaleString()
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Modal>
      </PageContainer>
    </div>
  );
};
