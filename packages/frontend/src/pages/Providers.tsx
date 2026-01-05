import { useEffect, useState } from 'react';
import { api, Provider, Cooldown, Model } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

export const Providers = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  // Form State
  const [formData, setFormData] = useState({
      id: '',
      name: '',
      type: '',
      apiKey: ''
  });

  useEffect(() => {
    loadProviders();
    const interval = setInterval(loadProviders, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const loadProviders = () => {
      Promise.all([
          api.getProviders(),
          api.getCooldowns(),
          api.getModels()
      ]).then(([provs, cools, mods]) => {
          setProviders(provs);
          setCooldowns(cools);
          setModels(mods);
      }).catch(err => console.error(err));
  };

  const handleEdit = (provider: Provider) => {
    setEditingProvider(provider);
    setFormData({
        id: provider.id,
        name: provider.name,
        type: Array.isArray(provider.type) ? provider.type.join(', ') : provider.type,
        apiKey: provider.apiKey
    });
    setIsModalOpen(true);
  };

  const handleAdd = () => {
      setEditingProvider(null);
      setFormData({ id: '', name: '', type: '', apiKey: '' });
      setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this provider?')) {
        const updated = providers.filter(p => p.id !== id);
        setProviders(updated); // Optimistic update
        try {
            await api.saveProviders(updated);
        } catch (e) {
            console.error("Failed to delete", e);
            loadProviders(); // Revert on error
        }
    }
  };

  const handleClose = () => {
      setIsModalOpen(false);
      setEditingProvider(null);
  };

  const handleSave = async () => {
      let updatedProviders: Provider[];
      
      if (editingProvider) {
          // Update existing
          updatedProviders = providers.map(p => 
              p.id === editingProvider.id 
                  ? { ...p, name: formData.name, type: formData.type, apiKey: formData.apiKey } 
                  : p
          );
      } else {
          // Add new
          // Use name as ID if id is empty, or generate one
          const newId = formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const newProvider: Provider = {
              id: newId,
              name: formData.name,
              type: formData.type,
              apiKey: formData.apiKey,
              enabled: true
          };
          updatedProviders = [...providers, newProvider];
      }

      setProviders(updatedProviders); // Optimistic
      setIsModalOpen(false);

      try {
          await api.saveProviders(updatedProviders);
      } catch (e) {
          console.error("Failed to save", e);
          loadProviders(); // Revert
          alert("Failed to save provider: " + e);
      }
  };

  const handleClearCooldown = async (providerId: string) => {
      try {
          await api.clearCooldown(providerId);
          loadProviders();
      } catch (e) {
          alert("Failed to clear cooldown: " + e);
      }
  };

  const getCooldownStatus = (providerId: string) => {
      const cooldown = cooldowns.find(c => c.provider === providerId);
      if (!cooldown) return null;
      const mins = Math.ceil(cooldown.timeRemainingMs / 60000);
      return { mins };
  };

  return (
    <div className="dashboard">
      <div className="page-header">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
            <div>
                <h1 className="page-title">Providers</h1>
                <p className="page-description">Manage AI provider integrations.</p>
            </div>
            <Button onClick={handleAdd} leftIcon={<Plus size={16}/>}>Add Provider</Button>
        </div>
      </div>

      <div className="providers-grid">
        {providers.map(provider => {
          const cooldown = getCooldownStatus(provider.id);
          return (
          <div key={provider.id} className="provider-quota-card" style={cooldown ? {borderColor: 'var(--color-warning)'} : {}}>
            <div className="quota-header">
                <div className="quota-provider-info">
                    <div className="quota-name-group">
                        <span className="quota-name">{provider.name}</span>
                        <span className="quota-window">
                            {Array.isArray(provider.type) ? provider.type.join(', ') : provider.type}
                        </span>
                    </div>
                </div>
                 <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                    {cooldown && (
                        <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                            <Badge status="warning">
                                <AlertTriangle size={12} style={{marginRight: '4px'}}/>
                                Cooldown: {cooldown.mins}m
                            </Badge>
                            <button 
                                className="btn btn-sm btn-ghost" 
                                style={{padding: '2px 8px', fontSize: '11px', height: 'auto', color: 'var(--color-warning)'}}
                                onClick={() => handleClearCooldown(provider.id)}
                            >
                                Clear
                            </button>
                        </div>
                    )}
                    <Badge status={provider.enabled ? 'connected' : 'disconnected'}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                 </div>
            </div>
            <div className="quota-body" style={{justifyContent: 'space-between', alignItems: 'center'}}>
                <div className="quota-stats">
                     <span className="quota-label">API Key</span>
                     <span className="quota-limit" style={{fontSize: '14px'}}>
                         {provider.apiKey ? `••••••••${provider.apiKey.slice(-4)}` : 'Not Set'}
                     </span>
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="settings-btn" onClick={() => handleEdit(provider)}><Edit2 size={14}/></button>
                    <button className="settings-btn" style={{color: 'var(--color-danger)', borderColor: 'var(--color-danger)'}} onClick={() => handleDelete(provider.id)}><Trash2 size={14}/></button>
                </div>
            </div>
          </div>
        )})}
      </div>

      <div style={{marginTop: '32px'}}>
        <Card title="Provider Models">
            <div className="table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{paddingLeft: '24px'}}>Provider</th>
                            <th>APIs Supported</th>
                            <th style={{paddingRight: '24px'}}>Models [pricing source]</th>
                        </tr>
                    </thead>
                    <tbody>
                        {providers.map(provider => {
                            const providerModels = models.filter(m => m.providerId === provider.id);
                            
                            return (
                                <tr key={provider.id}>
                                    <td style={{fontWeight: 600, paddingLeft: '24px', verticalAlign: 'top'}}>
                                        {provider.id}
                                    </td>
                                    <td style={{verticalAlign: 'top', fontSize: '12px', color: 'var(--color-text-secondary)'}}>
                                        {Array.isArray(provider.type) ? (
                                            <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                                {provider.type.map(type => (
                                                    <div key={type}>
                                                        <span style={{fontWeight: 500}}>{type}:</span>{' '}
                                                        <span style={{opacity: 0.8}}>
                                                            {typeof provider.apiBaseUrl === 'object' 
                                                                ? (provider.apiBaseUrl as Record<string,string>)[type] 
                                                                : provider.apiBaseUrl}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div>
                                                <span style={{fontWeight: 500}}>{provider.type}:</span>{' '}
                                                <span style={{opacity: 0.8}}>{provider.apiBaseUrl as string}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td style={{paddingRight: '24px', verticalAlign: 'top'}}>
                                        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                            {providerModels.map(model => (
                                                <div key={model.id} style={{fontSize: '13px'}}>
                                                    {model.name}
                                                    {model.pricingSource && (
                                                        <span style={{marginLeft: '8px', fontSize: '11px', color: 'var(--color-text-tertiary)'}}>
                                                            [{model.pricingSource}]
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                            {providerModels.length === 0 && <span style={{fontSize: '12px', opacity: 0.5}}>No models configured</span>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {providers.length === 0 && (
                            <tr>
                                <td colSpan={3} className="empty">No providers found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleClose}
        title={editingProvider ? "Edit Provider" : "Add Provider"}
        footer={
            <>
                <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleSave}>Save</Button>
            </>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <Input 
                label="Name" 
                value={formData.name} 
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. OpenAI Production" 
              />
              <Input 
                label="Type" 
                value={formData.type} 
                onChange={(e) => setFormData({...formData, type: e.target.value})}
                placeholder="openai, anthropic..." 
              />
              <Input 
                label="API Key" 
                type="password" 
                value={formData.apiKey} 
                onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
                placeholder="sk-..." 
              />
          </div>
      </Modal>
    </div>
  );
};
