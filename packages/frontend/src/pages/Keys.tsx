import { useEffect, useState } from 'react';
import { api, KeyConfig, UserQuota } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Search, Plus, Trash2, Edit2, Copy, RefreshCw, Check, Shield, AlertCircle, BarChart3 } from 'lucide-react';
import { formatNumber } from '../lib/format';

const EMPTY_KEY: KeyConfig = {
    key: '',
    secret: '',
    comment: ''
};

const EMPTY_QUOTA: UserQuota & { name: string } = {
    name: '',
    type: 'rolling',
    limitType: 'requests',
    limit: 1000,
    duration: '1h'
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
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [quotas, setQuotas] = useState<Record<string, UserQuota>>({});
  const [quotaStatuses, setQuotaStatuses] = useState<Record<string, QuotaStatus>>({});
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
        const [k, q] = await Promise.all([
            api.getKeys(),
            api.getUserQuotas()
        ]);
        setKeys(k);
        setQuotas(q);
        
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
        console.error("Failed to load data", e);
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
          console.error("Failed to save key", e);
          alert("Failed to save key");
      } finally {
          setIsSavingKey(false);
      }
  };

  const handleDeleteKey = async (keyName: string) => {
      if (!confirm(`Are you sure you want to delete key '${keyName}'? This cannot be undone.`)) return;
      
      try {
          await api.deleteKey(keyName);
          await loadData();
      } catch (e) {
          console.error("Failed to delete key", e);
          alert("Failed to delete key");
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
          alert("Rolling quotas require a duration");
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
          console.error("Failed to save quota", e);
          alert(e.message || "Failed to save quota");
      } finally {
          setIsSavingQuota(false);
      }
  };

  const handleDeleteQuota = async (name: string) => {
      if (!confirm(`Are you sure you want to delete quota '${name}'? This cannot be undone.`)) return;
      
      try {
          await api.deleteUserQuota(name);
          await loadData();
      } catch (e: any) {
          console.error("Failed to delete quota", e);
          alert(e.message || "Failed to delete quota");
      }
  };

  const handleClearQuota = async (keyName: string) => {
      if (!confirm(`Reset quota usage for key '${keyName}'?`)) return;
      
      try {
          await api.clearQuota(keyName);
          await loadData();
      } catch (e) {
          console.error("Failed to clear quota", e);
          alert("Failed to clear quota");
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
      const uuid = crypto.randomUUID();
      setEditingKey({ ...editingKey, secret: `sk-${uuid}` });
  };

  const copyToClipboard = (text: string, keyId: string) => {
      navigator.clipboard.writeText(text);
      setCopiedKey(keyId);
      setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredKeys = keys.filter(k => 
      k.key.toLowerCase().includes(search.toLowerCase()) || 
      (k.comment && k.comment.toLowerCase().includes(search.toLowerCase())) ||
      (k.quota && k.quota.toLowerCase().includes(search.toLowerCase()))
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
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      {/* Header */}
      <div className="mb-8">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
                <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Access Control</h1>
                <p className="text-[15px] text-text-secondary m-0">Manage API keys and user quotas.</p>
            </div>
            <div style={{display: 'flex', gap: '8px'}}>
                {activeTab === 'keys' ? (
                    <Button leftIcon={<Plus size={16}/>} onClick={handleAddNewKey}>Add Key</Button>
                ) : (
                    <Button leftIcon={<Plus size={16}/>} onClick={handleAddNewQuota}>Add Quota</Button>
                )}
            </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-border-glass">
        <div style={{display: 'flex', gap: '8px'}}>
            <button
                className={`px-4 py-2 font-body text-sm font-medium transition-colors ${
                    activeTab === 'keys' 
                        ? 'text-primary border-b-2 border-primary' 
                        : 'text-text-secondary hover:text-text'
                }`}
                onClick={() => setActiveTab('keys')}
            >
                API Keys ({keys.length})
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
           <div style={{position: 'relative'}}>
              <Search size={16} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}} />
              <Input 
                placeholder={activeTab === 'keys' ? "Search keys..." : "Search quotas..."}
                style={{paddingLeft: '36px'}}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
      </Card>

      {/* Keys Tab */}
      {activeTab === 'keys' && (
        <Card title="Active Keys" className="mb-6">
          <div className="overflow-x-auto -m-6">
              <table className="w-full border-collapse font-body text-[13px]">
                  <thead>
                      <tr>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Key Name</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Secret</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Quota</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                      </tr>
                  </thead>
                  <tbody>
                      {filteredKeys.map(key => {
                          const status = quotaStatuses[key.key];
                          const usagePercent = status ? getQuotaUsagePercent(status) : 0;
                          
                          return (
                          <tr key={key.key} className="hover:bg-bg-hover">
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{fontWeight: 600, paddingLeft: '24px'}}>
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      {key.key}
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      <span style={{fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'var(--color-bg-subtle)', padding: '2px 6px', borderRadius: '4px'}}>
                                          {key.secret.substring(0, 5)}...
                                      </span>
                                      <button 
                                          className="bg-transparent border-0 text-text-muted p-1.5 rounded-sm cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-bg-hover hover:text-primary active:scale-95" 
                                          onClick={() => copyToClipboard(key.secret, key.key)}
                                          title="Copy Secret"
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
                                      <span style={{color: 'var(--color-text-muted)', fontSize: '13px'}}>-</span>
                                  )}
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  {status ? (
                                      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                          <div 
                                              style={{
                                                  width: '8px', 
                                                  height: '8px', 
                                                  borderRadius: '50%', 
                                                  backgroundColor: getQuotaStatusColor(usagePercent)
                                              }} 
                                          />
                                          <span style={{fontSize: '12px'}}>
                                              {formatNumber(status.current_usage)} / {formatNumber(status.limit || 0)}
                                          </span>
                                          <button
                                              className="bg-transparent border-0 text-text-muted p-1 rounded-sm cursor-pointer hover:text-primary"
                                              onClick={() => handleViewQuotaStatus(key.key)}
                                              title="View details"
                                          >
                                              <BarChart3 size={14} />
                                          </button>
                                      </div>
                                  ) : key.quota ? (
                                      <span style={{color: 'var(--color-text-muted)', fontSize: '13px'}}>Loading...</span>
                                  ) : (
                                      <span style={{color: 'var(--color-text-muted)', fontSize: '13px'}}>-</span>
                                  )}
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                                  <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                                      <Button variant="ghost" size="sm" onClick={() => handleEditKey(key)}>
                                          <Edit2 size={14} />
                                      </Button>
                                      {key.quota && (
                                          <Button variant="ghost" size="sm" onClick={() => handleClearQuota(key.key)} title="Reset quota">
                                              <RefreshCw size={14} />
                                          </Button>
                                      )}
                                      <Button variant="ghost" size="sm" onClick={() => handleDeleteKey(key.key)} style={{color: 'var(--color-danger)'}}>
                                          <Trash2 size={14} />
                                      </Button>
                                  </div>
                              </td>
                          </tr>
                      )})}
                      {filteredKeys.length === 0 && (
                          <tr>
                              <td colSpan={5} className="text-center text-text-muted p-12">No keys found</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        </Card>
      )}

      {/* Quotas Tab */}
      {activeTab === 'quotas' && (
        <Card title="User Quotas" className="mb-6">
          <div className="overflow-x-auto -m-6">
              <table className="w-full border-collapse font-body text-[13px]">
                  <thead>
                      <tr>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Name</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Limit</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Keys Using</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                      </tr>
                  </thead>
                  <tbody>
                      {filteredQuotas.map(([name, quota]) => {
                          const keysUsingQuota = keys.filter(k => k.quota === name).length;
                          
                          return (
                          <tr key={name} className="hover:bg-bg-hover">
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{fontWeight: 600, paddingLeft: '24px'}}>
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
                                      {formatNumber(quota.limit)} {quota.limitType}
                                  </span>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md ${
                                      keysUsingQuota > 0 
                                          ? 'bg-primary/10 text-primary' 
                                          : 'bg-bg-subtle text-text-muted'
                                  }`}>
                                      {keysUsingQuota} key{keysUsingQuota !== 1 ? 's' : ''}
                                  </span>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                                  <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                                      <Button variant="ghost" size="sm" onClick={() => handleEditQuota(name, quota)}>
                                          <Edit2 size={14} />
                                      </Button>
                                      <Button variant="ghost" size="sm" onClick={() => handleDeleteQuota(name)} style={{color: 'var(--color-danger)'}}>
                                          <Trash2 size={14} />
                                      </Button>
                                  </div>
                              </td>
                          </tr>
                      )})}
                      {filteredQuotas.length === 0 && (
                          <tr>
                              <td colSpan={5} className="text-center text-text-muted p-12">
                                  {Object.keys(quotas).length === 0 ? 'No quotas defined yet' : 'No quotas found'}
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
        title={originalKeyName ? "Edit Key" : "Add Key"}
        size="md"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsKeyModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveKey} isLoading={isSavingKey} disabled={!editingKey.key || !editingKey.secret}>Save Key</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div className="flex flex-col gap-2">
                <Input
                  label="Key Name (ID)"
                  value={editingKey.key}
                  onChange={(e) => setEditingKey({...editingKey, key: e.target.value})}
                  placeholder="e.g. production-app-1"
                  disabled={!!originalKeyName}
                />
                <p className="text-xs text-text-muted">
                  {originalKeyName ? "Key ID cannot be changed once created." : "A unique identifier for this key."}
                </p>
              </div>
              
              <div className="flex flex-col gap-2">
                  <label className="font-body text-[13px] font-medium text-text-secondary">Secret Key</label>
                  <div style={{display: 'flex', gap: '8px'}}>
                      <Input 
                        value={editingKey.secret} 
                        onChange={(e) => setEditingKey({...editingKey, secret: e.target.value})}
                        placeholder="sk-..."
                        type="password"
                        style={{flex: 1}}
                      />
                       <Button variant="secondary" onClick={generateKey} title="Generate new key">
                          <RefreshCw size={16} />
                      </Button>
                  </div>
                   <p className="text-xs text-text-muted mt-1">The secret used to authenticate. Click refresh to generate a secure random key.</p>
              </div>

              <Input 
                label="Comment" 
                value={editingKey.comment || ''} 
                onChange={(e) => setEditingKey({...editingKey, comment: e.target.value})}
                placeholder="Optional description..."
              />

              <div className="flex flex-col gap-2">
                  <label className="font-body text-[13px] font-medium text-text-secondary">Quota Assignment</label>
                  <select
                      className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                      value={editingKey.quota || ''}
                      onChange={(e) => setEditingKey({...editingKey, quota: e.target.value || undefined})}
                  >
                      <option value="">&lt;None&gt;</option>
                      {Object.entries(quotas).map(([name, quota]) => (
                          <option key={name} value={name}>
                              {name} ({quota.type}, {quota.limit} {quota.limitType})
                          </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-muted">Optional: Assign a quota limit to this key</p>
              </div>
          </div>
      </Modal>

      {/* Quota Modal */}
      <Modal 
        isOpen={isQuotaModalOpen} 
        onClose={() => setIsQuotaModalOpen(false)} 
        title={originalQuotaName ? "Edit Quota" : "Add Quota"}
        size="md"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsQuotaModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveQuota} isLoading={isSavingQuota} disabled={!editingQuota.name}>Save Quota</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div className="flex flex-col gap-2">
                <Input
                  label="Quota Name"
                  value={editingQuota.name}
                  onChange={(e) => setEditingQuota({...editingQuota, name: e.target.value})}
                  placeholder="e.g. daily-1000"
                  disabled={!!originalQuotaName}
                />
                <p className="text-xs text-text-muted">
                  {originalQuotaName ? "Quota name cannot be changed once created." : "A unique identifier for this quota. Use lowercase letters, numbers, hyphens."}
                </p>
              </div>
              
              <div className="flex flex-col gap-2">
                  <label className="font-body text-[13px] font-medium text-text-secondary">Quota Type</label>
                  <select
                      className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                      value={editingQuota.type}
                      onChange={(e) => setEditingQuota({...editingQuota, type: e.target.value as UserQuota['type']})}
                  >
                      <option value="rolling">Rolling Window</option>
                      <option value="daily">Daily (UTC)</option>
                      <option value="weekly">Weekly (UTC)</option>
                  </select>
                  <p className="text-xs text-text-muted">
                      {editingQuota.type === 'rolling' && "Limits usage over a sliding time window"}
                      {editingQuota.type === 'daily' && "Resets at midnight UTC each day"}
                      {editingQuota.type === 'weekly' && "Resets at midnight UTC on Monday"}
                  </p>
              </div>

              {editingQuota.type === 'rolling' && (
                  <div className="flex flex-col gap-2">
                      <Input
                          label="Duration"
                          value={editingQuota.duration || ''}
                          onChange={(e) => setEditingQuota({...editingQuota, duration: e.target.value})}
                          placeholder="e.g. 1h, 30m, 1d"
                      />
                      <p className="text-xs text-text-muted">Duration of the rolling window (e.g., 1h, 30m, 2h30m, 1d)</p>
                  </div>
              )}

              <div className="flex flex-col gap-2">
                  <label className="font-body text-[13px] font-medium text-text-secondary">Limit Type</label>
                  <select
                      className="w-full px-3 py-2 bg-bg-subtle border border-border-glass rounded-md font-body text-sm text-text focus:border-primary focus:outline-none"
                      value={editingQuota.limitType}
                      onChange={(e) => setEditingQuota({...editingQuota, limitType: e.target.value as UserQuota['limitType']})}
                  >
                      <option value="requests">Requests</option>
                      <option value="tokens">Tokens</option>
                  </select>
              </div>

              <div className="flex flex-col gap-2">
                  <Input
                      label="Limit"
                      type="number"
                      value={editingQuota.limit}
                      onChange={(e) => setEditingQuota({...editingQuota, limit: parseInt(e.target.value) || 0})}
                      placeholder="1000"
                  />
                  <p className="text-xs text-text-muted">Maximum {editingQuota.limitType} allowed</p>
              </div>
          </div>
      </Modal>

      {/* Quota Detail Modal */}
      <Modal
        isOpen={isQuotaDetailOpen}
        onClose={() => setIsQuotaDetailOpen(false)}
        title={`Quota Status: ${selectedQuotaName}`}
        size="sm"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsQuotaDetailOpen(false)}>Close</Button>
                {selectedQuotaStatus && (
                    <Button onClick={() => { handleClearQuota(selectedQuotaStatus.key); setIsQuotaDetailOpen(false); }} variant="secondary">
                        Reset Usage
                    </Button>
                )}
            </div>
        }
      >
          {selectedQuotaStatus && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  <div className="flex items-center gap-3 p-3 bg-bg-subtle rounded-md">
                      {selectedQuotaStatus.allowed ? (
                          <Check className="text-success" size={24} />
                      ) : (
                          <AlertCircle className="text-danger" size={24} />
                      )}
                      <div>
                          <p className="font-medium text-text">
                              {selectedQuotaStatus.allowed ? 'Quota Active' : 'Quota Exhausted'}
                          </p>
                          <p className="text-sm text-text-secondary">
                              {selectedQuotaStatus.quota_name}
                          </p>
                      </div>
                  </div>

                  <div className="space-y-4">
                      <div>
                          <div className="flex justify-between text-sm mb-1">
                              <span className="text-text-secondary">Usage</span>
                              <span className="font-medium text-text">
                                  {formatNumber(selectedQuotaStatus.current_usage)} / {formatNumber(selectedQuotaStatus.limit || 0)}
                              </span>
                          </div>
                          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                              <div 
                                  className="h-full rounded-full transition-all"
                                  style={{
                                      width: `${Math.min(100, getQuotaUsagePercent(selectedQuotaStatus))}%`,
                                      backgroundColor: getQuotaStatusColor(getQuotaUsagePercent(selectedQuotaStatus))
                                  }}
                              />
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="p-3 bg-bg-subtle rounded-md">
                              <p className="text-xs text-text-secondary mb-1">Remaining</p>
                              <p className="font-mono text-lg text-text">
                                  {selectedQuotaStatus.remaining !== null 
                                      ? formatNumber(selectedQuotaStatus.remaining) 
                                      : '-'}
                              </p>
                          </div>
                          <div className="p-3 bg-bg-subtle rounded-md">
                              <p className="text-xs text-text-secondary mb-1">Resets At</p>
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
    </div>
  );
};
