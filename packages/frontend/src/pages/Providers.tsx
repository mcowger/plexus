import { useEffect, useState } from 'react';
import { api, Provider, Cooldown } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Plus, Edit2, Trash2, AlertTriangle, ChevronDown, ChevronRight, X } from 'lucide-react';

const KNOWN_APIS = ['chat', 'messages', 'gemini'];

const getApiBadgeStyle = (apiType: string): React.CSSProperties => {
    switch (apiType.toLowerCase()) {
        case 'messages':
            return { backgroundColor: '#D97757', color: 'white', border: 'none' };
        case 'chat':
            return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
        case 'gemini':
            return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
        default:
            return {};
    }
};

const EMPTY_PROVIDER: Provider = {
    id: '',
    name: '',
    type: [],
    apiKey: '',
    enabled: true,
    apiBaseUrl: {},
    headers: {},
    extraBody: {},
    models: {}
};

export const Providers = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider>(EMPTY_PROVIDER);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Accordion state for Modal
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [openModelIdx, setOpenModelIdx] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
        const [p, c] = await Promise.all([
            api.getProviders(),
            api.getCooldowns()
        ]);
        setProviders(p);
        setCooldowns(c);
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

  const toggleApi = (apiType: string) => {
      const currentTypes = Array.isArray(editingProvider.type) ? editingProvider.type : (editingProvider.type ? [editingProvider.type] : []);
      const idx = currentTypes.indexOf(apiType);
      
      let newBaseUrl: any = editingProvider.apiBaseUrl;
      
      // Normalize apiBaseUrl to object if we are modifying it
      if (typeof newBaseUrl !== 'object' || newBaseUrl === null) {
          if (currentTypes.length === 1 && typeof newBaseUrl === 'string') {
               newBaseUrl = { [currentTypes[0]]: newBaseUrl };
          } else {
               newBaseUrl = {};
          }
      } else {
          newBaseUrl = { ...newBaseUrl };
      }

      const newTypes = [...currentTypes];
      if (idx > -1) {
          newTypes.splice(idx, 1);
          delete newBaseUrl[apiType];
      } else {
          newTypes.push(apiType);
      }
      setEditingProvider({ ...editingProvider, type: newTypes, apiBaseUrl: newBaseUrl });
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
      
      newBaseUrl[apiType] = url;
      setEditingProvider({ ...editingProvider, apiBaseUrl: newBaseUrl });
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

  return (
    <div className="dashboard">
      <div className="page-header">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
                <h1 className="page-title">Providers</h1>
                <p className="page-description">Manage AI provider integrations.</p>
            </div>
            <Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Provider</Button>
        </div>
      </div>

      <Card title="Active Providers">
          <div className="table-wrapper">
              <table className="data-table">
                  <thead>
                      <tr>
                          <th style={{paddingLeft: '24px'}}>ID / Name</th>
                          <th>APIs</th>
                          <th style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                      </tr>
                  </thead>
                  <tbody>
                      {providers.map(p => (
                          <tr key={p.id} onClick={() => handleEdit(p)} style={{cursor: 'pointer'}}>
                              <td style={{paddingLeft: '24px'}}>
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      <Edit2 size={12} style={{opacity: 0.5}} />
                                      <div style={{fontWeight: 600}}>{p.id}</div>
                                      <div style={{fontSize: '12px', color: 'var(--color-text-secondary)'}}>( {p.name} )</div>
                                  </div>
                              </td>
                              <td>
                                  <div style={{display: 'flex', gap: '4px'}}>
                                      {(Array.isArray(p.type) ? p.type : [p.type]).map(t => (
                                          <Badge 
                                            key={t} 
                                            status="connected" 
                                            style={{ ...getApiBadgeStyle(t), fontSize: '10px', padding: '2px 8px' }}
                                            className="api-badge-no-dot"
                                          >
                                              {t}
                                          </Badge>
                                      ))}
                                  </div>
                              </td>
                              <td style={{paddingRight: '24px', textAlign: 'right'}}>
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
          <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
              <div className="grid-2">
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
              </div>

              <div className="input-wrapper">
                  <label className="input-label">Supported APIs & Base URLs</label>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--color-bg-subtle)', padding: '16px', borderRadius: 'var(--radius-md)'}}>
                      {KNOWN_APIS.map(apiType => {
                          const isEnabled = (Array.isArray(editingProvider.type) ? editingProvider.type : [editingProvider.type]).includes(apiType);
                          return (
                              <div key={apiType} style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', width: '100px', flexShrink: 0}}>
                                      <input 
                                        type="checkbox" 
                                        checked={isEnabled} 
                                        onChange={() => toggleApi(apiType)}
                                      />
                                      <span style={{fontSize: '13px', fontWeight: 600, textTransform: 'capitalize'}}>{apiType}</span>
                                  </div>
                                  <div style={{flex: 1}}>
                                    <Input 
                                        placeholder={`${apiType} API Base URL (optional)`}
                                        disabled={!isEnabled}
                                        value={getApiUrlValue(apiType)}
                                        onChange={(e) => updateApiUrl(apiType, e.target.value)}
                                    />
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </div>

              <Input 
                label="API Key" 
                type="password" 
                value={editingProvider.apiKey} 
                onChange={(e) => setEditingProvider({...editingProvider, apiKey: e.target.value})}
                placeholder="sk-..."
              />

              {/* Advanced Accordion */}
              <div className="accordion-item" style={{border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-md)'}}>
                  <div 
                    className="accordion-header" 
                    onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                    style={{padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: 'var(--color-bg-hover)'}}
                  >
                      {isAdvancedOpen ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                      <span style={{fontWeight: 600, fontSize: '14px'}}>Advanced Configuration</span>
                  </div>
                  {isAdvancedOpen && (
                      <div style={{padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', borderTop: '1px solid var(--color-border-glass)'}}>
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

                          <div>
                              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                                  <label className="input-label" style={{marginBottom: 0}}>Custom Headers</label>
                                  <Button size="sm" variant="secondary" onClick={() => addKV('headers')}><Plus size={14}/></Button>
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                                  {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                                      <div key={idx} style={{display: 'flex', gap: '8px'}}>
                                          <Input placeholder="Header Name" value={key} onChange={(e) => updateKV('headers', key, e.target.value, val)} style={{flex: 1}}/>
                                          <Input placeholder="Value" value={val} onChange={(e) => updateKV('headers', key, key, e.target.value)} style={{flex: 1}}/>
                                          <Button variant="ghost" size="sm" onClick={() => removeKV('headers', key)}><Trash2 size={16} style={{color: 'var(--color-danger)'}}/></Button>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div>
                              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                                  <label className="input-label" style={{marginBottom: 0}}>Extra Body Fields</label>
                                  <Button size="sm" variant="secondary" onClick={() => addKV('extraBody')}><Plus size={14}/></Button>
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                                  {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                                      <div key={idx} style={{display: 'flex', gap: '8px'}}>
                                          <Input placeholder="Field Name" value={key} onChange={(e) => updateKV('extraBody', key, e.target.value, val)} style={{flex: 1}}/>
                                          <Input placeholder="Value" value={val} onChange={(e) => updateKV('extraBody', key, key, e.target.value)} style={{flex: 1}}/>
                                          <Button variant="ghost" size="sm" onClick={() => removeKV('extraBody', key)}><Trash2 size={16} style={{color: 'var(--color-danger)'}}/></Button>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                  )}
              </div>

              {/* Models Accordion */}
              <div className="accordion-item" style={{border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-md)'}}>
                  <div 
                    className="accordion-header" 
                    onClick={() => setIsModelsOpen(!isModelsOpen)}
                    style={{padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: 'var(--color-bg-hover)'}}
                  >
                      {isModelsOpen ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                      <span style={{fontWeight: 600, fontSize: '14px', flex: 1}}>Provider Models</span>
                      <Badge status="connected">{Object.keys(editingProvider.models || {}).length} Models</Badge>
                  </div>
                  {isModelsOpen && (
                      <div style={{padding: '16px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-deep)'}}>
                          <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                              {Object.entries(editingProvider.models || {}).map(([mId, mCfg]: [string, any]) => (
                                  <div key={mId} style={{border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)'}}>
                                      <div 
                                        style={{padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer'}}
                                        onClick={() => setOpenModelIdx(openModelIdx === mId ? null : mId)}
                                      >
                                          {openModelIdx === mId ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                          <span style={{fontWeight: 600, fontSize: '13px', flex: 1}}>{mId}</span>
                                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeModel(mId); }} style={{color: 'var(--color-danger)', padding: '4px'}}><X size={14}/></Button>
                                      </div>
                                      {openModelIdx === mId && (
                                          <div style={{padding: '16px', borderTop: '1px solid var(--color-border-glass)', display: 'flex', flexDirection: 'column', gap: '16px'}}>
                                              <Input 
                                                label="Model ID" 
                                                value={mId} 
                                                onChange={(e) => updateModelId(mId, e.target.value)}
                                              />
                                              
                                              <div className="grid-2">
                                                  <div className="input-wrapper">
                                                      <label className="input-label">Pricing Source</label>
                                                      <select 
                                                        className="input-field"
                                                        value={mCfg.pricing?.source || 'simple'}
                                                        onChange={(e) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, source: e.target.value } })}
                                                      >
                                                          <option value="simple">Simple</option>
                                                          <option value="openrouter">OpenRouter</option>
                                                          <option value="defined">Ranges (Complex)</option>
                                                      </select>
                                                  </div>
                                                  <div className="input-wrapper">
                                                      <label className="input-label">Access Via (APIs)</label>
                                                      <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px'}}>
                                                          {KNOWN_APIS.map(apiType => (
                                                              <label key={apiType} style={{display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px'}}>
                                                                  <input 
                                                                    type="checkbox" 
                                                                    checked={(mCfg.access_via || []).includes(apiType)}
                                                                    onChange={() => {
                                                                        const current = mCfg.access_via || [];
                                                                        const next = current.includes(apiType) ? current.filter((a: string) => a !== apiType) : [...current, apiType];
                                                                        updateModelConfig(mId, { access_via: next });
                                                                    }}
                                                                  />
                                                                  <span className="badge" style={{ ...getApiBadgeStyle(apiType), fontSize: '10px', padding: '2px 6px', opacity: (mCfg.access_via || []).includes(apiType) ? 1 : 0.5 }}>
                                                                    {apiType}
                                                                  </span>
                                                              </label>
                                                          ))}
                                                      </div>
                                                      {(!mCfg.access_via || mCfg.access_via.length === 0) && (
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic'}}>
                                                              No APIs selected. Defaults to ALL supported APIs.
                                                          </div>
                                                      )}
                                                  </div>
                                              </div>

                                              {mCfg.pricing?.source === 'simple' && (
                                                  <div className="grid-3" style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)'}}>
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
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)'}}>
                                                      <Input 
                                                        label="OpenRouter Model Slug" 
                                                        placeholder="e.g. anthropic/claude-3-opus"
                                                        value={mCfg.pricing.slug || ''}
                                                        onChange={(e) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, slug: e.target.value } })}
                                                      />
                                                  </div>
                                              )}

                                              {mCfg.pricing?.source === 'defined' && (
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                                                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                          <label className="input-label" style={{marginBottom: 0}}>Pricing Ranges</label>
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
                                                              
                                                              <div className="grid-2" style={{marginBottom: '8px'}}>
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
                                                              <div className="grid-3">
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
                                                          <div className="empty-state-sm">No ranges defined. Pricing will likely default to 0.</div>
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
    </div>
  );
};