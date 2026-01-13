import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { parse, stringify } from 'yaml';
import { Plus, Trash2, Search, Copy, X } from 'lucide-react';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface ApiKey {
  name: string;
  secret: string;
  enabled: boolean;
}

interface ConfigData {
  apiKeys: ApiKey[];
}

export const KeysPage: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    secret: '',
    enabled: true,
  });

  const loadConfig = async () => {
    try {
      setLoading(true);
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;
      setApiKeys(config.apiKeys || []);
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (copiedKey) {
      const timeout = setTimeout(() => setCopiedKey(null), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copiedKey]);

  const handleOpenAdd = () => {
    setEditingKey(null);
    setFormData({
      name: '',
      secret: '',
      enabled: true,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (key: ApiKey) => {
    setEditingKey(key);
    setFormData({
      name: key.name,
      secret: key.secret,
      enabled: key.enabled,
    });
    setShowModal(true);
  };

  const handleDelete = async (name: string) => {
    if (confirm(`Are you sure you want to delete key "${name}"?`)) {
      try {
        const configYaml = await api.getConfig();
        const config = parse(configYaml) as ConfigData;
        const newKeys = config.apiKeys.filter(k => k.name !== name);
        config.apiKeys = newKeys;
        await api.updateConfig(stringify(config));
        loadConfig();
      } catch (error) {
        console.error('Failed to delete key:', error);
        alert('Failed to delete key');
      }
    }
  };

  const handleGenerateSecret = () => {
    const newSecret = `sk-plexus-${generateUUID().slice(0, 8)}-${generateUUID().slice(0, 8)}`;
    setFormData({ ...formData, secret: newSecret });
  };

  const handleCopySecret = (secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedKey(secret);
  };

  const handleSave = async () => {
    try {
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;

      const newKey: ApiKey = {
        name: formData.name,
        secret: formData.secret,
        enabled: formData.enabled,
      };

      if (editingKey) {
        const index = config.apiKeys.findIndex(k => k.name === editingKey.name);
        if (index !== -1) {
          config.apiKeys[index] = newKey;
        }
      } else {
        config.apiKeys.push(newKey);
      }

      await api.updateConfig(stringify(config));
      setShowModal(false);
      loadConfig();
    } catch (error) {
      console.error('Failed to save key:', error);
      alert('Failed to save key');
    }
  };

  const filteredKeys = apiKeys.filter(key => {
    const query = searchQuery.toLowerCase();
    return (
      key.name.toLowerCase().includes(query) ||
      key.secret.toLowerCase().includes(query)
    );
  });

  const truncateKey = (key: string): string => {
    if (key.length <= 16) return key;
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">API Key Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage API keys for client access
          </p>
        </div>
        <Button onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Key
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>API Keys</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search keys..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              Loading...
            </div>
          ) : filteredKeys.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              {searchQuery ? 'No keys found' : 'No API keys configured'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key Name</TableHead>
                  <TableHead>Secret</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKeys.map((key) => (
                  <TableRow key={key.name}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-0.5 rounded text-sm">
                          {truncateKey(key.secret)}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopySecret(key.secret)}
                          className="h-6 w-6"
                        >
                          {copiedKey === key.secret ? (
                            <X className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.enabled ? 'default' : 'secondary'}>
                        {key.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(key)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(key.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingKey ? 'Edit Key' : 'Add Key'}
            </DialogTitle>
            <DialogDescription>
              Configure a new API key or update existing key settings
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., production-key"
                disabled={!!editingKey}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-secret">Secret</Label>
              <div className="flex gap-2">
                <Input
                  id="key-secret"
                  value={formData.secret}
                  onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                  placeholder="Enter secret or generate one"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGenerateSecret}
                  disabled={!!editingKey}
                >
                  Generate
                </Button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="key-enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="rounded border-input"
              />
              <Label htmlFor="key-enabled">Enabled</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingKey ? 'Update' : 'Add'} Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
