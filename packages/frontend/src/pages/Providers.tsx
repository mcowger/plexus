import { useEffect, useState } from 'react';
import { api, Provider } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, X, Download, Info } from 'lucide-react';

import { Switch } from '../components/ui/Switch';
import { OpenRouterSlugInput } from '../components/ui/OpenRouterSlugInput';

const KNOWN_APIS = ['chat', 'messages', 'gemini', 'embeddings', 'transcriptions', 'speech', 'images', 'responses'];

const getApiBadgeStyle = (apiType: string): React.CSSProperties => {
    switch (apiType.toLowerCase()) {
        case 'messages':
            return { backgroundColor: '#D97757', color: 'white', border: 'none' };
        case 'chat':
            return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
        case 'gemini':
            return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
        case 'embeddings':
            return { backgroundColor: '#10b981', color: 'white', border: 'none' };
        case 'transcriptions':
            return { backgroundColor: '#a855f7', color: 'white', border: 'none' };
        case 'speech':
            return { backgroundColor: '#f97316', color: 'white', border: 'none' };
        case 'images':
            return { backgroundColor: '#d946ef', color: 'white', border: 'none' };
        case 'responses':
            return { backgroundColor: '#06b6d4', color: 'white', border: 'none' };
        default:
            return {};
    }
};

/**
 * Infer provider API types from api_base_url
 * Matches the backend inference logic
 */
const inferProviderTypes = (apiBaseUrl?: string | Record<string, string>): string[] => {
  if (!apiBaseUrl) {
    return ['chat']; // Default fallback
  }

  if (typeof apiBaseUrl === 'string') {
    const url = apiBaseUrl.toLowerCase();
    if (url.includes('anthropic.com')) {
      return ['messages'];
    } else if (url.includes('generativelanguage.googleapis.com')) {
      return ['gemini'];
    } else {
      return ['chat'];
    }
  } else {
    return Object.keys(apiBaseUrl).filter(key => {
      const value = apiBaseUrl[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
};

const EMPTY_PROVIDER: Provider = {
    id: '',
    name: '',
    type: [],
    apiKey: '',
    enabled: true,
    estimateTokens: false,
    apiBaseUrl: {},
    headers: {},
    extraBody: {},
    models: {}
};

interface FetchedModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  object?: string;
  owned_by?: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export const Providers = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider>(EMPTY_PROVIDER);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Accordion state for Modal
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [openModelIdx, setOpenModelIdx] = useState<string | null>(null);

  // Fetch Models Modal state
  const [isFetchModelsModalOpen, setIsFetchModelsModalOpen] = useState(false);
  const [modelsUrl, setModelsUrl] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
        const p = await api.getProviders();
        setProviders(p);
    } catch (e) {
        console.error("Failed to load data", e);
    }
  };

  const handleEdit = (provider: Provider) => {
    setOriginalId(provider.id);
    setEditingProvider(JSON.parse(JSON.stringify(provider)));
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setOriginalId(null);
    setEditingProvider(JSON.parse(JSON.stringify(EMPTY_PROVIDER)));
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm(`Are you sure you want to delete provider "${id}"?`)) {
        try {
            const updated = providers.filter(p => p.id !== id);
            await api.saveProviders(updated);
            await loadData();
        } catch (e) {
            alert("Failed to delete provider: " + e);
        }
    }
  };

  const handleSave = async () => {
    if (!editingProvider.id) {
        alert("Provider ID is required");
        return;
    }
    setIsSaving(true);
    try {
        await api.saveProvider(editingProvider, originalId || undefined);
        await loadData();
        setIsModalOpen(false);
    } catch (e) {
        console.error("Save error", e);
        alert("Failed to save provider: " + e);
    } finally {
        setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (provider: Provider, newState: boolean) => {
      const updated = providers.map(p => p.id === provider.id ? { ...p, enabled: newState } : p);
      setProviders(updated);

      try {
          const p = { ...provider, enabled: newState };
          await api.saveProvider(p, provider.id);
      } catch (e) {
          console.error("Toggle error", e);
          alert("Failed to update provider status: " + e);
          loadData();
      }
  };

  const updateApiUrl = (apiType: string, url: string) => {
      let newBaseUrl: any = editingProvider.apiBaseUrl;

      if (typeof newBaseUrl !== 'object' || newBaseUrl === null) {
          const currentTypes = Array.isArray(editingProvider.type) ? editingProvider.type : (editingProvider.type ? [editingProvider.type] : []);
          if (currentTypes.length === 1 && typeof newBaseUrl === 'string') {
              newBaseUrl = { [currentTypes[0]]: newBaseUrl };
          } else {
              newBaseUrl = {};
          }
      } else {
          newBaseUrl = { ...newBaseUrl };
      }

      // Update or remove the URL for this API type
      if (url && url.trim()) {
          newBaseUrl[apiType] = url;
      } else {
          delete newBaseUrl[apiType];
      }

      // Infer types from the updated api_base_url
      const inferredTypes = inferProviderTypes(newBaseUrl);

      setEditingProvider({ ...editingProvider, type: inferredTypes, apiBaseUrl: newBaseUrl });
  };

  const getApiUrlValue = (apiType: string) => {
    if (typeof editingProvider.apiBaseUrl === 'string') {
        const types = Array.isArray(editingProvider.type) ? editingProvider.type : [editingProvider.type];
        if (types.includes(apiType) && types.length === 1) {
            return editingProvider.apiBaseUrl;
        }
        return '';
    }
    return (editingProvider.apiBaseUrl as any)?.[apiType] || '';
  };

  // Generic Key-Value pair helpers
  const addKV = (field: 'headers' | 'extraBody') => {
      const current = editingProvider[field] || {};
      setEditingProvider({
          ...editingProvider,
          [field]: { ...current, '': '' }
      });
  };

  const updateKV = (field: 'headers' | 'extraBody', oldKey: string, newKey: string, value: any) => {
      const current = { ...(editingProvider[field] || {}) };
      if (oldKey !== newKey) {
          delete current[oldKey];
      }
      current[newKey] = value;
      setEditingProvider({ ...editingProvider, [field]: current });
  };

  const removeKV = (field: 'headers' | 'extraBody', key: string) => {
      const current = { ...(editingProvider[field] || {}) };
      delete current[key];
      setEditingProvider({ ...editingProvider, [field]: current });
  };

  // Model Management
  const addModel = () => {
      const modelId = `model-${Date.now()}`;
      const newModels = { 
          ...(typeof editingProvider.models === 'object' && !Array.isArray(editingProvider.models) ? editingProvider.models : {}) 
      };
      newModels[modelId] = {
          pricing: { source: 'simple', input: 0, output: 0 },
          access_via: []
      };
      setEditingProvider({ ...editingProvider, models: newModels });
      setOpenModelIdx(modelId);
  };

  const updateModelId = (oldId: string, newId: string) => {
      if (oldId === newId) return;
      const models = { ...(editingProvider.models as Record<string, any>) };
      models[newId] = models[oldId];
      delete models[oldId];
      setEditingProvider({ ...editingProvider, models });
      if (openModelIdx === oldId) setOpenModelIdx(newId);
  };

  const updateModelConfig = (modelId: string, updates: any) => {
      const models = { ...(editingProvider.models as Record<string, any>) };
      models[modelId] = { ...models[modelId], ...updates };
      setEditingProvider({ ...editingProvider, models });
  };

  const removeModel = (modelId: string) => {
      const models = { ...(editingProvider.models as Record<string, any>) };
      delete models[modelId];
      setEditingProvider({ ...editingProvider, models });
  };

  // Generate default models URL from chat URL
  const generateModelsUrl = (): string => {
    const chatUrl = getApiUrlValue('chat');
    if (!chatUrl) return '';
    
    // Remove /chat/completions suffix and add /models
    const baseUrl = chatUrl.replace(/\/chat\/completions\/?$/, '');
    return `${baseUrl}/models`;
  };

  // Open fetch models modal
  const handleOpenFetchModels = () => {
    const defaultUrl = generateModelsUrl();
    setModelsUrl(defaultUrl);
    setFetchedModels([]);
    setSelectedModelIds(new Set());
    setFetchError(null);
    setIsFetchModelsModalOpen(true);
  };

  // Fetch models from URL
  const handleFetchModels = async () => {
    if (!modelsUrl) {
      setFetchError('Please enter a URL');
      return;
    }

    setIsFetchingModels(true);
    setFetchError(null);
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add Bearer token if available
      if (editingProvider.apiKey) {
        headers['Authorization'] = `Bearer ${editingProvider.apiKey}`;
      }

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format: expected { data: [...] }');
      }

      // Sort models alphabetically by ID
      const sortedModels = [...data.data].sort((a, b) => a.id.localeCompare(b.id));
      setFetchedModels(sortedModels);
      setSelectedModelIds(new Set());
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch models');
      setFetchedModels([]);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Toggle model selection
  const toggleModelSelection = (modelId: string) => {
    const newSelection = new Set(selectedModelIds);
    if (newSelection.has(modelId)) {
      newSelection.delete(modelId);
    } else {
      newSelection.add(modelId);
    }
    setSelectedModelIds(newSelection);
  };

  // Add selected models to provider
  const handleAddSelectedModels = () => {
    const models = { ...(typeof editingProvider.models === 'object' && !Array.isArray(editingProvider.models) ? editingProvider.models : {}) };
    
    fetchedModels.forEach(model => {
      if (selectedModelIds.has(model.id)) {
        // Only add if not already exists
        if (!models[model.id]) {
          models[model.id] = {
            pricing: { source: 'simple', input: 0, output: 0 },
            access_via: []
          };
        }
      }
    });

    setEditingProvider({ ...editingProvider, models });
    setIsFetchModelsModalOpen(false);
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
                <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Providers</h1>
                <p className="text-[15px] text-text-secondary m-0">Manage AI provider integrations.</p>
            </div>
            <Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Provider</Button>
        </div>
      </div>

      <Card title="Active Providers">
          <div className="overflow-x-auto -m-6">
              <table className="w-full border-collapse font-body text-[13px]">
                  <thead>
                      <tr>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>ID / Name</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">APIs</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                      </tr>
                  </thead>
                  <tbody>
                      {providers.map(p => (
                          <tr key={p.id} onClick={() => handleEdit(p)} style={{cursor: 'pointer'}} className="hover:bg-bg-hover">
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingLeft: '24px'}}>
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      <Edit2 size={12} style={{opacity: 0.5}} />
                                      <div style={{fontWeight: 600}}>{p.id}</div>
                                      <div style={{fontSize: '12px', color: 'var(--color-text-secondary)'}}>( {p.name} )</div>
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <div onClick={(e) => e.stopPropagation()}>
                                      <Switch 
                                        checked={p.enabled !== false} 
                                        onChange={(val) => handleToggleEnabled(p, val)} 
                                        size="sm"
                                      />
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <div style={{display: 'flex', gap: '4px'}}>
                                      {(Array.isArray(p.type) ? p.type : [p.type]).map(t => (
                                          <Badge 
                                            key={t} 
                                            status="connected" 
                                            style={{ ...getApiBadgeStyle(t), fontSize: '10px', padding: '2px 8px' }}
                                            className="[&_.connection-dot]:hidden"
                                          >
                                              {t}
                                          </Badge>
                                      ))}
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                                  <div style={{display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} style={{color: 'var(--color-danger)'}}><Trash2 size={14}/></Button>
                                  </div>
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={originalId ? `Edit Provider: ${originalId}` : "Add Provider"}
        size="lg"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} isLoading={isSaving}>Save Provider</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '-8px'}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '16px', alignItems: 'end'}}>
                  <Input
                    label="Unique ID"
                    value={editingProvider.id}
                    onChange={(e) => setEditingProvider({...editingProvider, id: e.target.value})}
                    placeholder="e.g. openai"
                    disabled={!!originalId}
                  />
                  <Input
                    label="Display Name"
                    value={editingProvider.name}
                    onChange={(e) => setEditingProvider({...editingProvider, name: e.target.value})}
                    placeholder="e.g. OpenAI Production"
                  />
                  <div className="flex flex-col gap-2">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Enabled</label>
                      <div style={{height: '38px', display: 'flex', alignItems: 'center'}}>
                          <Switch
                            checked={editingProvider.enabled !== false}
                            onChange={(checked) => setEditingProvider({...editingProvider, enabled: checked})}
                          />
                      </div>
                  </div>
              </div>

              {/* Separator */}
              <div style={{height: '1px', background: 'var(--color-border-glass)', margin: '4px 0'}} />

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px'}}>
                  {/* Left: APIs & Base URLs */}
                  <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Supported APIs & Base URLs</label>
                      <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '4px', fontStyle: 'italic'}}>
                          API types are automatically inferred from the URLs you provide.
                      </div>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--color-bg-subtle)', padding: '8px', borderRadius: 'var(--radius-md)'}}>
                          {KNOWN_APIS.map(apiType => {
                              const inferredTypes = inferProviderTypes(editingProvider.apiBaseUrl);
                              const isInferred = inferredTypes.includes(apiType);

                              return (
                                  <div key={apiType} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      <div style={{display: 'flex', alignItems: 'center', gap: '6px', width: '100px', flexShrink: 0}}>
                                          <Badge
                                            status={isInferred ? "connected" : "disconnected"}
                                            style={{ ...getApiBadgeStyle(apiType), fontSize: '10px', padding: '2px 8px', opacity: isInferred ? 1 : 0.5 }}
                                            className="[&_.connection-dot]:hidden"
                                          >
                                              {apiType}
                                          </Badge>
                                      </div>
                                      <div style={{flex: 1}}>
                                        <Input
                                            placeholder={`${apiType} URL`}
                                            value={getApiUrlValue(apiType)}
                                            onChange={(e) => updateApiUrl(apiType, e.target.value)}
                                        />
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>

                  {/* Right: Advanced Configuration */}
                  <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Advanced Configuration</label>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                          <div style={{width: '200px'}}>
                            <Input
                                label="Discount (0.0 - 1.0)"
                                type="number"
                                step="0.01"
                                min="0"
                                max="1"
                                value={editingProvider.discount || ''}
                                onChange={(e) => setEditingProvider({...editingProvider, discount: parseFloat(e.target.value)})}
                            />
                          </div>

                          <div className="flex items-center gap-2 py-2">
                              <Switch
                                checked={editingProvider.estimateTokens || false}
                                onChange={(checked) => setEditingProvider({...editingProvider, estimateTokens: checked})}
                              />
                              <div className="flex flex-col">
                                  <label className="font-body text-[13px] font-medium text-text">Estimate Tokens</label>
                                  <span className="font-body text-[11px] text-text-secondary">Enable token estimation for providers that don't return usage data</span>
                              </div>
                          </div>

                          <div>
                              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                                  <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Custom Headers</label>
                                  <Button size="sm" variant="secondary" onClick={() => addKV('headers')}><Plus size={14}/></Button>
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                  {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                                      <div key={idx} style={{display: 'flex', gap: '6px'}}>
                                          <Input placeholder="Header Name" value={key} onChange={(e) => updateKV('headers', key, e.target.value, val)} style={{flex: 1}}/>
                                          <Input placeholder="Value" value={typeof val === 'object' ? JSON.stringify(val) : val} onChange={(e) => {
                                                  const rawValue = e.target.value;
                                                  let parsedValue;
                                                  try {
                                                      parsedValue = JSON.parse(rawValue);
                                                  } catch {
                                                      parsedValue = rawValue;
                                                  }
                                                  updateKV('headers', key, key, parsedValue);
                                              }} style={{flex: 1}}/>
                                          <Button variant="ghost" size="sm" onClick={() => removeKV('headers', key)} style={{padding: '4px'}}><Trash2 size={14} style={{color: 'var(--color-danger)'}}/></Button>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div>
                              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                                  <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Extra Body Fields</label>
                                  <Button size="sm" variant="secondary" onClick={() => addKV('extraBody')}><Plus size={14}/></Button>
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                  {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                                      <div key={idx} style={{display: 'flex', gap: '6px'}}>
                                          <Input placeholder="Field Name" value={key} onChange={(e) => updateKV('extraBody', key, e.target.value, val)} style={{flex: 1}}/>
                                          <Input placeholder="Value" value={typeof val === 'object' ? JSON.stringify(val) : val} onChange={(e) => {
                                                  const rawValue = e.target.value;
                                                  let parsedValue;
                                                  try {
                                                      parsedValue = JSON.parse(rawValue);
                                                  } catch {
                                                      parsedValue = rawValue;
                                                  }
                                                  updateKV('extraBody', key, key, parsedValue);
                                              }} style={{flex: 1}}/>
                                          <Button variant="ghost" size="sm" onClick={() => removeKV('extraBody', key)} style={{padding: '4px'}}><Trash2 size={14} style={{color: 'var(--color-danger)'}}/></Button>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

              <Input
                label="API Key"
                type="password"
                value={editingProvider.apiKey}
                onChange={(e) => setEditingProvider({...editingProvider, apiKey: e.target.value})}
                placeholder="sk-..."
              />

              {/* Models Accordion */}
              <div className="border border-border-glass rounded-md">
                  <div
                    className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                    onClick={() => setIsModelsOpen(!isModelsOpen)}
                  >
                      {isModelsOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                      <span style={{fontWeight: 600, fontSize: '13px', flex: 1}}>Provider Models</span>
                      <Badge status="connected">{Object.keys(editingProvider.models || {}).length} Models</Badge>
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={(e) => { e.stopPropagation(); handleOpenFetchModels(); }}
                        leftIcon={<Download size={14}/>}
                        style={{marginLeft: '8px'}}
                      >
                        Fetch Models
                      </Button>
                  </div>
                  {isModelsOpen && (
                      <div style={{padding: '8px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-deep)'}}>
                          <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                              {Object.entries(editingProvider.models || {}).map(([mId, mCfg]: [string, any]) => (
                                  <div key={mId} style={{border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)'}}>
                                      <div
                                        style={{padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}
                                        onClick={() => setOpenModelIdx(openModelIdx === mId ? null : mId)}
                                      >
                                          {openModelIdx === mId ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                          <span style={{fontWeight: 600, fontSize: '12px', flex: 1}}>{mId}</span>
                                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeModel(mId); }} style={{color: 'var(--color-danger)', padding: '2px'}}><X size={12}/></Button>
                                      </div>
                                      {openModelIdx === mId && (
                                          <div style={{padding: '8px', borderTop: '1px solid var(--color-border-glass)', display: 'flex', flexDirection: 'column', gap: '6px'}}>
                                              <Input
                                                label="Model ID"
                                                value={mId}
                                                onChange={(e) => updateModelId(mId, e.target.value)}
                                              />

                                              <div className="grid gap-4 grid-cols-3">
                                                  <div className="flex flex-col gap-1">
                                                      <label className="font-body text-[13px] font-medium text-text-secondary">Model Type</label>
                                                      <select
                                                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                                        value={mCfg.type || 'chat'}
                                                          onChange={(e) => {
                                                          const newType = e.target.value as 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses';
                                                          // If switching to embeddings, clear non-embeddings APIs from access_via
                                                          if (newType === 'embeddings') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'embeddings');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['embeddings'] });
                                                          } else if (newType === 'transcriptions') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'transcriptions');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['transcriptions'] });
                                                          } else if (newType === 'speech') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'speech');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['speech'] });
                                                          } else if (newType === 'image') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'images');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['images'] });
                                                          } else if (newType === 'responses') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'responses');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['responses'] });
                                                          } else {
                                                            updateModelConfig(mId, { type: newType });
                                                          }
                                                        }}
                                                      >
                                                          <option value="chat">Chat</option>
                                                          <option value="embeddings">Embeddings</option>
                                                          <option value="transcriptions">Transcriptions</option>
                                                          <option value="speech">Speech</option>
                                                          <option value="image">Image</option>
                                                          <option value="responses">Responses</option>
                                                      </select>
                                                  </div>
                                                  <div className="flex flex-col gap-1">
                                                      <label className="font-body text-[13px] font-medium text-text-secondary">Pricing Source</label>
                                                      <select
                                                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                                        value={mCfg.pricing?.source || 'simple'}
                                                        onChange={(e) => {
                                                          const newSource = e.target.value;
                                                          let newPricing: any;
                                                          
                                                          // Create a clean pricing object based on the selected source
                                                          if (newSource === 'simple') {
                                                            newPricing = {
                                                              source: 'simple',
                                                              input: mCfg.pricing?.input || 0,
                                                              output: mCfg.pricing?.output || 0,
                                                              cached: mCfg.pricing?.cached || 0
                                                            };
                                                          } else if (newSource === 'openrouter') {
                                                            newPricing = {
                                                              source: 'openrouter',
                                                              slug: mCfg.pricing?.slug || '',
                                                              ...(mCfg.pricing?.discount !== undefined && { discount: mCfg.pricing.discount })
                                                            };
                                                          } else if (newSource === 'defined') {
                                                            newPricing = {
                                                              source: 'defined',
                                                              range: mCfg.pricing?.range || []
                                                            };
                                                          }
                                                          
                                                          updateModelConfig(mId, { pricing: newPricing });
                                                        }}
                                                      >
                                                          <option value="simple">Simple</option>
                                                          <option value="openrouter">OpenRouter</option>
                                                          <option value="defined">Ranges (Complex)</option>
                                                      </select>
                                                  </div>
                                                   {mCfg.type !== 'embeddings' && mCfg.type !== 'transcriptions' && mCfg.type !== 'speech' && mCfg.type !== 'image' && mCfg.type !== 'responses' && (
                                                       <div className="flex flex-col gap-1">
                                                           <label className="font-body text-[13px] font-medium text-text-secondary">Access Via (APIs)</label>
                                                           <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px'}}>
                                                               {KNOWN_APIS.map(apiType => {
                                                                     const isEmbeddingsModel = mCfg.type === 'embeddings';
                                                                     const isTranscriptionsModel = mCfg.type === 'transcriptions';
                                                                     const isSpeechModel = mCfg.type === 'speech';
                                                                     const isImageModel = mCfg.type === 'image';
                                                                     const isResponsesModel = mCfg.type === 'responses';
                                                                     const isDisabled = (isEmbeddingsModel && apiType !== 'embeddings') || (isTranscriptionsModel && apiType !== 'transcriptions') || (isSpeechModel && apiType !== 'speech') || (isImageModel && apiType !== 'images') || (isResponsesModel && apiType !== 'responses');
                                                                  
                                                                  return (
                                                                      <label key={apiType} style={{display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', opacity: isDisabled ? 0.4 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer'}}>
                                                                          <input 
                                                                            type="checkbox" 
                                                                            checked={(mCfg.access_via || []).includes(apiType)}
                                                                            disabled={isDisabled}
                                                                            onChange={() => {
                                                                                const current = mCfg.access_via || [];
                                                                                const next = current.includes(apiType) ? current.filter((a: string) => a !== apiType) : [...current, apiType];
                                                                                updateModelConfig(mId, { access_via: next });
                                                                            }}
                                                                          />
                                                                          <span className="inline-flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-medium" style={{ ...getApiBadgeStyle(apiType), fontSize: '10px', padding: '2px 6px', opacity: (mCfg.access_via || []).includes(apiType) ? 1 : 0.5 }}>
                                                                            {apiType}
                                                                          </span>
                                                                      </label>
                                                                  );
                                                              })}
                                                          </div>
                                                          {(!mCfg.access_via || mCfg.access_via.length === 0) && (
                                                              <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic'}}>
                                                                  No APIs selected. Defaults to ALL supported APIs.
                                                              </div>
                                                          )}
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'embeddings' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Embeddings models automatically use the 'embeddings' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'transcriptions' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Transcriptions models automatically use the 'transcriptions' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'speech' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Speech models automatically use the 'speech' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                   {mCfg.type === 'image' && (
                                                       <div className="flex flex-col gap-1">
                                                           <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                                <Info className="inline w-3 h-3 mb-0.5 mr-1" />Image models automatically use the 'images' API only.
                                                           </div>
                                                       </div>
                                                   )}
                                                   {mCfg.type === 'responses' && (
                                                       <div className="flex flex-col gap-1">
                                                           <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                                <Info className="inline w-3 h-3 mb-0.5 mr-1" />Responses models automatically use the 'responses' API only.
                                                           </div>
                                                       </div>
                                                   )}
                                              </div>

                                              {mCfg.pricing?.source === 'simple' && (
                                                  <div className="grid grid-cols-3 gap-4" style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)'}}>
                                                      <Input 
                                                        label="Input $/M" type="number" step="0.000001"
                                                        value={mCfg.pricing.input || 0}
                                                        onChange={(e) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, input: parseFloat(e.target.value) } })}
                                                      />
                                                      <Input 
                                                        label="Output $/M" type="number" step="0.000001"
                                                        value={mCfg.pricing.output || 0}
                                                        onChange={(e) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, output: parseFloat(e.target.value) } })}
                                                      />
                                                      <Input 
                                                        label="Cached $/M" type="number" step="0.000001"
                                                        value={mCfg.pricing.cached || 0}
                                                        onChange={(e) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, cached: parseFloat(e.target.value) } })}
                                                      />
                                                  </div>
                                              )}

                                              {mCfg.pricing?.source === 'openrouter' && (
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '12px', alignItems: 'end'}}>
                                                      <div style={{flex: '1'}}>
                                                          <OpenRouterSlugInput 
                                                            label="OpenRouter Model Slug" 
                                                            placeholder="e.g. anthropic/claude-3.5-sonnet or just 'claude-sonnet'"
                                                            value={mCfg.pricing.slug || ''}
                                                            onChange={(value) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, slug: value } })}
                                                          />
                                                      </div>
                                                      <div style={{width: '10%', minWidth: '80px'}}>
                                                          <Input 
                                                            label="Discount (0-1)"
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="1"
                                                            placeholder=""
                                                            value={mCfg.pricing.discount ?? ''}
                                                            onChange={(e) => {
                                                              const val = e.target.value;
                                                              if (val === '') {
                                                                const { discount, ...rest } = mCfg.pricing;
                                                                updateModelConfig(mId, { pricing: rest });
                                                              } else {
                                                                updateModelConfig(mId, { pricing: { ...mCfg.pricing, discount: parseFloat(val) } });
                                                              }
                                                            }}
                                                          />
                                                      </div>
                                                  </div>
                                              )}

                                              {mCfg.pricing?.source === 'defined' && (
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                                                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                          <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Pricing Ranges</label>
                                                          <Button size="sm" variant="secondary" onClick={() => {
                                                              const currentRanges = mCfg.pricing.range || [];
                                                              updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: [...currentRanges, { lower_bound: 0, upper_bound: 0, input_per_m: 0, output_per_m: 0 }] } });
                                                          }} leftIcon={<Plus size={14}/>}>Add Range</Button>
                                                      </div>
                                                      
                                                      {(mCfg.pricing.range || []).map((range: any, idx: number) => (
                                                          <div key={idx} style={{border: '1px solid var(--color-border-glass)', padding: '12px', borderRadius: 'var(--radius-sm)', position: 'relative'}}>
                                                              <Button 
                                                                size="sm" 
                                                                variant="ghost" 
                                                                style={{position: 'absolute', top: '8px', right: '8px', color: 'var(--color-danger)', padding: '4px'}}
                                                                onClick={() => {
                                                                    const newRanges = [...mCfg.pricing.range];
                                                                    newRanges.splice(idx, 1);
                                                                    updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                }}
                                                              >
                                                                  <X size={14}/>
                                                              </Button>
                                                              
                                                              <div className="grid gap-4 grid-cols-2" style={{marginBottom: '8px'}}>
                                                                  <Input 
                                                                    label="Lower Bound" type="number"
                                                                    value={range.lower_bound}
                                                                    onChange={(e) => {
                                                                        const newRanges = [...mCfg.pricing.range];
                                                                        newRanges[idx] = { ...range, lower_bound: parseFloat(e.target.value) };
                                                                        updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                    }}
                                                                  />
                                                                  <Input 
                                                                    label="Upper Bound (0 = Infinite)" type="number"
                                                                    value={range.upper_bound === Infinity ? 0 : range.upper_bound}
                                                                    onChange={(e) => {
                                                                        const val = parseFloat(e.target.value);
                                                                        const newRanges = [...mCfg.pricing.range];
                                                                        newRanges[idx] = { ...range, upper_bound: val === 0 ? Infinity : val };
                                                                        updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                    }}
                                                                  />
                                                              </div>
                                                              <div className="grid grid-cols-3 gap-4">
                                                                  <Input 
                                                                    label="Input $/M" type="number" step="0.000001"
                                                                    value={range.input_per_m}
                                                                    onChange={(e) => {
                                                                        const newRanges = [...mCfg.pricing.range];
                                                                        newRanges[idx] = { ...range, input_per_m: parseFloat(e.target.value) };
                                                                        updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                    }}
                                                                  />
                                                                  <Input 
                                                                    label="Output $/M" type="number" step="0.000001"
                                                                    value={range.output_per_m}
                                                                    onChange={(e) => {
                                                                        const newRanges = [...mCfg.pricing.range];
                                                                        newRanges[idx] = { ...range, output_per_m: parseFloat(e.target.value) };
                                                                        updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                    }}
                                                                  />
                                                                  <Input 
                                                                    label="Cached $/M" type="number" step="0.000001"
                                                                    value={range.cached_per_m || 0}
                                                                    onChange={(e) => {
                                                                        const newRanges = [...mCfg.pricing.range];
                                                                        newRanges[idx] = { ...range, cached_per_m: parseFloat(e.target.value) };
                                                                        updateModelConfig(mId, { pricing: { ...mCfg.pricing, range: newRanges } });
                                                                    }}
                                                                  />
                                                              </div>
                                                          </div>
                                                      ))}
                                                      {(!mCfg.pricing.range || mCfg.pricing.range.length === 0) && (
                                                          <div className="text-text-muted italic text-center text-sm p-4">No ranges defined. Pricing will likely default to 0.</div>
                                                      )}
                                                  </div>
                                              )}
                                          </div>
                                      )}
                                  </div>
                              ))}
                              <Button variant="secondary" size="sm" leftIcon={<Plus size={14}/>} onClick={addModel}>Add Model Mapping</Button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </Modal>

      {/* Fetch Models Modal */}
      <Modal
        isOpen={isFetchModelsModalOpen}
        onClose={() => setIsFetchModelsModalOpen(false)}
        title="Fetch Models from Provider"
        size="md"
        footer={
          <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
            <Button variant="ghost" onClick={() => setIsFetchModelsModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleAddSelectedModels} 
              disabled={selectedModelIds.size === 0}
            >
              Add {selectedModelIds.size} Model{selectedModelIds.size !== 1 ? 's' : ''}
            </Button>
          </div>
        }
      >
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          <div style={{display: 'flex', gap: '8px', alignItems: 'end'}}>
            <div style={{flex: 1}}>
              <Input
                label="Models Endpoint URL"
                value={modelsUrl}
                onChange={(e) => setModelsUrl(e.target.value)}
                placeholder="https://api.example.com/v1/models"
              />
            </div>
            <Button 
              onClick={handleFetchModels} 
              isLoading={isFetchingModels}
              leftIcon={<Download size={16}/>}
            >
              Fetch
            </Button>
          </div>

          {fetchError && (
            <div style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)',
              fontSize: '13px'
            }}>
              {fetchError}
            </div>
          )}

          {fetchedModels.length > 0 && (
            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Available Models ({fetchedModels.length})
                </label>
                <div style={{display: 'flex', gap: '8px'}}>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => setSelectedModelIds(new Set(fetchedModels.map(m => m.id)))}
                  >
                    Select All
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => setSelectedModelIds(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid var(--color-border-glass)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-deep)'
              }}>
                {fetchedModels.map((model) => {
                  const contextLengthK = model.context_length 
                    ? `${(model.context_length / 1000).toFixed(0)}K` 
                    : null;
                  
                  return (
                    <div
                      key={model.id}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid var(--color-border-glass)',
                        cursor: 'pointer',
                        background: selectedModelIds.has(model.id) ? 'var(--color-bg-hover)' : 'transparent',
                        transition: 'background 0.2s'
                      }}
                      onClick={() => toggleModelSelection(model.id)}
                      className="hover:bg-bg-hover"
                    >
                      <div style={{display: 'flex', alignItems: 'start', gap: '12px'}}>
                        <input
                          type="checkbox"
                          checked={selectedModelIds.has(model.id)}
                          onChange={() => toggleModelSelection(model.id)}
                          style={{marginTop: '2px', cursor: 'pointer'}}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div style={{flex: 1}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}>
                            <span style={{fontWeight: 600, fontSize: '13px', color: 'var(--color-text)'}}>
                              {model.id}
                            </span>
                            {contextLengthK && (
                              <Badge status="connected" style={{fontSize: '10px', padding: '2px 6px'}}>
                                {contextLengthK}
                              </Badge>
                            )}
                          </div>
                          {model.name && model.name !== model.id && (
                            <div style={{fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '2px'}}>
                              {model.name}
                            </div>
                          )}
                          {model.description && (
                            <div style={{fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: '1.4'}}>
                              {model.description.length > 150 
                                ? `${model.description.substring(0, 150)}...` 
                                : model.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isFetchingModels && fetchedModels.length === 0 && !fetchError && (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: '13px',
              fontStyle: 'italic'
            }}>
              Enter a URL and click Fetch to load available models
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};