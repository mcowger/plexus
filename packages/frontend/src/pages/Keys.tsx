import { useEffect, useState } from 'react';
import { api, KeyConfig, UserQuota, Provider } from '../lib/api';
import { Input } from '../components/ui/Input';
import { TagSelect } from '../components/ui/TagSelect';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Tabs } from '../components/ui/Tabs';
import { Switch } from '../components/ui/Switch';
import { QuotaStatusCard, QuotaChip, hasScope } from '../components/quota';
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
  Users,
  ChevronDown,
  Ban,
} from 'lucide-react';
import { formatNumber, formatCost } from '../lib/format';
import { isClipboardAvailable, copyToClipboard, generateUUID } from '../lib/clipboard';
import {
  formatQuotaValue,
  sortMostConstrainedFirst,
  mostConstrained,
  quotaUsagePercent,
} from '../lib/quota';

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
  allowedProviders: [],
  excludedProviders: [],
  allowedModels: [],
  excludedModels: [],
  shared: false,
  warnAt: undefined,
};

// Response shape of `GET /v0/management/quota/status/:key` — kept in sync
// with `lib/api.ts`'s `getQuotaStatus` return type rather than duplicated by
// hand.
type QuotaStatusResponse = NonNullable<Awaited<ReturnType<typeof api.getQuotaStatus>>>;

/** A rolling requests/tokens def is inherently leaky (usage isn't stored
 * per-request in a recomputable way) — recompute is refused backend-side
 * for these. Mirrors `QuotaEnforcer.recomputeQuota`'s guard. */
function isLeakyRollingDef(def: UserQuota | undefined): boolean {
  if (!def) return false;
  return def.type === 'rolling' && (def.limitType === 'requests' || def.limitType === 'tokens');
}

export const Keys = () => {
  const toast = useToast();
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [quotas, setQuotas] = useState<Record<string, UserQuota>>({});
  const [quotaStatuses, setQuotaStatuses] = useState<Record<string, QuotaStatusResponse>>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [aliasIds, setAliasIds] = useState<string[]>([]);
  const [defaultQuotaNames, setDefaultQuotaNames] = useState<string[]>([]);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'keys' | 'quotas'>('keys');

  // Key Modal State
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyConfig>(EMPTY_KEY);
  const [originalKeyName, setOriginalKeyName] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [expiryAmount, setExpiryAmount] = useState('');
  const [expiryUnit, setExpiryUnit] = useState<'minutes' | 'hours' | 'days'>('days');
  const [showDisabledKeys, setShowDisabledKeys] = useState(false);

  // Quota Modal State
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<typeof EMPTY_QUOTA>(EMPTY_QUOTA);
  const [originalQuotaName, setOriginalQuotaName] = useState<string | null>(null);
  const [isSavingQuota, setIsSavingQuota] = useState(false);

  // Quota Detail Modal State
  const [isQuotaDetailOpen, setIsQuotaDetailOpen] = useState(false);
  const [selectedQuotaName, setSelectedQuotaName] = useState<string | null>(null);
  const [selectedQuotaStatus, setSelectedQuotaStatus] = useState<QuotaStatusResponse | null>(null);
  const [recomputingQuota, setRecomputingQuota] = useState<string | null>(null);

  // Union of every model name exposed by any provider — used as the options
  // list for quota scope TagSelects (allowCustom covers models not yet
  // synced into a provider's catalog).
  const allModelNames = Array.from(
    new Set(
      providers.flatMap((p) => (p.models && !Array.isArray(p.models) ? Object.keys(p.models) : []))
    )
  ).sort();

  useEffect(() => {
    loadData();
  }, []);

  // Returns the refreshed per-key status map so callers (e.g. the reset /
  // recompute handlers) can reuse it for the detail modal without issuing a
  // second `getQuotaStatus` fetch for the same key.
  const loadData = async (): Promise<Record<string, QuotaStatusResponse> | null> => {
    try {
      const [k, q, provs, aliases, defaults] = await Promise.all([
        api.getKeys(),
        api.getUserQuotas(),
        api.getProviders(),
        api.getAliases(),
        api.getDefaultQuotas().catch(() => []),
      ]);
      setKeys(k);
      setQuotas(q);
      setProviders(provs);
      setProviderIds(
        provs
          .filter((p) => p.enabled)
          .map((p) => p.id)
          .sort()
      );
      setAliasIds(aliases.map((a) => a.id).sort());
      setDefaultQuotaNames(defaults);

      // Load quota status only for keys that can actually resolve quota
      // entries: keys with assigned `quotas`, or — when `default_quotas` is
      // set — every key (bare keys inherit the defaults). A bare key with no
      // defaults configured can never have entries (the backend returns an
      // empty context immediately), so skip the fetch for those.
      const statuses: Record<string, QuotaStatusResponse> = {};
      await Promise.all(
        k
          .filter((key) => (key.quotas?.length ?? 0) > 0 || defaults.length > 0)
          .map(async (key) => {
            try {
              const status = await api.getQuotaStatus(key.key);
              if (status) {
                statuses[key.key] = status;
              }
            } catch (e) {
              console.error(`Failed to load quota status for ${key.key}`, e);
            }
          })
      );
      setQuotaStatuses(statuses);
      return statuses;
    } catch (e) {
      console.error('Failed to load data', e);
      return null;
    }
  };

  // Key Handlers
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
      k.quotas?.some((name) => name.toLowerCase().includes(search.toLowerCase())) ||
      k.allowedModels?.some((model) => model.toLowerCase().includes(search.toLowerCase())) ||
      k.allowedProviders?.some((provider) =>
        provider.toLowerCase().includes(search.toLowerCase())
      ) ||
      k.excludedModels?.some((model) => model.toLowerCase().includes(search.toLowerCase())) ||
      k.excludedProviders?.some((provider) => provider.toLowerCase().includes(search.toLowerCase()))
  );
  const isDisabled = (key: KeyConfig) =>
    key.disabledAt !== undefined || (key.expiresAt !== undefined && key.expiresAt <= Date.now());
  const activeKeys = filteredKeys.filter((key) => !isDisabled(key));
  const disabledKeys = filteredKeys.filter(isDisabled);
  const formatExpiry = (timestamp: number) => new Date(timestamp).toLocaleString();

  const filteredQuotas = Object.entries(quotas).filter(([name]) =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  const getQuotaStatusColor = (percent: number) => {
    if (percent >= 90) return 'var(--color-danger)';
    if (percent >= 75) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Access Control"
        subtitle="API keys issued for downstream consumers"
        actions={
          activeTab === 'keys' ? (
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNewKey} size="sm">
              Create key
            </Button>
          ) : (
            <Button leftIcon={<Plus size={14} />} onClick={handleAddNewQuota} size="sm">
              Add quota
            </Button>
          )
        }
      >
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'keys' | 'quotas')}
          items={[
            { value: 'keys', label: `API Keys (${keys.filter((key) => !isDisabled(key)).length})` },
            { value: 'quotas', label: `Quotas (${Object.keys(quotas).length})` },
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
              API Keys ({keys.filter((key) => !isDisabled(key)).length})
            </button>
            <button
              className={`px-4 py-2 font-body text-sm font-medium transition-colors ${
                activeTab === 'quotas'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setActiveTab('quotas')}
            >
              Quotas ({Object.keys(quotas).length})
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
              placeholder={activeTab === 'keys' ? 'Search keys...' : 'Search quotas...'}
              style={{ paddingLeft: '36px' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </Card>

        {/* Keys Tab */}
        {activeTab === 'keys' && (
          <>
            <Card title="Active Keys" className="mb-6">
              <div className="space-y-3 md:hidden">
                {activeKeys.length === 0 ? (
                  <div className="py-10 text-center text-sm text-text-muted">No keys found</div>
                ) : (
                  activeKeys.map((key) => {
                    const status = quotaStatuses[key.key];
                    const primary = status ? mostConstrained(status.quotas) : null;
                    const usagePercent = primary ? quotaUsagePercent(primary) : 0;
                    const quotaNames = key.quotas && key.quotas.length > 0 ? key.quotas : null;
                    const usingDefaults = !quotaNames && defaultQuotaNames.length > 0;

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
                            <div className="flex items-center gap-2">
                              <div className="truncate font-heading text-sm font-semibold text-text">
                                {key.key}
                              </div>
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
                              aria-label={`Edit ${key.key}`}
                            >
                              <Edit2 size={14} />
                            </Button>
                            {key.expiresAt && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDisableKey(key)}
                                className="text-danger"
                                aria-label={`Disable ${key.key}`}
                                title="Disable key"
                              >
                                <Ban size={14} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteKey(key.key)}
                              className="text-danger"
                              aria-label={`Delete ${key.key}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">
                              Secret
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="min-w-0 truncate font-mono text-text">
                                {key.secret.substring(0, 5)}...
                              </span>
                              <button
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-hover hover:text-primary"
                                onClick={() => handleCopy(key.secret, key.key)}
                                title="Copy secret"
                                type="button"
                              >
                                {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </div>
                          </div>
                          <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">
                              Quota
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {quotaNames ? (
                                quotaNames.map((n) => <QuotaChip key={n}>{n}</QuotaChip>)
                              ) : usingDefaults ? (
                                <>
                                  {defaultQuotaNames.map((n) => (
                                    <QuotaChip key={n} tone="muted">
                                      {n}
                                    </QuotaChip>
                                  ))}
                                  <QuotaChip tone="muted">default</QuotaChip>
                                </>
                              ) : (
                                <span className="text-text-secondary">-</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 rounded border border-border-glass bg-bg-glass px-2 py-2">
                          {primary ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-text-muted truncate">{primary.name}</span>
                                <span className="font-medium text-text">
                                  {formatQuotaValue(primary.currentUsage, primary.limitType)} /{' '}
                                  {formatQuotaValue(primary.limit, primary.limitType)}
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
                              {status && status.quotas.length > 1 && (
                                <p className="text-[11px] text-text-muted">
                                  +{status.quotas.length - 1} more quota
                                  {status.quotas.length - 1 !== 1 ? 's' : ''}
                                </p>
                              )}
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewQuotaStatus(key.key)}
                                  leftIcon={<BarChart3 size={14} />}
                                >
                                  Details
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleClearQuota(key.key)}
                                  leftIcon={<RefreshCw size={14} />}
                                >
                                  Reset
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-text-muted">
                              {quotaNames || usingDefaults
                                ? 'Loading quota status...'
                                : 'No quota assigned'}
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
                        Key Name
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Secret
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Quota
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Status
                      </th>
                      <th
                        className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                        style={{ paddingRight: '24px', textAlign: 'right' }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeKeys.map((key) => {
                      const status = quotaStatuses[key.key];
                      const primary = status ? mostConstrained(status.quotas) : null;
                      const usagePercent = primary ? quotaUsagePercent(primary) : 0;
                      const quotaNames = key.quotas && key.quotas.length > 0 ? key.quotas : null;
                      const usingDefaults = !quotaNames && defaultQuotaNames.length > 0;

                      return (
                        <tr key={key.key} className="hover:bg-bg-hover">
                          <td
                            className="px-4 py-3 text-left border-b border-border-glass text-text"
                            style={{ fontWeight: 600, paddingLeft: '24px' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>{key.key}</span>
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
                                title="Copy Secret"
                                style={
                                  copiedKey === key.key ? { color: 'var(--color-success)' } : {}
                                }
                              >
                                {copiedKey === key.key ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                            {quotaNames ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {quotaNames.map((n) => (
                                  <span
                                    key={n}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary"
                                  >
                                    <Shield size={12} />
                                    {n}
                                  </span>
                                ))}
                              </div>
                            ) : usingDefaults ? (
                              <div className="flex flex-wrap items-center gap-1">
                                {defaultQuotaNames.map((n) => (
                                  <QuotaChip key={n} tone="muted">
                                    {n}
                                  </QuotaChip>
                                ))}
                                <QuotaChip tone="muted">default</QuotaChip>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                -
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                            {primary ? (
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
                                  {formatQuotaValue(primary.currentUsage, primary.limitType)} /{' '}
                                  {formatQuotaValue(primary.limit, primary.limitType)}
                                </span>
                                {status && status.quotas.length > 1 && (
                                  <span className="text-[11px] text-text-muted">
                                    (+{status.quotas.length - 1})
                                  </span>
                                )}
                                <button
                                  className="bg-transparent border-0 text-text-muted p-1 rounded-sm cursor-pointer hover:text-primary"
                                  onClick={() => handleViewQuotaStatus(key.key)}
                                  title="View details"
                                >
                                  <BarChart3 size={14} />
                                </button>
                              </div>
                            ) : quotaNames || usingDefaults ? (
                              <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                Loading...
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
                            <div
                              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
                            >
                              <Button variant="ghost" size="sm" onClick={() => handleEditKey(key)}>
                                <Edit2 size={14} />
                              </Button>
                              {key.expiresAt && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDisableKey(key)}
                                  title="Disable key"
                                  style={{ color: 'var(--color-danger)' }}
                                >
                                  <Ban size={14} />
                                </Button>
                              )}
                              {(quotaNames || usingDefaults) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleClearQuota(key.key)}
                                  title="Reset quota"
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
                    {activeKeys.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-text-muted p-12">
                          No keys found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="mb-6">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setShowDisabledKeys(!showDisabledKeys)}
                aria-expanded={showDisabledKeys}
              >
                <span className="font-heading text-sm font-semibold text-text">
                  Disabled Keys ({disabledKeys.length})
                </span>
                <ChevronDown
                  size={16}
                  className={`text-text-muted transition-transform ${showDisabledKeys ? 'rotate-180' : ''}`}
                />
              </button>
              {showDisabledKeys && (
                <div className="mt-4 overflow-x-auto">
                  {disabledKeys.length === 0 ? (
                    <div className="py-6 text-center text-sm text-text-muted">
                      No disabled keys found
                    </div>
                  ) : (
                    <table className="w-full border-collapse font-body text-[13px]">
                      <thead>
                        <tr className="border-b border-border-glass text-left text-[11px] uppercase tracking-wider text-text-secondary">
                          <th className="px-3 py-2">Key Name</th>
                          <th className="px-3 py-2">Expiration</th>
                          <th className="px-3 py-2">Disabled</th>
                          <th className="px-3 py-2">Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {disabledKeys.map((key) => (
                          <tr key={key.key} className="border-b border-border-glass text-text">
                            <td className="px-3 py-3 font-medium">{key.key}</td>
                            <td className="px-3 py-3">
                              {key.expiresAt ? formatExpiry(key.expiresAt) : '-'}
                            </td>
                            <td className="px-3 py-3">
                              {key.disabledAt ? formatExpiry(key.disabledAt) : 'Expired'}
                            </td>
                            <td className="px-3 py-3 text-text-muted">{key.comment || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Card>
          </>
        )}

        {/* Quotas Tab */}
        {activeTab === 'quotas' && (
          <>
            <Card title="Default quotas" className="mb-6">
              <p className="text-xs text-text-muted mb-3">
                Applied to any key with no quotas of its own (non-stacking — a key's own{' '}
                <code>quotas</code> always wins over this fallback when set).
              </p>
              <TagSelect
                placeholder="No default quotas — select one or more..."
                options={Object.keys(quotas).sort()}
                selected={defaultQuotaNames}
                onChange={handleSaveDefaultQuotas}
              />
              {isSavingDefaults && <p className="mt-2 text-xs text-text-muted">Saving…</p>}
            </Card>

            <Card title="User Quotas" className="mb-6">
              <div className="space-y-3 md:hidden">
                {filteredQuotas.length === 0 ? (
                  <div className="py-10 text-center text-sm text-text-muted">
                    {Object.keys(quotas).length === 0 ? 'No quotas defined yet' : 'No quotas found'}
                  </div>
                ) : (
                  filteredQuotas.map(([name, quota]) => {
                    const keysUsingQuota = keys.filter((k) => k.quotas?.includes(name)).length;

                    return (
                      <article
                        key={name}
                        className="rounded-md border border-border-glass bg-bg-subtle p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-heading text-sm font-semibold text-text">
                                {name}
                              </span>
                              {quota.shared && (
                                <QuotaChip>
                                  <Users size={10} /> shared
                                </QuotaChip>
                              )}
                              {hasScope(quota) && <QuotaChip tone="muted">scoped</QuotaChip>}
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
                              aria-label={`Edit ${name}`}
                            >
                              <Edit2 size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteQuota(name)}
                              className="text-danger"
                              aria-label={`Delete ${name}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">
                              Limit
                            </div>
                            <div className="truncate font-mono text-text">
                              {quota.limitType === 'cost'
                                ? `${formatCost(quota.limit, 5)} ${quota.limitType}`
                                : `${formatNumber(quota.limit)} ${quota.limitType}`}
                            </div>
                          </div>
                          <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">
                              Keys
                            </div>
                            <div className="truncate font-medium text-text-secondary">
                              {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
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
                        Name
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Limit
                      </th>
                      <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                        Keys Using
                      </th>
                      <th
                        className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                        style={{ paddingRight: '24px', textAlign: 'right' }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotas.map(([name, quota]) => {
                      const keysUsingQuota = keys.filter((k) => k.quotas?.includes(name)).length;

                      return (
                        <tr key={name} className="hover:bg-bg-hover">
                          <td
                            className="px-4 py-3 text-left border-b border-border-glass text-text"
                            style={{ fontWeight: 600, paddingLeft: '24px' }}
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{name}</span>
                              {quota.shared && (
                                <QuotaChip>
                                  <Users size={10} /> shared
                                </QuotaChip>
                              )}
                              {hasScope(quota) && <QuotaChip tone="muted">scoped</QuotaChip>}
                            </div>
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
                              {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
                            </span>
                          </td>
                          <td
                            className="px-4 py-3 text-left border-b border-border-glass text-text"
                            style={{ paddingRight: '24px', textAlign: 'right' }}
                          >
                            <div
                              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
                            >
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
                            ? 'No quotas defined yet'
                            : 'No quotas found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* Key Modal */}
        <Modal
          isOpen={isKeyModalOpen}
          onClose={() => setIsKeyModalOpen(false)}
          title={originalKeyName ? 'Edit Key' : 'Add Key'}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsKeyModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveKey}
                isLoading={isSavingKey}
                disabled={!editingKey.key || !editingKey.secret}
              >
                Save Key
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex flex-col gap-2">
              <Input
                label="Key Name (ID)"
                value={editingKey.key}
                onChange={(e) => setEditingKey({ ...editingKey, key: e.target.value })}
                placeholder="e.g. production-app-1"
                disabled={!!originalKeyName}
              />
              <p className="text-xs text-text-muted">
                {originalKeyName
                  ? 'Key ID cannot be changed once created.'
                  : 'A unique identifier for this key.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                Secret Key
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <Input
                    value={editingKey.secret}
                    onChange={(e) => setEditingKey({ ...editingKey, secret: e.target.value })}
                    placeholder="sk-..."
                    type="password"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={generateKey}
                  title="Generate new key"
                  className="w-full sm:w-auto"
                >
                  <RefreshCw size={16} />
                </Button>
              </div>
              <p className="text-xs text-text-muted mt-1">
                The secret used to authenticate. Click refresh to generate a secure random key.
              </p>
            </div>

            <Input
              label="Comment"
              value={editingKey.comment || ''}
              onChange={(e) => setEditingKey({ ...editingKey, comment: e.target.value })}
              placeholder="Optional description..."
            />

            {originalKeyName ? (
              editingKey.expiresAt && (
                <div className="rounded-md border border-border-glass bg-bg-subtle p-3 text-sm text-text-secondary">
                  <div>Expires: {formatExpiry(editingKey.expiresAt)}</div>
                  <p className="mt-1 text-xs text-text-muted">
                    Expiry cannot be changed after creation.
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Expiry (optional)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={expiryAmount}
                    onChange={(event) => setExpiryAmount(event.target.value)}
                    placeholder="Never expires"
                  />
                  <select
                    className="rounded-md border border-border-glass bg-bg-subtle px-3 text-sm text-text"
                    value={expiryUnit}
                    onChange={(event) => setExpiryUnit(event.target.value as typeof expiryUnit)}
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
                <p className="text-xs text-text-muted">
                  Once set, a time-bound key cannot be extended or re-enabled.
                </p>
              </div>
            )}

            <TagSelect
              label="Excluded Model Aliases"
              placeholder="Optional: select model aliases to exclude..."
              options={aliasIds}
              selected={editingKey.excludedModels || []}
              onChange={(excludedModels) =>
                setEditingKey({
                  ...editingKey,
                  excludedModels: excludedModels.length > 0 ? excludedModels : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              Optional denylist. If set, this key cannot use these model aliases.
            </p>

            <TagSelect
              label="Allowed Model Aliases"
              placeholder="Optional: select model aliases..."
              options={aliasIds}
              selected={editingKey.allowedModels || []}
              onChange={(allowedModels) =>
                setEditingKey({
                  ...editingKey,
                  allowedModels: allowedModels.length > 0 ? allowedModels : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              Optional allowlist. If set, this key can only use these configured model aliases.
            </p>

            <TagSelect
              label="Excluded Providers"
              placeholder="Optional: select providers to exclude..."
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
              Optional denylist. If set, routing will not use these provider IDs.
            </p>

            <TagSelect
              label="Allowed Providers"
              placeholder="Optional: select providers..."
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
              Optional allowlist. If set, routing is limited to these provider IDs.
            </p>

            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <Switch
                checked={editingKey.allowRawPassthrough === true}
                onChange={(allowRawPassthrough) =>
                  setEditingKey({ ...editingKey, allowRawPassthrough })
                }
              />
              <div>
                <div className="font-body text-[13px] text-text">Allow Raw Provider Access</div>
                <div className="text-xs text-text-muted" style={{ lineHeight: 1.35 }}>
                  Privileged capability. This key may call any endpoint on raw-enabled providers
                  permitted by its provider allow/deny lists. Model restrictions do not apply.
                </div>
              </div>
            </label>

            <TagSelect
              label="Allowed IPs"
              placeholder="e.g. 192.168.1.10  10.0.0.0/8  10.1.0.10-20"
              options={[]}
              selected={editingKey.allowedIps || []}
              allowCustom
              splitOnSpace
              onChange={(allowedIps) =>
                setEditingKey({
                  ...editingKey,
                  allowedIps: allowedIps.length > 0 ? allowedIps : undefined,
                })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              Optional allowlist. Type entries separated by spaces. Empty means allow all;{' '}
              <code>0.0.0.0/0</code> is all IPv4 and <code>::/0</code> all IPv6. Accepts IPv4/IPv6,
              CIDR (e.g. <code>10.0.0.0/8</code>), and ranges (e.g. <code>10.1.0.10-20</code>).
            </p>

            <TagSelect
              label="Quota Assignment"
              placeholder="No quotas — falls back to default quotas, if any..."
              options={Object.keys(quotas).sort()}
              selected={editingKey.quotas || []}
              onChange={(names) =>
                setEditingKey({ ...editingKey, quotas: names.length > 0 ? names : undefined })
              }
            />
            <p className="text-xs text-text-muted -mt-1">
              Optional: assign one or more quotas to this key (usage against each is tracked
              independently). When left empty, this key falls back to the system's default quotas,
              if any are configured.
            </p>
          </div>
        </Modal>

        {/* Quota Modal */}
        <Modal
          isOpen={isQuotaModalOpen}
          onClose={() => setIsQuotaModalOpen(false)}
          title={originalQuotaName ? 'Edit Quota' : 'Add Quota'}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsQuotaModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveQuota}
                isLoading={isSavingQuota}
                disabled={!editingQuota.name}
              >
                Save Quota
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex flex-col gap-2">
              <Input
                label="Quota Name"
                value={editingQuota.name}
                onChange={(e) => setEditingQuota({ ...editingQuota, name: e.target.value })}
                placeholder="e.g. daily-1000"
                disabled={!!originalQuotaName}
              />
              <p className="text-xs text-text-muted">
                {originalQuotaName
                  ? 'Quota name cannot be changed once created.'
                  : 'A unique identifier for this quota. Use lowercase letters, numbers, hyphens.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                Quota Type
              </label>
              <select
                className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                value={editingQuota.type}
                onChange={(e) =>
                  setEditingQuota({ ...editingQuota, type: e.target.value as UserQuota['type'] })
                }
              >
                <option value="rolling">Rolling Window</option>
                <option value="daily">Daily (UTC)</option>
                <option value="weekly">Weekly (UTC)</option>
                <option value="monthly">Monthly (UTC)</option>
              </select>
              <p className="text-xs text-text-muted">
                {editingQuota.type === 'rolling' && 'Limits usage over a sliding time window'}
                {editingQuota.type === 'daily' && 'Resets at midnight UTC each day'}
                {editingQuota.type === 'weekly' && 'Resets at midnight UTC on Monday'}
                {editingQuota.type === 'monthly' &&
                  'Resets at midnight UTC on the 1st of each month'}
              </p>
            </div>

            {editingQuota.type === 'rolling' && (
              <div className="flex flex-col gap-2">
                <Input
                  label="Duration"
                  value={editingQuota.duration || ''}
                  onChange={(e) => setEditingQuota({ ...editingQuota, duration: e.target.value })}
                  placeholder="e.g. 1h, 30m, 1d"
                />
                <p className="text-xs text-text-muted">
                  Duration of the rolling window (e.g., 1h, 30m, 2h30m, 1d)
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                Limit Type
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
                <option value="requests">Requests</option>
                <option value="tokens">Tokens</option>
                <option value="cost">Cost ($)</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Input
                label="Limit"
                type="number"
                value={editingQuota.limit}
                onChange={(e) =>
                  setEditingQuota({ ...editingQuota, limit: parseInt(e.target.value) || 0 })
                }
                placeholder="1000"
              />
              <p className="text-xs text-text-muted">
                Maximum {editingQuota.limitType === 'cost' ? 'cost ($)' : editingQuota.limitType}{' '}
                allowed
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border border-border-glass bg-bg-subtle p-3">
              <div className="min-w-0 flex-1">
                <div className="font-body text-[13px] font-medium text-text-secondary">
                  Shared bucket
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Pool usage across every key that references this quota into a single counter,
                  instead of tracking each key independently.
                </p>
              </div>
              <Switch
                checked={!!editingQuota.shared}
                onChange={(shared) => setEditingQuota({ ...editingQuota, shared })}
                aria-label="Toggle shared quota bucket"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Input
                label="Warn threshold (optional)"
                type="number"
                min={1}
                max={99}
                value={
                  editingQuota.warnAt !== undefined ? Math.round(editingQuota.warnAt * 100) : ''
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setEditingQuota({ ...editingQuota, warnAt: undefined });
                    return;
                  }
                  const pct = parseInt(raw, 10);
                  if (Number.isNaN(pct)) return;
                  setEditingQuota({
                    ...editingQuota,
                    warnAt: Math.min(99, Math.max(1, pct)) / 100,
                  });
                }}
                placeholder="e.g. 80"
              />
              <p className="text-xs text-text-muted">
                Percent of the limit at which to flag usage as approaching exhaustion. Leave empty
                to disable early-warning.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-border-glass">
              <p className="text-xs font-medium text-text-secondary">
                Scope (optional — unscoped applies to every provider/model)
              </p>
            </div>

            <TagSelect
              label="Allowed Providers"
              placeholder="Optional: restrict to these providers..."
              options={providerIds}
              selected={editingQuota.allowedProviders || []}
              onChange={(allowedProviders) =>
                setEditingQuota({ ...editingQuota, allowedProviders })
              }
            />
            <TagSelect
              label="Excluded Providers"
              placeholder="Optional: exclude these providers..."
              options={providerIds}
              selected={editingQuota.excludedProviders || []}
              onChange={(excludedProviders) =>
                setEditingQuota({ ...editingQuota, excludedProviders })
              }
            />
            <TagSelect
              label="Allowed Models"
              placeholder="Optional: restrict to these models..."
              options={allModelNames}
              selected={editingQuota.allowedModels || []}
              allowCustom
              onChange={(allowedModels) => setEditingQuota({ ...editingQuota, allowedModels })}
            />
            <TagSelect
              label="Excluded Models"
              placeholder="Optional: exclude these models..."
              options={allModelNames}
              selected={editingQuota.excludedModels || []}
              allowCustom
              onChange={(excludedModels) => setEditingQuota({ ...editingQuota, excludedModels })}
            />
            <p className="text-xs text-text-muted -mt-1">
              Only requests matching the allowed/not-excluded provider and model count against this
              quota. Model names accept free-typing since not every model is synced into a
              provider's catalog yet.
            </p>
          </div>
        </Modal>

        {/* Quota Detail Modal */}
        <Modal
          isOpen={isQuotaDetailOpen}
          onClose={() => setIsQuotaDetailOpen(false)}
          title={`Quota Status: ${selectedQuotaName}`}
          size="md"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => setIsQuotaDetailOpen(false)}>
                Close
              </Button>
              {selectedQuotaStatus && selectedQuotaStatus.quotas.length > 0 && (
                <Button
                  onClick={() => handleClearQuota(selectedQuotaStatus.key)}
                  variant="secondary"
                >
                  Reset All
                </Button>
              )}
            </div>
          }
        >
          {selectedQuotaStatus && (
            <div className="flex flex-col gap-4">
              {selectedQuotaStatus.quotas.length === 0 ? (
                <div className="flex items-center gap-3 p-3 bg-bg-subtle rounded-md">
                  <AlertCircle className="text-text-muted" size={20} />
                  <p className="text-sm text-text-secondary">
                    No quota assigned to this key, and no default quotas are configured.
                  </p>
                </div>
              ) : (
                sortMostConstrainedFirst(selectedQuotaStatus.quotas).map((entry) => (
                  <QuotaStatusCard
                    key={entry.name}
                    entry={entry}
                    variant="detailed"
                    onReset={(name) => handleClearQuota(selectedQuotaStatus.key, name)}
                    onRecompute={(name) => handleRecomputeQuota(selectedQuotaStatus.key, name)}
                    recomputeLeaky={isLeakyRollingDef(quotas[entry.name])}
                    recomputing={recomputingQuota === entry.name}
                  />
                ))
              )}
            </div>
          )}
        </Modal>
      </PageContainer>
    </div>
  );
};
