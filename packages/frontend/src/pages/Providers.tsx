import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp } from 'lucide-react';

interface Provider {
  name: string;
  enabled: boolean;
  apiTypes: string[];
  baseUrls: {
    chat?: string;
    messages?: string;
    gemini?: string;
  };
  auth: {
    type: 'bearer' | 'x-api-key';
    apiKey: string;
  };
  models: string[];
  discount?: number;
  customHeaders?: Record<string, string>;
  extraBody?: Record<string, string | number | boolean | unknown>;
}

interface ConfigData {
  providers: Provider[];
}

type SelectorStrategy = 'random' | 'in_order' | 'cost' | 'latency' | 'performance';

export const ProvidersPage: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showApikey, setShowApiKey] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    enabled: true as boolean,
    apiTypes: {
      chat: false as boolean,
      messages: false as boolean,
      gemini: false as boolean,
    },
    baseUrls: {
      chat: '',
      messages: '',
      gemini: '',
    },
    auth: {
      type: 'bearer' as 'bearer' | 'x-api-key',
      apiKey: '',
    },
    models: '',
    discount: 1.0,
    customHeaders: '',
    extraBody: '',
  });

  const loadConfig = async () => {
    try {
      setLoading(true);
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;
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
    setEditingProvider(null);
    setFormData({
      name: '',
      enabled: true,
      apiTypes: { chat: false, messages: false, gemini: false },
      baseUrls: { chat: '', messages: '', gemini: '' },
      auth: { type: 'bearer', apiKey: '' },
      models: '',
      discount: 1.0,
      customHeaders: '',
      extraBody: '',
    });
    setShowModal(true);
  };

  const handleOpenEdit = (provider: Provider) => {
    setEditingProvider(provider);
    setFormData({
      name: provider.name,
      enabled: provider.enabled,
      apiTypes: {
        chat: provider.apiTypes.includes('chat'),
        messages: provider.apiTypes.includes('messages'),
        gemini: provider.apiTypes.includes('gemini'),
      },
      baseUrls: {
        chat: provider.baseUrls.chat || '',
        messages: provider.baseUrls.messages || '',
        gemini: provider.baseUrls.gemini || '',
      },
      auth: {
        type: provider.auth.type,
        apiKey: provider.auth.apiKey,
      },
      models: provider.models.join(', '),
      discount: provider.discount || 1.0,
      customHeaders: provider.customHeaders ? JSON.stringify(provider.customHeaders, null, 2) : '',
      extraBody: provider.extraBody ? JSON.stringify(provider.extraBody, null, 2) : '',
    });
    setShowModal(true);
  };

  const handleDelete = async (name: string) => {
    if (confirm(`Are you sure you want to delete provider "${name}"?`)) {
      try {
        const configYaml = await api.getConfig();
        const config = parse(configYaml) as ConfigData;
        const newProviders = config.providers.filter(p => p.name !== name);
        config.providers = newProviders;
        await api.updateConfig(stringify(config));
        loadConfig();
      } catch (error) {
        console.error('Failed to delete provider:', error);
        alert('Failed to delete provider');
      }
    }
  };

  const handleSave = async () => {
    try {
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;

      const activeApiTypes: string[] = [];
      if (formData.apiTypes.chat) activeApiTypes.push('chat');
      if (formData.apiTypes.messages) activeApiTypes.push('messages');
      if (formData.apiTypes.gemini) activeApiTypes.push('gemini');

      const newProvider: Provider = {
        name: formData.name,
        enabled: formData.enabled,
        apiTypes: activeApiTypes,
        baseUrls: {
          chat: formData.baseUrls.chat || undefined,
          messages: formData.baseUrls.messages || undefined,
          gemini: formData.baseUrls.gemini || undefined,
        },
        auth: {
          type: formData.auth.type,
          apiKey: formData.auth.apiKey,
        },
        models: formData.models.split(',').map(m => m.trim()).filter(m => m),
        discount: formData.discount !== 1.0 ? formData.discount : undefined,
      };

      if (formData.customHeaders) {
        try {
          newProvider.customHeaders = JSON.parse(formData.customHeaders);
        } catch (e) {
          alert('Invalid JSON for custom headers');
          return;
        }
      }

      if (formData.extraBody) {
        try {
          newProvider.extraBody = JSON.parse(formData.extraBody);
        } catch (e) {
          alert('Invalid JSON for extra body');
          return;
        }
      }

      if (editingProvider) {
        const index = config.providers.findIndex(p => p.name === editingProvider.name);
        if (index !== -1) {
          config.providers[index] = newProvider;
        }
      } else {
        config.providers.push(newProvider);
      }

      await api.updateConfig(stringify(config));
      setShowModal(false);
      loadConfig();
    } catch (error) {
      console.error('Failed to save provider:', error);
      alert('Failed to save provider');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Provider Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure and manage LLM provider connections
          </p>
        </div>
        <Button onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              Loading...
            </div>
          ) : providers.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              No providers configured
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>APIs</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.name}>
                    <TableCell className="font-medium">{provider.name}</TableCell>
                    <TableCell>
                      <Badge variant={provider.enabled ? 'default' : 'secondary'}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {provider.apiTypes.map((type) => (
                        <Badge key={type} variant="outline" className="mr-1">
                          {type}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell>{provider.models.length} configured</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(provider)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(provider.name)}
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
              {editingProvider ? 'Edit Provider' : 'Add Provider'}
            </DialogTitle>
            <DialogDescription>
              Configure a new provider or update existing provider settings
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Basic Information</h3>

              <div className="space-y-2">
                <Label htmlFor="provider-name">Provider Name</Label>
                <Input
                  id="provider-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., openai"
                  disabled={!!editingProvider}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="provider-enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                />
                <Label htmlFor="provider-enabled">Enabled</Label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm">API Support</h3>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Switch
                    id="api-chat"
                    checked={formData.apiTypes.chat}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        apiTypes: { ...formData.apiTypes, chat: checked },
                      })
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="api-chat">OpenAI Chat API</Label>
                    {formData.apiTypes.chat && (
                      <Input
                        placeholder="https://api.openai.com/v1/chat/completions"
                        value={formData.baseUrls.chat}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            baseUrls: { ...formData.baseUrls, chat: e.target.value },
                          })
                        }
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Switch
                    id="api-messages"
                    checked={formData.apiTypes.messages}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        apiTypes: { ...formData.apiTypes, messages: checked },
                      })
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="api-messages">Anthropic Messages API</Label>
                    {formData.apiTypes.messages && (
                      <Input
                        placeholder="https://api.anthropic.com/v1/messages"
                        value={formData.baseUrls.messages}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            baseUrls: { ...formData.baseUrls, messages: e.target.value },
                          })
                        }
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <Switch
                    id="api-gemini"
                    checked={formData.apiTypes.gemini}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        apiTypes: { ...formData.apiTypes, gemini: checked },
                      })
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="api-gemini">Gemini API</Label>
                    {formData.apiTypes.gemini && (
                      <Input
                        placeholder="https://generativelanguage.googleapis.com/v1beta/models"
                        value={formData.baseUrls.gemini}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            baseUrls: { ...formData.baseUrls, gemini: e.target.value },
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth-type">Authentication Type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.auth.type === 'bearer' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormData({ ...formData, auth: { ...formData.auth, type: 'bearer' } })}
                >
                  Bearer Token
                </Button>
                <Button
                  type="button"
                  variant={formData.auth.type === 'x-api-key' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormData({ ...formData, auth: { ...formData.auth, type: 'x-api-key' } })}
                >
                  x-api-key Header
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="api-key"
                  type={showApikey ? 'text' : 'password'}
                  value={formData.auth.apiKey}
                  onChange={(e) =>
                    setFormData({ ...formData, auth: { ...formData.auth, apiKey: e.target.value } })
                  }
                  placeholder="Enter API key or env var like {env:OPENAI_API_KEY}"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowApiKey(!showApikey)}
                >
                  {showApikey ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="models">Models (comma-separated)</Label>
              <Input
                id="models"
                value={formData.models}
                onChange={(e) => setFormData({ ...formData, models: e.target.value })}
                placeholder="e.g., gpt-4o, gpt-4o-mini, o1-preview"
              />
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="advanced">
                <AccordionTrigger>Advanced Configuration</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="discount">Discount Multiplier</Label>
                    <Input
                      id="discount"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={formData.discount}
                      onChange={(e) =>
                        setFormData({ ...formData, discount: parseFloat(e.target.value) || 1.0 })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Apply a cost discount (e.g., 0.85 for 15% off)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom-headers">Custom Headers (JSON)</Label>
                    <textarea
                      id="custom-headers"
                      className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.customHeaders}
                      onChange={(e) => setFormData({ ...formData, customHeaders: e.target.value })}
                      placeholder='{\n  "OpenAI-Organization": "org-123"\n}'
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extra-body">Extra Body Fields (JSON)</Label>
                    <textarea
                      id="extra-body"
                      className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.extraBody}
                      onChange={(e) => setFormData({ ...formData, extraBody: e.target.value })}
                      placeholder='{\n  "anthropic_version": "2023-06-01"\n}'
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingProvider ? 'Update' : 'Add'} Provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
