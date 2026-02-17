import { useEffect, useState } from 'react';
import { api, McpServer } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Plus, Trash2, Edit2, PlusCircle, MinusCircle } from 'lucide-react';
import { Switch } from '../components/ui/Switch';

const EMPTY_SERVER: McpServer = {
  upstream_url: '',
  enabled: true,
  headers: {}
};

export const McpPage: React.FC = () => {
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [serverNameInput, setServerNameInput] = useState('');
  const [editingServer, setEditingServer] = useState<McpServer>(EMPTY_SERVER);
  const [isSaving, setIsSaving] = useState(false);
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await api.getMcpServers();
      setServers(data);
    } catch (e) {
      console.error("Failed to load MCP servers", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNew = () => {
    setEditingServerName(null);
    setServerNameInput('');
    setEditingServer({ ...EMPTY_SERVER });
    setHeaderKey('');
    setHeaderValue('');
    setIsModalOpen(true);
  };

  const handleEdit = (serverName: string) => {
    const server = servers[serverName];
    if (!server) return;
    setEditingServerName(serverName);
    setServerNameInput(serverName);
    setEditingServer({ ...server });
    setHeaderKey('');
    setHeaderValue('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const nameToSave = editingServerName || serverNameInput;
    if (!nameToSave || !nameToSave.trim()) {
      alert("Server Name is required");
      return;
    }
    if (!editingServerName && !isValidServerName(nameToSave)) {
      alert("Invalid server name. Use lowercase letters, numbers, hyphens, and underscores (2-63 characters, must start with letter or number)");
      return;
    }
    if (!editingServer.upstream_url || !editingServer.upstream_url.trim()) {
      alert("Upstream URL is required");
      return;
    }

    setIsSaving(true);
    try {
      await api.saveMcpServer(nameToSave, {
        upstream_url: editingServer.upstream_url,
        enabled: editingServer.enabled,
        headers: editingServer.headers
      });
      await loadData();
      setIsModalOpen(false);
    } catch (e) {
      console.error("Save error", e);
      alert("Failed to save MCP server: " + e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (serverName: string) => {
    if (!confirm(`Are you sure you want to delete the MCP server "${serverName}"?`)) {
      return;
    }
    try {
      await api.deleteMcpServer(serverName);
      await loadData();
    } catch (e) {
      console.error("Delete error", e);
      alert("Failed to delete MCP server: " + e);
    }
  };

  const handleToggleEnabled = async (serverName: string, newState: boolean) => {
    const server = servers[serverName];
    if (!server) return;
    
    try {
      await api.saveMcpServer(serverName, {
        ...server,
        enabled: newState
      });
      await loadData();
    } catch (e) {
      console.error("Toggle error", e);
      alert("Failed to update MCP server: " + e);
    }
  };

  const isValidServerName = (name: string): boolean => {
    return /^[a-z0-9][a-z0-9-_]{1,62}$/.test(name);
  };

  const addHeader = () => {
    if (!headerKey.trim() || !headerValue.trim()) return;
    setEditingServer({
      ...editingServer,
      headers: {
        ...editingServer.headers,
        [headerKey.trim()]: headerValue.trim()
      }
    });
    setHeaderKey('');
    setHeaderValue('');
  };

  const removeHeader = (key: string) => {
    const newHeaders = { ...editingServer.headers };
    delete newHeaders[key];
    setEditingServer({
      ...editingServer,
      headers: newHeaders
    });
  };

  const serverNames = Object.keys(servers);

  if (isLoading) {
    return (
      <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
        <Card title="MCP Servers">
          <div className="p-4 text-text-secondary">Loading...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <Card 
        title="MCP Servers"
        extra={<Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add MCP Server</Button>}
      >
        {serverNames.length === 0 ? (
          <div className="p-4 text-text-secondary text-center">
            No MCP servers configured. Click "Add MCP Server" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto -m-6">
            <table className="w-full border-collapse font-body text-[13px]">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>Name</th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Upstream URL</th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Headers</th>
                  <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {serverNames.map(name => {
                  const server = servers[name];
                  const headerCount = server.headers ? Object.keys(server.headers).length : 0;
                  return (
                    <tr key={name} onClick={() => handleEdit(name)} style={{cursor: 'pointer'}} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingLeft: '24px'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                          <Edit2 size={12} style={{opacity: 0.5}} />
                          <div style={{fontWeight: 600}}>{name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        <div style={{maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                          {server.upstream_url}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch 
                            checked={server.enabled !== false} 
                            onChange={(val) => handleToggleEnabled(name, val)} 
                            size="sm"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                        {headerCount > 0 ? `${headerCount} header(s)` : '-'}
                      </td>
                      <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                        <div style={{display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(name); }} style={{color: 'var(--color-danger)'}}><Trash2 size={14}/></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingServerName ? `Edit ${editingServerName}` : 'Add MCP Server'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!editingServerName && (
            <Input
              label="Server Name"
              value={serverNameInput}
              onChange={(e) => setServerNameInput(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
              placeholder="my-mcp-server"
            />
          )}
          
          <Input
            label="Upstream URL"
            value={editingServer.upstream_url}
            onChange={(e) => setEditingServer({ ...editingServer, upstream_url: e.target.value })}
            placeholder="https://mcp.example.com/mcp"
          />

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                label="Header Key"
                value={headerKey}
                onChange={(e) => setHeaderKey(e.target.value)}
                placeholder="Authorization"
              />
            </div>
            <div className="flex-1">
              <Input
                label="Header Value"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                placeholder="Bearer token..."
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={addHeader}
              style={{ marginTop: '20px' }}
            >
              <PlusCircle size={16} />
            </Button>
          </div>

          {editingServer.headers && Object.keys(editingServer.headers).length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">Configured Headers</label>
              {Object.entries(editingServer.headers).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 p-2 bg-bg-hover rounded-md">
                  <span className="flex-1 font-mono text-xs">{key}</span>
                  <span className="flex-1 font-mono text-xs text-text-secondary truncate">{value}</span>
                  <button
                    onClick={() => removeHeader(key)}
                    className="p-1 hover:bg-bg-surface rounded"
                  >
                    <MinusCircle size={14} className="text-danger" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default McpPage;
