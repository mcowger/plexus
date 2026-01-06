import { useEffect, useState } from 'react';
import { api, Alias, Provider, Model } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Search, Plus, Trash2, Edit2 } from 'lucide-react';

const EMPTY_ALIAS: Alias = {
    id: '',
    aliases: [],
    selector: 'random',
    priority: 'selector',
    targets: []
};

export const Models = () => {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [search, setSearch] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<Alias>(EMPTY_ALIAS);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
        const [a, p, m] = await Promise.all([
            api.getAliases(),
            api.getProviders(),
            api.getModels()
        ]);
        setAliases(a);
        setProviders(p);
        setAvailableModels(m);
    } catch (e) {
        console.error("Failed to load data", e);
    }
  };

  const handleEdit = (alias: Alias) => {
      setOriginalId(alias.id);
      // Deep copy to avoid mutating state directly
      setEditingAlias(JSON.parse(JSON.stringify(alias)));
      setIsModalOpen(true);
  };

  const handleAddNew = () => {
      setOriginalId(null);
      setEditingAlias({ ...EMPTY_ALIAS, targets: [] });
      setIsModalOpen(true);
  };

  const handleSave = async () => {
      if (!editingAlias.id) return;
      
      setIsSaving(true);
      try {
          await api.saveAlias(editingAlias, originalId || undefined);
          await loadData();
          setIsModalOpen(false);
      } catch (e) {
          console.error("Failed to save alias", e);
          alert("Failed to save alias");
      } finally {
          setIsSaving(false);
      }
  };

  const updateTarget = (index: number, field: 'provider' | 'model', value: string) => {
      const newTargets = [...editingAlias.targets];
      // When provider changes, clear model
      if (field === 'provider') {
          newTargets[index] = { provider: value, model: '' };
      } else {
          newTargets[index] = { ...newTargets[index], [field]: value };
      }
      setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const addTarget = () => {
      setEditingAlias({
          ...editingAlias,
          targets: [...editingAlias.targets, { provider: '', model: '' }]
      });
  };

  const removeTarget = (index: number) => {
      const newTargets = [...editingAlias.targets];
      newTargets.splice(index, 1);
      setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const addAlias = () => {
      setEditingAlias({
          ...editingAlias,
          aliases: [...(editingAlias.aliases || []), '']
      });
  };

  const updateAlias = (index: number, value: string) => {
      const newAliases = [...(editingAlias.aliases || [])];
      newAliases[index] = value;
      setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  const removeAlias = (index: number) => {
      const newAliases = [...(editingAlias.aliases || [])];
      newAliases.splice(index, 1);
      setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  const filteredAliases = aliases.filter(a => a.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
                <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Models</h1>
                <p className="text-[15px] text-text-secondary m-0">Available AI models across providers.</p>
            </div>
            <Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Model</Button>
        </div>
      </div>

      <Card className="mb-6">
           <div style={{position: 'relative'}}>
              <Search size={16} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}} />
              <Input 
                placeholder="Search models..." 
                style={{paddingLeft: '36px'}}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
      </Card>

      <Card title="Model Aliases" className="mb-6">
        <div className="overflow-x-auto -m-6">
            <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                    <tr>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Alias</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Aliases</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Selector</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px'}}>Targets</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAliases.map(alias => (
                        <tr key={alias.id} onClick={() => handleEdit(alias)} style={{cursor: 'pointer'}} className="hover:bg-bg-hover">
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{fontWeight: 600, paddingLeft: '24px'}}>
                                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                    <Edit2 size={12} style={{opacity: 0.5}} />
                                    {alias.id}
                                </div>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                {alias.aliases && alias.aliases.length > 0 ? (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                                        {alias.aliases.map(a => (
                                            <span key={a} className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border border-border-glass text-text-secondary" style={{fontSize: '10px'}}>
                                                {a}
                                            </span>
                                        ))}
                                    </div>
                                ) : <span style={{color: 'var(--color-text-secondary)', fontSize: '12px'}}>-</span>}
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border border-border-glass text-text-secondary" style={{fontSize: '11px', textTransform: 'capitalize'}}>
                                    {alias.selector || 'random'} / {alias.priority || 'selector'}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px'}}>
                                {alias.targets.map((t, i) => {
                                    const provider = providers.find(p => p.id === t.provider);
                                    const isDisabled = provider?.enabled === false;
                                    return (
                                        <div key={i} style={{
                                            fontSize: '12px', 
                                            color: isDisabled ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                                            textDecoration: isDisabled ? 'line-through' : 'none',
                                            opacity: isDisabled ? 0.7 : 1
                                        }}>
                                            {t.provider} &rarr; {t.model} {isDisabled && <span style={{textDecoration: 'none', display: 'inline-block', marginLeft: '4px', fontStyle: 'italic'}}>(provider disabled)</span>}
                                        </div>
                                    );
                                })}
                            </td>
                        </tr>
                    ))}
                    {filteredAliases.length === 0 && (
                        <tr>
                            <td colSpan={4} className="text-center text-text-muted p-12">No aliases found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </Card>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={originalId ? "Edit Model" : "Add Model"}
        size="lg"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} isLoading={isSaving}>Save Changes</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div className="grid grid-cols-2 gap-4">
                  <Input 
                    label="Primary Name (ID)" 
                    value={editingAlias.id} 
                    onChange={(e) => setEditingAlias({...editingAlias, id: e.target.value})}
                    placeholder="e.g. gpt-4-turbo"
                  />
                  
                  <div className="flex flex-col gap-2">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Selector Strategy</label>
                      <select 
                        className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" 
                        value={editingAlias.selector || 'random'}
                        onChange={(e) => setEditingAlias({...editingAlias, selector: e.target.value})}
                      >
                          <option value="random">Random</option>
                          <option value="cost">Lowest Cost</option>
                          <option value="latency">Lowest Latency</option>
                          <option value="usage">Usage Balanced</option>
                          <option value="performance">Best Performance</option>
                      </select>
                  </div>
              </div>

               <div className="flex flex-col gap-2">
                  <label className="font-body text-[13px] font-medium text-text-secondary">Priority</label>
                  <select 
                    className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" 
                    value={editingAlias.priority || 'selector'}
                    onChange={(e) => setEditingAlias({...editingAlias, priority: e.target.value as any})}
                  >
                      <option value="selector">Selector (Use strategy)</option>
                      <option value="api_match">API Match (Prioritize incoming API format)</option>
                  </select>
                  <p className="text-xs text-text-muted mt-1">"Selector" uses the strategy defined above. "API Match" tries to match the provider type to the incoming request format (e.g. OpenAI &rarr; OpenAI).</p>
              </div>

              <div className="h-px bg-border-glass my-4" style={{margin: '8px 0', borderBottom: '1px solid var(--color-border)'}}></div>

              <div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                      <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Additional Aliases</label>
                      <Button size="sm" variant="secondary" onClick={addAlias} leftIcon={<Plus size={14}/>}>Add Alias</Button>
                  </div>
                  
                  {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
                      <div className="text-text-muted italic text-center text-sm p-4">No additional aliases</div>
                  )}

                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                      {editingAlias.aliases?.map((alias, idx) => (
                          <div key={idx} style={{display: 'flex', gap: '8px'}}>
                              <Input 
                                value={alias} 
                                onChange={(e) => updateAlias(idx, e.target.value)}
                                placeholder="e.g. gpt4"
                                style={{flex: 1}}
                              />
                              <Button variant="ghost" size="sm" onClick={() => removeAlias(idx)} style={{color: 'var(--color-danger)'}}>
                                  <Trash2 size={16} />
                              </Button>
                          </div>
                      ))}
                  </div>
              </div>

              <div className="h-px bg-border-glass my-4" style={{margin: '8px 0', borderBottom: '1px solid var(--color-border)'}}></div>

              <div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                      <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Targets</label>
                      <Button size="sm" variant="secondary" onClick={addTarget} leftIcon={<Plus size={14}/>}>Add Target</Button>
                  </div>
                  
                  {editingAlias.targets.length === 0 && (
                       <div className="text-text-muted italic text-center text-sm p-4">No targets configured (Model will not work)</div>
                  )}

                  <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                      {editingAlias.targets.map((target, idx) => (
                          <Card key={idx} style={{padding: '12px', backgroundColor: 'var(--color-bg-subtle)'}}>
                              <div style={{display: 'flex', gap: '12px', alignItems: 'flex-start'}}>
                                  <div style={{flex: 1}}>
                                      <label className="font-body text-[13px] font-medium text-text-secondary" style={{fontSize: '11px'}}>Provider</label>
                                      <select 
                                        className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" 
                                        value={target.provider}
                                        onChange={(e) => updateTarget(idx, 'provider', e.target.value)}
                                      >
                                          <option value="">Select Provider...</option>
                                          {providers.map(p => (
                                              <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                                          ))}
                                      </select>
                                  </div>
                                  <div style={{flex: 1}}>
                                      <label className="font-body text-[13px] font-medium text-text-secondary" style={{fontSize: '11px'}}>Model</label>
                                      <select 
                                        className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" 
                                        value={target.model}
                                        onChange={(e) => updateTarget(idx, 'model', e.target.value)}
                                        disabled={!target.provider}
                                      >
                                          <option value="">Select Model...</option>
                                          {availableModels
                                            .filter(m => m.providerId === target.provider)
                                            .map(m => (
                                              <option key={m.id} value={m.id}>{m.name}</option>
                                          ))}
                                      </select>
                                  </div>
                                  <div style={{marginTop: '24px'}}>
                                      <Button variant="ghost" size="sm" onClick={() => removeTarget(idx)} style={{color: 'var(--color-danger)'}}>
                                          <Trash2 size={16} />
                                      </Button>
                                  </div>
                              </div>
                          </Card>
                      ))}
                  </div>
              </div>
          </div>
      </Modal>
    </div>
  );
};