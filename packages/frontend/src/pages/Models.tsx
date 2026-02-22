import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api, Alias, AliasMetadata, AliasBehavior, Provider, Model, Cooldown } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { Search, Plus, Trash2, Edit2, GripVertical, Play, CheckCircle, XCircle, Loader2, Clock, Zap, ChevronDown, ChevronRight, BookOpen, X } from 'lucide-react';

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
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [search, setSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<Alias>(EMPTY_ALIAS);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);

  // Metadata search state
  const [metadataQuery, setMetadataQuery] = useState('');
  const [metadataResults, setMetadataResults] = useState<{ id: string; name: string }[]>([]);
  const [isMetadataSearching, setIsMetadataSearching] = useState(false);
  const [showMetadataDropdown, setShowMetadataDropdown] = useState(false);
  const metadataSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Delete Confirmation State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [aliasToDelete, setAliasToDelete] = useState<Alias | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Auto Add Modal State
  const [isAutoAddModalOpen, setIsAutoAddModalOpen] = useState(false);
  const [substring, setSubstring] = useState('');
  const [filteredModels, setFilteredModels] = useState<Array<{ model: Model; provider: Provider }>>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  // Test State - track by alias id + target index
  const [testStates, setTestStates] = useState<Record<string, { loading: boolean; result?: 'success' | 'error'; message?: string; showResult: boolean }>>({});

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Poll every 10s for cooldowns
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
        const [a, p, m, c] = await Promise.all([
            api.getAliases(),
            api.getProviders(),
            api.getModels(),
            api.getCooldowns()
        ]);
        setAliases(a);
        setProviders(p);
        setAvailableModels(m);
        setCooldowns(c);
    } catch (e) {
        console.error("Failed to load data", e);
    }
  };

  const handleEdit = (alias: Alias) => {
      setOriginalId(alias.id);
      // Deep copy to avoid mutating state directly
      setEditingAlias(JSON.parse(JSON.stringify(alias)));
      // Reset metadata search UI state; populate search box if metadata is already configured
      setMetadataQuery(alias.metadata?.source_path ?? '');
      setMetadataResults([]);
      setShowMetadataDropdown(false);
      setIsModalOpen(true);
  };

  const handleAddNew = () => {
      setOriginalId(null);
      setEditingAlias({ ...EMPTY_ALIAS, targets: [] });
      setMetadataQuery('');
      setMetadataResults([]);
      setShowMetadataDropdown(false);
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

  const handleDeleteClick = (alias: Alias) => {
      setAliasToDelete(alias);
      setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
      if (!aliasToDelete) return;

      setIsDeleting(true);
      try {
          await api.deleteAlias(aliasToDelete.id);
          await loadData();
          setIsDeleteModalOpen(false);
          setAliasToDelete(null);
      } catch (e) {
          console.error("Failed to delete alias", e);
          alert("Failed to delete alias");
      } finally {
          setIsDeleting(false);
      }
  };

  const handleConfirmDeleteAll = async () => {
      setIsDeletingAll(true);
      try {
          await api.deleteAllAliases();
          await loadData();
          setIsDeleteAllModalOpen(false);
      } catch (e) {
          console.error("Failed to delete all aliases", e);
          alert("Failed to delete all aliases");
      } finally {
          setIsDeletingAll(false);
      }
  };

  const handleToggleTarget = async (alias: Alias, targetIndex: number, newState: boolean) => {
      // Create a copy of the alias with updated target
      const updatedAlias = JSON.parse(JSON.stringify(alias));
      updatedAlias.targets[targetIndex].enabled = newState;

      // Update local state immediately for responsiveness
      const updatedAliases = aliases.map(a => a.id === alias.id ? updatedAlias : a);
      setAliases(updatedAliases);

      try {
          await api.saveAlias(updatedAlias, alias.id);
      } catch (e) {
          console.error("Toggle error", e);
          alert("Failed to update target status: " + e);
          loadData(); // Reload on error
      }
  };

  const handleTestTarget = async (aliasId: string, targetIndex: number, provider: string, model: string, apiTypes: string[]) => {
      const testKey = `${aliasId}-${targetIndex}`;

      // Set loading state
      setTestStates(prev => ({
          ...prev,
          [testKey]: { loading: true, showResult: true }
      }));

      try {
          // Test each supported API type
          const results = await Promise.all(
              apiTypes.map(apiType => api.testModel(provider, model, apiType))
          );

          // Check if all tests succeeded
          const allSuccess = results.every(r => r.success);
          const firstError = results.find(r => !r.success);

          // Calculate total duration
          const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
          const avgDuration = Math.round(totalDuration / results.length);

          setTestStates(prev => ({
              ...prev,
              [testKey]: {
                  loading: false,
                  result: allSuccess ? 'success' : 'error',
                  message: allSuccess
                      ? `Success (${avgDuration}ms avg, ${apiTypes.length} API${apiTypes.length > 1 ? 's' : ''})`
                      : `Failed via ${firstError?.apiType || 'unknown'}: ${firstError?.error || 'Test failed'}`,
                  showResult: true
              }
          }));

          // Auto-hide success results after 3 seconds
          if (allSuccess) {
              setTimeout(() => {
                  setTestStates(prev => ({
                      ...prev,
                      [testKey]: { ...prev[testKey], showResult: false }
                  }));
              }, 3000);
          }
      } catch (e) {
          console.error("Test error", e);
          setTestStates(prev => ({
              ...prev,
              [testKey]: {
                  loading: false,
                  result: 'error',
                  message: String(e),
                  showResult: true
              }
          }));
      }
  };

  const updateTarget = (index: number, field: 'provider' | 'model' | 'enabled', value: string | boolean) => {
      const newTargets = [...editingAlias.targets];
      // When provider changes, clear model
      if (field === 'provider') {
          newTargets[index] = { provider: value as string, model: '', enabled: newTargets[index].enabled };
      } else if (field === 'enabled') {
          newTargets[index] = { ...newTargets[index], enabled: value as boolean };
      } else if (field === 'model') {
          newTargets[index] = { ...newTargets[index], model: value as string };
      }
      setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const addTarget = () => {
      setEditingAlias({
          ...editingAlias,
          targets: [...editingAlias.targets, { provider: '', model: '', enabled: true }]
      });
  };

  const removeTarget = (index: number) => {
      const newTargets = [...editingAlias.targets];
      newTargets.splice(index, 1);
      setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const handleOpenAutoAdd = () => {
      setSubstring(editingAlias.id || '');
      setFilteredModels([]);
      setSelectedModels(new Set());
      setIsAutoAddModalOpen(true);
  };

  const handleSearchModels = () => {
      if (!substring.trim()) {
          setFilteredModels([]);
          return;
      }

      const searchLower = substring.toLowerCase();

      const matches: Array<{ model: Model; provider: Provider }> = [];
      availableModels.forEach(model => {
          const provider = providers.find(p => p.id === model.providerId);
          if (provider && (model.name.toLowerCase().includes(searchLower) || provider.name.toLowerCase().includes(searchLower))) {
              matches.push({ model, provider: { ...provider } });
          }
      });

      setFilteredModels(matches);
  };

  const handleToggleModelSelection = (modelId: string, providerId: string) => {
      const key = `${providerId}|${modelId}`;
      const newSelection = new Set(selectedModels);
      if (newSelection.has(key)) {
          newSelection.delete(key);
      } else {
          newSelection.add(key);
      }
      setSelectedModels(newSelection);
  };

  const handleAddSelectedModels = () => {
      const newTargets = [...editingAlias.targets];

      selectedModels.forEach(key => {
          const separatorIndex = key.indexOf('|');
          const providerId = key.substring(0, separatorIndex);
          const modelId = key.substring(separatorIndex + 1);
          const provider = providers.find(p => p.id === providerId);
          const model = availableModels.find(m => m.id === modelId && m.providerId === providerId);

          if (provider && model) {
              const alreadyExists = editingAlias.targets.some(t => t.provider === providerId && t.model === modelId);
              if (!alreadyExists) {
                  newTargets.push({
                      provider: providerId,
                      model: modelId,
                      enabled: true
                  });
              }
          }
      });

      setEditingAlias({ ...editingAlias, targets: newTargets });
      setIsAutoAddModalOpen(false);
      setSubstring('');
      setFilteredModels([]);
      setSelectedModels(new Set());
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

  /** Returns the current `enabled` state of a named behavior, defaulting to false. */
  const getBehavior = (type: AliasBehavior['type']): boolean => {
      return (editingAlias.advanced ?? []).some(b => b.type === type && b.enabled !== false);
  };

  /** Toggles a behavior on/off, adding it to the list if not present. */
  const setBehavior = (type: AliasBehavior['type'], enabled: boolean) => {
      const current = editingAlias.advanced ?? [];
      const without = current.filter(b => b.type !== type);
      const next: AliasBehavior[] = enabled
          ? [...without, { type, enabled: true } as AliasBehavior]
          : without; // remove entirely when disabled to keep YAML clean
      setEditingAlias({ ...editingAlias, advanced: next });
  };

  /** Search metadata catalog for autocomplete */
  const handleMetadataSearch = useCallback((query: string, source: AliasMetadata['source']) => {
      setMetadataQuery(query);
      if (metadataSearchRef.current) clearTimeout(metadataSearchRef.current);
    if (!query.trim()) {
          setMetadataResults([]);
          setShowMetadataDropdown(false);
          return;
      }
      setIsMetadataSearching(true);
      setShowMetadataDropdown(true);
      metadataSearchRef.current = setTimeout(async () => {
          try {
              const resp = await api.searchModelMetadata(source, query, 30);
              setMetadataResults(resp.data);
          } catch {
              setMetadataResults([]);
     } finally {
              setIsMetadataSearching(false);
          }
      }, 250);
  }, []);

  /** Select a metadata result and set it on the alias */
  const selectMetadataResult = (result: { id: string; name: string }) => {
      const source = editingAlias.metadata?.source ?? 'openrouter';
      setEditingAlias({
          ...editingAlias,
          metadata: { source, source_path: result.id }
      });
      setMetadataQuery(result.name);
      setShowMetadataDropdown(false);
      setMetadataResults([]);
  };

  /** Clear metadata from the alias */
  const clearMetadata = () => {
      const { metadata: _removed, ...rest } = editingAlias;
      setEditingAlias(rest as Alias);
      setMetadataQuery('');
   setShowMetadataDropdown(false);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
      e.preventDefault();
      const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);

      if (dragIndex === dropIndex) return;

      const newTargets = [...editingAlias.targets];
      const [draggedItem] = newTargets.splice(dragIndex, 1);
      newTargets.splice(dropIndex, 0, draggedItem);

      setEditingAlias({ ...editingAlias, targets: newTargets });
  };

  const filteredAliases = aliases.filter(a => a.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-6">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h1 className="font-heading text-3xl font-bold text-text m-0">Models</h1>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                <div style={{position: 'relative', width: '280px'}}>
                    <Search size={16} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}} />
                    <Input 
                        placeholder="Search models..." 
                        style={{paddingLeft: '36px'}}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                 </div>
                <Button
                    variant="danger"
                    leftIcon={<Trash2 size={16}/>}
                    onClick={() => setIsDeleteAllModalOpen(true)}
                    disabled={aliases.length === 0}
                >
                    Delete All Models
                </Button>
                <Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Model</Button>
            </div>
        </div>
      </div>

      <Card className="mb-6">
        <div className="overflow-x-auto -m-6">
            <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                    <tr>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Alias</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Aliases</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Selector</th>
                     <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Metadata</th>
                 <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px'}}>Targets</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAliases.map(alias => (
                        <tr key={alias.id} className="hover:bg-bg-hover">
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{fontWeight: 600, paddingLeft: '24px'}}>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'}}>
                                    <div onClick={() => handleEdit(alias)} style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1}}>
                                        <Edit2 size={12} style={{opacity: 0.5}} />
                                        {alias.id}
                                    </div>
                                    <button
                                        onClick={() => handleDeleteClick(alias)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            borderRadius: '4px',
                                            color: 'var(--color-danger)',
                                            opacity: 0.6,
                                            transition: 'opacity 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                                        title="Delete alias"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border border-border-glass" style={{
                                    fontSize: '10px',
                                    backgroundColor: alias.type === 'embeddings' ? '#10b981' : alias.type === 'transcriptions' ? '#a855f7' : alias.type === 'speech' ? '#f97316' : alias.type === 'image' ? '#d946ef' : alias.type === 'responses' ? '#06b6d4' : '#ebebeb',
                                    color: alias.type === 'embeddings' || alias.type === 'transcriptions' || alias.type === 'speech' || alias.type === 'image' || alias.type === 'responses' ? 'white' : '#333',
                                    border: 'none'
                                }}>
                                    {alias.type || 'chat'}
                                </span>
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
                          <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium border-border-glass text-text-secondary" style={{fontSize: '11px', textTransform: 'capitalize'}}>
               {alias.selector || 'random'} / {alias.priority || 'selector'}
                          </span>
                  </td>
                <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        {alias.metadata ? (
                             <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                          <BookOpen size={11} className="text-primary" />
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary" style={{textTransform: 'capitalize'}}>
                                {alias.metadata.source}
                             </span>
                              </div>
                    ) : (
                   <span style={{color: 'var(--color-text-secondary)', fontSize: '12px'}}>-</span>
                     )}
                        </td>
                  <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px'}}>
                                <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                                    {alias.targets.map((t, i) => {
                                        const provider = providers.find(p => p.id === t.provider);
                                        const isProviderDisabled = provider?.enabled === false;
                                        const isTargetDisabled = t.enabled === false;
                                        const isDisabled = isProviderDisabled || isTargetDisabled;
                                        const testKey = `${alias.id}-${i}`;
                                        const testState = testStates[testKey];

                                        // Check if this specific provider+model is on cooldown
                                        const cooldown = cooldowns.find(c =>
                                            c.provider === t.provider &&
                                            c.model === t.model &&
                                            !c.accountId // Only show provider-level cooldowns here
                                        );
                                        const isCoolingDown = !!cooldown;
                                        const cooldownMinutes = cooldown ? Math.ceil(cooldown.timeRemainingMs / 60000) : 0;

                                        return (
                                            <div key={i} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '12px',
                                                color: isDisabled ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                                                textDecoration: isDisabled ? 'line-through' : 'none',
                                                opacity: isDisabled ? 0.7 : 1
                                            }}>
                                                {isCoolingDown && (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        color: 'var(--color-warning)',
                                                        fontSize: '11px',
                                                        fontWeight: 500
                                                    }} title={`On cooldown for ${cooldownMinutes} minute${cooldownMinutes !== 1 ? 's' : ''}`}>
                                                        <Clock size={12} />
                                                        <span>{cooldownMinutes}m</span>
                                                    </div>
                                                )}
                                                <div onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    if (!isDisabled) {
                                                        let testApiTypes: string[] = ['chat'];
                                                        if (alias.type === 'embeddings') {
                                                            testApiTypes = ['embeddings'];
                                                        } else if (alias.type === 'transcriptions') {
                                                            alert('Cannot test transcriptions API via test button - requires file upload. Use actual /v1/audio/transcriptions endpoint.');
                                                            return;
                                                        } else if (alias.type === 'speech') {
                                                            alert('Cannot test speech API via test button - requires file upload. Use actual /v1/audio/speech endpoint.');
                                                            return;
                                                        } else if (alias.type === 'image') {
                                                            testApiTypes = ['images'];
                                                        } else if (alias.type === 'responses') {
                                                            testApiTypes = ['responses'];
                                                        }
                                                        handleTestTarget(alias.id, i, t.provider, t.model, testApiTypes);
                                                    }
                                                }} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                    opacity: isDisabled ? 0.5 : 1,
                                                    transition: 'opacity 0.2s',
                                                    pointerEvents: 'auto',
                                                    marginRight: '16px'
                                                }}>
                                                    {testState?.loading ? (
                                                        <Loader2 size={14} style={{color: 'var(--color-text-secondary)', animation: 'spin 1s linear infinite'}} />
                                                    ) : testState?.showResult && testState.result === 'success' ? (
                                                        <CheckCircle size={14} style={{color: 'var(--color-success)'}} />
                                                    ) : testState?.showResult && testState.result === 'error' ? (
                                                        <XCircle size={14} style={{color: 'var(--color-danger)'}} />
                                                    ) : (
                                                        <Play size={14} style={{color: 'var(--color-primary)', opacity: isDisabled ? 0 : 0.6}} />
                                                    )}
                                                </div>
                                                <div onClick={(e) => e.stopPropagation()} style={{display: 'flex', alignItems: 'center'}}>
                                                    <Switch
                                                      checked={t.enabled !== false}
                                                      onChange={(val) => handleToggleTarget(alias, i, val)}
                                                      size="sm"
                                                      disabled={isProviderDisabled}
                                                    />
                                                </div>
                                                <div style={{flex: 1}}>
                                                    {t.provider} &rarr; {t.model}
                                                    {t.apiType && t.apiType.length > 0 && (
                                                        <span style={{
                                                            textDecoration: 'none',
                                                            display: 'inline-block',
                                                            marginLeft: '8px',
                                                            fontSize: '10px',
                                                            color: 'var(--color-text-secondary)',
                                                            opacity: 0.7
                                                        }}>
                                                            [{(() => {
                                                                const chatApis = ['chat', 'messages', 'gemini', 'responses'];
                                                                if (alias.type === 'embeddings') {
                                                                    return 'embeddings';
                                                                } else if (alias.type === 'transcriptions') {
                                                                    return 'transcriptions';
                                                                } else if (alias.type === 'speech') {
                                                                    return 'speech';
                                                                } else if (alias.type === 'image') {
                                                                    return 'images';
                                                                } else if (alias.type === 'responses') {
                                                                    return 'responses';
                                                                }

                                                                const apiTypes = t.apiType || [];
                                                                if (apiTypes.includes('oauth')) {
                                                                    const oauthLabel = provider?.oauthProvider
                                                                        ? `oauth:${provider.oauthProvider}`
                                                                        : 'oauth';
                                                                    const filtered = apiTypes.filter((a: string) => a !== 'oauth' && chatApis.includes(a));
                                                                    return [oauthLabel, ...filtered].join(', ');
                                                                }

                                                                const filtered = apiTypes.filter((a: string) => chatApis.includes(a));
                                                                return (filtered.length ? filtered : apiTypes).join(', ');
                                                            })()}]
                                                        </span>
                                                    )}
                                                    {isProviderDisabled && <span style={{textDecoration: 'none', display: 'inline-block', marginLeft: '4px', fontStyle: 'italic'}}>(provider disabled)</span>}
                                                    {testState?.showResult && testState.message && (
                                                        <span style={{
                                                            textDecoration: 'none',
                                                            display: 'inline-block',
                                                            marginLeft: '8px',
                                                            fontSize: '11px',
                                                            fontStyle: 'italic',
                                                            color: testState.result === 'success' ? 'var(--color-success)' : 'var(--color-danger)'
                                                        }}>
                                                            {testState.message}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </td>
                        </tr>
                    ))}
                    {filteredAliases.length === 0 && (
                        <tr>
                            <td colSpan={5} className="text-center text-text-muted p-12">No aliases found</td>
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
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '-8px'}}>
              <div className="grid grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Primary Name (ID)</label>
                      <input
                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                        value={editingAlias.id}
                        onChange={(e) => setEditingAlias({...editingAlias, id: e.target.value})}
                        placeholder="e.g. gpt-4-turbo"
                      />
                  </div>

                  <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Model Type</label>
                      <select
                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                        value={editingAlias.type || 'chat'}
                        onChange={(e) => setEditingAlias({...editingAlias, type: e.target.value as 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses'})}
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
                      <label className="font-body text-[13px] font-medium text-text-secondary">Selector Strategy</label>
                      <select
                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                        value={editingAlias.selector || 'random'}
                        onChange={(e) => setEditingAlias({...editingAlias, selector: e.target.value})}
                      >
                          <option value="random">Random</option>
                          <option value="in_order">In Order</option>
                          <option value="cost">Lowest Cost</option>
                          <option value="latency">Lowest Latency</option>
                          <option value="usage">Usage Balanced</option>
                          <option value="performance">Best Performance</option>
                      </select>
                  </div>

                  <div className="flex flex-col gap-1">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Priority</label>
                      <select
                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                        value={editingAlias.priority || 'selector'}
                        onChange={(e) => setEditingAlias({...editingAlias, priority: e.target.value as any})}
                      >
                          <option value="selector">Selector</option>
                          <option value="api_match">API Match</option>
                      </select>
                  </div>
              </div>

              <p className="text-xs text-text-muted" style={{marginTop: '-4px'}}>Priority: "Selector" uses the strategy above. "API Match" matches provider type to incoming request format.</p>

              <div className="h-px bg-border-glass" style={{margin: '4px 0'}}></div>

              {/* Advanced accordion */}
              <div className="border border-border-glass rounded-sm overflow-hidden">
                  <button
                      type="button"
                      onClick={() => setIsAdvancedOpen(o => !o)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
                  >
                      <span className="font-body text-[13px] font-medium text-text-secondary">Advanced</span>
                      {isAdvancedOpen
                          ? <ChevronDown size={14} className="text-text-muted" />
                          : <ChevronRight size={14} className="text-text-muted" />
                      }
                  </button>

                  {isAdvancedOpen && (
                      <div className="px-3 py-3 border-t border-border-glass" style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>

                      {/* ── Behaviors ── */}
                        <div>
                         <label className="font-body text-[13px] font-medium text-text-secondary" style={{display: 'block', marginBottom: '6px'}}>Behaviors</label>
                <div className="flex items-center justify-between py-1">
                          <div>
                     <span className="font-body text-[13px] text-text">Strip Adaptive Thinking</span>
                             <p className="font-body text-[11px] text-text-muted mt-0.5">
                                On the <code className="text-primary">/v1/messages</code> path, remove <code className="text-primary">thinking</code> when set to <code className="text-primary">adaptive</code> so the provider uses its default behaviour.
                         </p>
                          </div>
                              <Switch
                                 checked={getBehavior('strip_adaptive_thinking')}
                          onChange={(val) => setBehavior('strip_adaptive_thinking', val)}
                          size="sm"
                    />
                 </div>
                   </div>

                    <div className="h-px bg-border-glass"></div>

                   {/* ── Additional Aliases ── */}
                 <div>
                       <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                                  <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Additional Aliases</label>
                     <Button size="sm" variant="secondary" onClick={addAlias} leftIcon={<Plus size={14}/>}>Add Alias</Button>
                      </div>

                            {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
                 <div className="text-text-muted italic text-center text-sm py-2">No additional aliases</div>
                    )}

                   <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
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
                    </div>
                  )}
              </div>

              <div className="h-px bg-border-glass" style={{margin: '4px 0'}}></div>

              {/* Metadata accordion */}
            <div className="border border-border-glass rounded-sm overflow-hidden">
         <button
                   type="button"
                   onClick={() => setIsMetadataOpen(o => !o)}
                 className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
                  >
             <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <BookOpen size={13} className="text-text-muted" />
               <span className="font-body text-[13px] font-medium text-text-secondary">Metadata</span>
                 {editingAlias.metadata && (
                           <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border border-border-glass text-primary bg-bg-hover">
                              {editingAlias.metadata.source}
              </span>
                      )}
               </div>
                      {isMetadataOpen
                     ? <ChevronDown size={14} className="text-text-muted" />
                        : <ChevronRight size={14} className="text-text-muted" />
                   }
                  </button>

                  {isMetadataOpen && (
                    <div className="px-3 py-3 border-t border-border-glass" style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                      <p className="font-body text-[11px] text-text-muted">
                    Link this alias to a model in an external catalog. When configured, Plexus includes
                        enriched metadata (name, context length, pricing, supported parameters) in the{' '}
                         <code className="text-primary">GET /v1/models</code> response.
                    </p>

                        {/* Source selector */}
                        <div>
                       <label className="font-body text-[12px] font-medium text-text-secondary" style={{display: 'block', marginBottom: '4px'}}>Source</label>
                <select
                         className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
             style={{padding: '5px 8px', height: '30px'}}
                 value={editingAlias.metadata?.source ?? 'openrouter'}
                    onChange={(e) => {
                          const source = e.target.value as AliasMetadata['source'];
                          setEditingAlias({
                                  ...editingAlias,
                         metadata: { source, source_path: editingAlias.metadata?.source_path ?? '' }
                        });
                          // Re-run search with new source if there's a query
                             if (metadataQuery) handleMetadataSearch(metadataQuery, source);
                  }}
                          >
                               <option value="openrouter">OpenRouter</option>
                        <option value="models.dev">models.dev</option>
                     <option value="catwalk">Catwalk (Charm)</option>
                       </select>
                    </div>

                    {/* Search / source_path */}
                      <div style={{position: 'relative'}}>
                 <label className="font-body text-[12px] font-medium text-text-secondary" style={{display: 'block', marginBottom: '4px'}}>
                       Model
                       {editingAlias.metadata?.source_path && (
                             <span className="ml-2 font-normal text-text-muted">({editingAlias.metadata.source_path})</span>
                          )}
                        </label>
                <div style={{position: 'relative', display: 'flex', gap: '4px'}}>
                  <div ref={metadataInputWrapperRef} style={{position: 'relative', flex: 1}}>
                         <Input
                            value={metadataQuery}
                         onChange={(e) => {
                         const source = editingAlias.metadata?.source ?? 'openrouter';
                             handleMetadataSearch(e.target.value, source);
                                  // Update rect so portal dropdown follows the input
                                 if (metadataInputWrapperRef.current) {
                                const r = metadataInputWrapperRef.current.getBoundingClientRect();
                        setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                                   }
                         }}
                       onFocus={() => {
                             if (metadataResults.length > 0) {
                                     if (metadataInputWrapperRef.current) {
                               const r = metadataInputWrapperRef.current.getBoundingClientRect();
                   setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                        }
                           setShowMetadataDropdown(true);
                               }
                             }}
                   placeholder={`Search ${editingAlias.metadata?.source ?? 'openrouter'} catalog...`}
                style={{width: '100%', paddingRight: isMetadataSearching ? '28px' : undefined}}
           onBlur={() => setShowMetadataDropdown(false)}
                />
                         {isMetadataSearching && (
                              <Loader2 size={14} className="animate-spin text-text-muted" style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)'}} />
                       )}
                    </div>
               {editingAlias.metadata && (
                      <Button variant="ghost" size="sm" onClick={clearMetadata} style={{color: 'var(--color-danger)', padding: '4px', minHeight: 'auto'}} title="Remove metadata">
                           <X size={14} />
                 </Button>
                  )}
              </div>
              </div>

               {/* Selected metadata preview */}
                          {editingAlias.metadata?.source_path && (
                              <div className="rounded-sm border border-border-glass bg-bg-subtle px-3 py-2" style={{fontSize: '11px', color: 'var(--color-text-secondary)'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <CheckCircle size={12} className="text-success" />
                      <span>
                     Metadata assigned from <strong>{editingAlias.metadata.source}</strong>:{' '}
                                 <code className="text-primary">{editingAlias.metadata.source_path}</code>
                    </span>
                                  </div>
                         </div>
                  )}
                </div>
                  )}
              </div>

              <div className="h-px bg-border-glass" style={{margin: '4px 0'}}></div>

              <div>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                    <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Targets</label>
                      <div style={{display: 'flex', gap: '8px'}}>
                          <Button size="sm" variant="secondary" onClick={handleOpenAutoAdd} leftIcon={<Zap size={14}/>}>Auto Add</Button>
                          <Button size="sm" variant="secondary" onClick={addTarget} leftIcon={<Plus size={14}/>}>Add Target</Button>
                      </div>
                  </div>

                  {editingAlias.targets.length === 0 && (
                       <div className="text-text-muted italic text-center text-sm py-2">No targets configured (Model will not work)</div>
                  )}

                  <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                      {editingAlias.targets.map((target, idx) => (
                          <div
                              key={idx}
                              draggable
                              onDragStart={(e) => handleDragStart(e, idx)}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, idx)}
                              style={{
                              display: 'flex',
                              gap: '6px',
                              alignItems: 'center',
                              padding: '4px 8px',
                              backgroundColor: 'var(--color-bg-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border-glass)',
                              cursor: 'grab'
                          }}
                          onDragStartCapture={(e) => {
                              (e.currentTarget as HTMLDivElement).style.opacity = '0.5';
                              (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing';
                          }}
                          onDragEndCapture={(e) => {
                              (e.currentTarget as HTMLDivElement).style.opacity = '1';
                              (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
                          }}
                          >
                              <div style={{
                                  cursor: 'grab',
                                  color: 'var(--color-text-secondary)',
                                  display: 'flex',
                                  alignItems: 'center'
                              }}>
                                  <GripVertical size={16} />
                              </div>
                              <div style={{flex: '0 0 120px', maxWidth: '120px'}}>
                                  <select
                                    className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                                    style={{padding: '4px 8px', height: '28px'}}
                                    value={target.provider}
                                    onChange={(e) => updateTarget(idx, 'provider', e.target.value)}
                                  >
                                      <option value="">Select Provider...</option>
                                      {providers.map(p => (
                                          <option key={p.id} value={p.id}>{p.name}</option>
                                      ))}
                                  </select>
                              </div>
                              <div style={{flex: 1}}>
                                  <select
                                    className="w-full font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary"
                                    style={{padding: '4px 8px', height: '28px'}}
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
                              <div>
                                  <Switch
                                    checked={target.enabled !== false}
                                    onChange={(val) => updateTarget(idx, 'enabled', val)}
                                    size="sm"
                                  />
                              </div>
                              <div>
                                  <Button variant="ghost" size="sm" onClick={() => removeTarget(idx)} style={{color: 'var(--color-danger)', padding: '4px', minHeight: 'auto'}}>
                                      <Trash2 size={14} />
                                  </Button>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      </Modal>

      <Modal
        isOpen={isAutoAddModalOpen}
        onClose={() => setIsAutoAddModalOpen(false)}
        title="Auto Add Targets"
        size="lg"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsAutoAddModalOpen(false)}>Cancel</Button>
                <Button onClick={handleAddSelectedModels} disabled={selectedModels.size === 0}>
                    Add {selectedModels.size} Target{selectedModels.size !== 1 ? 's' : ''}
                </Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <div style={{display: 'flex', gap: '8px'}}>
                  <Input
                    placeholder="Search models (e.g. 'gpt-4', 'claude')"
                    value={substring}
                    onChange={(e) => setSubstring(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearchModels()}
                    style={{flex: 1}}
                  />
                  <Button onClick={handleSearchModels}>Search</Button>
              </div>

              {filteredModels.length > 0 ? (
                  <div style={{
                      maxHeight: '400px',
                      overflowY: 'auto',
                      border: '1px solid var(--color-border-glass)',
                      borderRadius: 'var(--radius-sm)'
                  }}>
                      <table className="w-full border-collapse font-body text-[13px]">
                          <thead style={{position: 'sticky', top: 0, backgroundColor: 'var(--color-bg-hover)', zIndex: 10}}>
                              <tr>
                                   <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{width: '40px'}}>
                                       <input
                                         type="checkbox"
                                         checked={filteredModels.length > 0 && filteredModels.every(m =>
                                             selectedModels.has(`${m.provider.id}|${m.model.id}`) ||
                                             editingAlias.targets.some(t => t.provider === m.provider.id && t.model === m.model.id)
                                         )}
                                         onChange={(e) => {
                                             if (e.target.checked) {
                                                 const newSelection = new Set(selectedModels);
                                                 filteredModels.forEach(m => {
                                                     const key = `${m.provider.id}|${m.model.id}`;
                                                     if (!editingAlias.targets.some(t => t.provider === m.provider.id && t.model === m.model.id)) {
                                                         newSelection.add(key);
                                                     }
                                                 });
                                                 setSelectedModels(newSelection);
                                             } else {
                                                 const newSelection = new Set(selectedModels);
                                                 filteredModels.forEach(m => {
                                                     newSelection.delete(`${m.provider.id}|${m.model.id}`);
                                                 });
                                                 setSelectedModels(newSelection);
                                             }
                                         }}
                                       />
                                   </th>
                                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Provider</th>
                                  <th className="px-4 py-3 text-left font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Model</th>
                              </tr>
                          </thead>
                          <tbody>
                              {filteredModels.map(({ model, provider }) => {
                                  const key = `${provider.id}|${model.id}`;
                                  const alreadyExists = editingAlias.targets.some(t => t.provider === provider.id && t.model === model.id);
                                  const isSelected = selectedModels.has(key);
                                  const isDisabled = alreadyExists;

                                  return (
                                      <tr key={key} className="hover:bg-bg-hover" style={{opacity: isDisabled ? 0.5 : 1}}>
                                          <td className="px-4 py-3 text-left text-text">
                                              <input
                                                type="checkbox"
                                                checked={isSelected || alreadyExists}
                                                disabled={isDisabled}
                                                onChange={() => handleToggleModelSelection(model.id, provider.id)}
                                              />
                                          </td>
                                          <td className="px-4 py-3 text-left text-text">{provider.name}</td>
                                          <td className="px-4 py-3 text-left text-text">
                                              {model.name}
                                              {alreadyExists && (
                                                  <span style={{
                                                      marginLeft: '8px',
                                                      fontSize: '11px',
                                                      color: 'var(--color-text-secondary)',
                                                      fontStyle: 'italic'
                                                  }}>
                                                      (already added)
                                                  </span>
                                              )}
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
              ) : substring ? (
                  <div className="text-text-muted italic text-center text-sm py-8">No models found matching "{substring}"</div>
              ) : (
                  <div className="text-text-muted italic text-center text-sm py-8">Enter a search term to find models</div>
              )}
           </div>
       </Modal>

      <Modal
        isOpen={isDeleteAllModalOpen}
        onClose={() => setIsDeleteAllModalOpen(false)}
        title="Delete All Models"
        size="sm"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsDeleteAllModalOpen(false)} disabled={isDeletingAll}>Cancel</Button>
                <Button onClick={handleConfirmDeleteAll} isLoading={isDeletingAll} variant="danger">Delete All</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '16px 0'}}>
              <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
              }}>
                  <Trash2 size={24} style={{color: 'var(--color-danger)'}} />
              </div>
              <div>
                  <p className="text-text" style={{marginBottom: '8px', fontWeight: 500}}>
                      Are you sure you want to delete all configured models?
                  </p>
                  <p className="text-text-secondary" style={{fontSize: '14px'}}>
                      This will permanently remove <strong>{aliases.length}</strong> model alias{aliases.length !== 1 ? 'es' : ''} from the configuration.
                  </p>
              </div>
          </div>
      </Modal>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Model Alias"
        size="sm"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>Cancel</Button>
                <Button onClick={handleConfirmDelete} isLoading={isDeleting} variant="danger">Delete</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '16px 0'}}>
              <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
              }}>
                  <Trash2 size={24} style={{color: 'var(--color-danger)'}} />
              </div>
              <div>
                  <p className="text-text" style={{marginBottom: '8px', fontWeight: 500}}>
                      Are you sure you want to delete this alias?
                  </p>
                  <p className="text-text-secondary" style={{fontSize: '14px'}}>
                      <strong>{aliasToDelete?.id}</strong> will be permanently removed from the configuration.
                  </p>
              </div>
          </div>
      </Modal>
      {/* Metadata autocomplete portal — rendered outside accordion to avoid overflow:hidden clipping */}
      {showMetadataDropdown && metadataResults.length > 0 && dropdownRect && createPortal(
     <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
         width: dropdownRect.width,
            zIndex: 9999,
               backgroundColor: '#1E293B',
            border: '1px solid var(--color-border-glass)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: '180px',
            overflowY: 'auto',
          }}
        >
          {metadataResults.map(result => (
         <button
              key={result.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectMetadataResult(result); }}
        style={{
                display: 'block',
            width: '100%',
          textAlign: 'left',
                padding: '6px 10px',
           background: 'none',
            border: 'none',
                cursor: 'pointer',
              borderBottom: '1px solid var(--color-border-glass)',
              }}
              className="hover:bg-bg-hover transition-colors"
            >
              <div className="font-body text-[12px] font-medium text-text">{result.name}</div>
              <div className="font-body text-[10px] text-text-muted">{result.id}</div>
            </button>
          ))}
        </div>,
        document.body
      )}
     </div>
   );
 };
