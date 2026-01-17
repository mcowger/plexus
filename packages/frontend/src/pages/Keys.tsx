import { useEffect, useState } from 'react';
import { api, KeyConfig } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Search, Plus, Trash2, Edit2, Copy, RefreshCw, Check } from 'lucide-react';

const EMPTY_KEY: KeyConfig = {
    key: '',
    secret: '',
    comment: ''
};

export const Keys = () => {
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyConfig>(EMPTY_KEY);
  const [originalKeyName, setOriginalKeyName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
        const k = await api.getKeys();
        setKeys(k);
    } catch (e) {
        console.error("Failed to load keys", e);
    }
  };

  const handleEdit = (key: KeyConfig) => {
      setOriginalKeyName(key.key);
      setEditingKey({ ...key });
      setIsModalOpen(true);
  };

  const handleAddNew = () => {
      setOriginalKeyName(null);
      setEditingKey({ ...EMPTY_KEY });
      setIsModalOpen(true);
  };

  const handleSave = async () => {
      if (!editingKey.key || !editingKey.secret) return;
      
      setIsSaving(true);
      try {
          await api.saveKey(editingKey, originalKeyName || undefined);
          await loadData();
          setIsModalOpen(false);
      } catch (e) {
          console.error("Failed to save key", e);
          alert("Failed to save key");
      } finally {
          setIsSaving(false);
      }
  };

  const handleDelete = async (keyName: string) => {
      if (!confirm(`Are you sure you want to delete key '${keyName}'? This cannot be undone.`)) return;
      
      try {
          await api.deleteKey(keyName);
          await loadData();
      } catch (e) {
          console.error("Failed to delete key", e);
          alert("Failed to delete key");
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
      (k.comment && k.comment.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
                <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">API Keys</h1>
                <p className="text-[15px] text-text-secondary m-0">Manage access keys for the Plexus Gateway.</p>
            </div>
            <Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Key</Button>
        </div>
      </div>

      <Card className="mb-6">
           <div style={{position: 'relative'}}>
              <Search size={16} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}} />
              <Input 
                placeholder="Search keys..." 
                style={{paddingLeft: '36px'}}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
      </Card>

      <Card title="Active Keys" className="mb-6">
        <div className="overflow-x-auto -m-6">
            <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                    <tr>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Key Name</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Secret</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Comment</th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredKeys.map(key => (
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
                                <span style={{color: 'var(--color-text-secondary)', fontSize: '13px'}}>
                                    {key.comment || '-'}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                                    <Button variant="ghost" size="sm" onClick={() => handleEdit(key)}>
                                        <Edit2 size={14} />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(key.key)} style={{color: 'var(--color-danger)'}}>
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {filteredKeys.length === 0 && (
                        <tr>
                            <td colSpan={4} className="text-center text-text-muted p-12">No keys found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </Card>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={originalKeyName ? "Edit Key" : "Add Key"}
        size="md"
        footer={
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} isLoading={isSaving} disabled={!editingKey.key || !editingKey.secret}>Save Key</Button>
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
                  disabled={!!originalKeyName} // Don't allow changing ID after creation to match Provider pattern, or allow? Typically IDs are stable.
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
          </div>
      </Modal>
    </div>
  );
};
