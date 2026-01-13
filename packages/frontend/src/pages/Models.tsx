import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Plus, Trash2, Search, X } from 'lucide-react';

interface ModelTarget {
  provider: string;
  model: string;
  weight?: number;
}

interface ModelAlias {
  alias: string;
  description?: string;
  additionalAliases?: string[];
  targets: ModelTarget[];
  selector: 'random' | 'in_order' | 'cost' | 'latency' | 'performance';
  apiMatch?: boolean;
}

interface ConfigData {
  models?: ModelAlias[];
  providers?: Array<{ name: string; models: string[] }>;
}

type SelectorStrategy = 'random' | 'in_order' | 'cost' | 'latency' | 'performance';

export const ModelsPage: React.FC = () => {
  const [aliases, setAliases] = useState<ModelAlias[]>([]);
  const [providers, setProviders] = useState<Array<{ name: string; models: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAlias, setEditingAlias] = useState<ModelAlias | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    alias: '',
    description: '',
    selector: 'random' as SelectorStrategy,
    apiMatch: false,
    additionalAliases: [] as string[],
    targets: [{ provider: '', model: '', weight: 100 }] as Array<{ provider: string; model: string; weight: number }>,
  });

  const loadConfig = async () => {
    try {
      setLoading(true);
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;
      setAliases(config.models || []);
      setProviders(config.providers || []);
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleOpenAdd = () => {
    setEditingAlias(null);
    setFormData({
      alias: '',
      description: '',
      selector: 'random',
      apiMatch: false,
      additionalAliases: [],
      targets: [{ provider: '', model: '', weight: 100 }],
    });
    setShowModal(true);
  };

  const handleOpenEdit = (alias: ModelAlias) => {
    setEditingAlias(alias);
    setFormData({
      alias: alias.alias,
      description: alias.description || '',
      selector: alias.selector,
      apiMatch: alias.apiMatch || false,
      additionalAliases: alias.additionalAliases || [],
      targets: alias.targets.map(t => ({ provider: t.provider, model: t.model, weight: t.weight || 100 })),
    });
    setShowModal(true);
  };

  const handleDelete = async (aliasName: string) => {
    if (confirm(`Are you sure you want to delete alias "${aliasName}"?`)) {
      try {
        const configYaml = await api.getConfig();
        const config = parse(configYaml) as ConfigData;
        const newAliases = (config.models || []).filter(m => m.alias !== aliasName);
        config.models = newAliases;
        await api.updateConfig(stringify(config));
        loadConfig();
      } catch (error) {
        console.error('Failed to delete alias:', error);
        alert('Failed to delete alias');
      }
    }
  };

  const handleSave = async () => {
    try {
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;

      const newAlias: ModelAlias = {
        alias: formData.alias,
        selector: formData.selector,
        targets: formData.targets.filter(t => t.provider && t.model),
        apiMatch: formData.apiMatch,
      };

      if (formData.description) {
        newAlias.description = formData.description;
      }
      if (formData.additionalAliases.length > 0) {
        newAlias.additionalAliases = formData.additionalAliases;
      }
      if (formData.targets.some(t => t.weight && t.weight !== 100)) {
        newAlias.targets = formData.targets.map(t => ({
          provider: t.provider,
          model: t.model,
          weight: t.weight || undefined,
        }));
      }

      if (editingAlias) {
        const index = (config.models || []).findIndex(m => m.alias === editingAlias.alias);
        if (index !== -1) {
          if (!config.models) config.models = [];
          config.models[index] = newAlias;
        }
      } else {
        if (!config.models) config.models = [];
        config.models.push(newAlias);
      }

      await api.updateConfig(stringify(config));
      setShowModal(false);
      loadConfig();
    } catch (error) {
      console.error('Failed to save alias:', error);
      alert('Failed to save alias');
    }
  };

  const addAdditionalAlias = () => {
    setFormData({
      ...formData,
      additionalAliases: [...formData.additionalAliases, ''],
    });
  };

  const removeAdditionalAlias = (index: number) => {
    setFormData({
      ...formData,
      additionalAliases: formData.additionalAliases.filter((_, i) => i !== index),
    });
  };

  const addTarget = () => {
    setFormData({
      ...formData,
      targets: [...formData.targets, { provider: '', model: '', weight: 100 }],
    });
  };

  const removeTarget = (index: number) => {
    setFormData({
      ...formData,
      targets: formData.targets.filter((_, i) => i !== index),
    });
  };

  const filteredAliases = aliases.filter(alias => {
    const query = searchQuery.toLowerCase();
    return (
      alias.alias.toLowerCase().includes(query) ||
      alias.additionalAliases?.some(a => a.toLowerCase().includes(query)) ||
      alias.description?.toLowerCase().includes(query)
    );
  });

  const getProviderModels = (providerName: string): string[] => {
    const provider = providers.find(p => p.name === providerName);
    return provider?.models || [];
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Model Aliases</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure model aliases and routing strategies
          </p>
        </div>
        <Button onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Alias
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Model Aliases</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search aliases..."
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
          ) : filteredAliases.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              {searchQuery ? 'No aliases found' : 'No model aliases configured'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias Name</TableHead>
                  <TableHead>Additional Aliases</TableHead>
                  <TableHead>Selector Strategy</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAliases.map((alias) => (
                  <TableRow key={alias.alias}>
                    <TableCell className="font-medium">{alias.alias}</TableCell>
                    <TableCell>
                      {alias.additionalAliases && alias.additionalAliases.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {alias.additionalAliases.map((a, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 bg-secondary rounded text-xs"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{alias.selector}</TableCell>
                    <TableCell>
                      {alias.targets.map((t, i) => (
                        <div key={i} className="text-sm">
                          {t.provider}/{t.model}
                          {t.weight && t.weight !== 100 && ` (${t.weight}%)`}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(alias)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(alias.alias)}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAlias ? 'Edit Alias' : 'Add Alias'}
            </DialogTitle>
            <DialogDescription>
              Configure a new model alias or update existing alias routing
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Basic Information</h3>

              <div className="space-y-2">
                <Label htmlFor="alias-name">Alias Name</Label>
                <Input
                  id="alias-name"
                  value={formData.alias}
                  onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                  placeholder="e.g., smart"
                  disabled={!!editingAlias}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="alias-description">Description (optional)</Label>
                <Input
                  id="alias-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., High-quality model with multi-provider redundancy"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="selector-strategy">Selector Strategy</Label>
                <select
                  id="selector-strategy"
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={formData.selector}
                  onChange={(e) => setFormData({ ...formData, selector: e.target.value as SelectorStrategy })}
                >
                  <option value="random">Random (weighted)</option>
                  <option value="in_order">In Order (failover)</option>
                  <option value="cost">Lowest Cost</option>
                  <option value="latency">Fastest</option>
                  <option value="performance">Best Performance</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="api-match"
                  checked={formData.apiMatch}
                  onChange={(e) => setFormData({ ...formData, apiMatch: e.target.checked })}
                  className="rounded border-input"
                />
                <Label htmlFor="api-match">Match Client API Type</Label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Additional Aliases</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAdditionalAlias}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {formData.additionalAliases.map((alias, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={alias}
                    onChange={(e) => {
                      const newAliases = [...formData.additionalAliases];
                      newAliases[index] = e.target.value;
                      setFormData({ ...formData, additionalAliases: newAliases });
                    }}
                    placeholder="e.g., intelligent"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeAdditionalAlias(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Targets</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTarget}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Target
                </Button>
              </div>

              {formData.targets.map((target, index) => (
                <div key={index} className="space-y-2 p-4 border rounded-md">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Provider</Label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                        value={target.provider}
                        onChange={(e) => {
                          const newTargets = [...formData.targets];
                          newTargets[index] = { ...target, provider: e.target.value, model: '' };
                          setFormData({ ...formData, targets: newTargets });
                        }}
                      >
                        <option value="">Select provider...</option>
                        {providers.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label>Model</Label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                        value={target.model}
                        onChange={(e) => {
                          const newTargets = [...formData.targets];
                          newTargets[index] = { ...target, model: e.target.value };
                          setFormData({ ...formData, targets: newTargets });
                        }}
                        disabled={!target.provider}
                      >
                        <option value="">Select model...</option>
                        {getProviderModels(target.provider).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1">
                      <Label>Weight (random selector)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={target.weight}
                        onChange={(e) => {
                          const newTargets = [...formData.targets];
                          newTargets[index] = { ...target, weight: parseInt(e.target.value) || 0 };
                          setFormData({ ...formData, targets: newTargets });
                        }}
                      />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeTarget(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingAlias ? 'Update' : 'Add'} Alias
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
