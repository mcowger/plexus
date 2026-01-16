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
import MonacoEditor from '@/components/ui/monaco-editor';
import { Tag, TagInput } from 'emblor';
import { api } from '@/lib/api';
import { parse, stringify } from 'yaml';
import { Plus, Trash2, Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import chatDarkIcon from '@/assets/dark_icons/chat.svg';
import messagesDarkIcon from '@/assets/dark_icons/messages.svg';
import geminiDarkIcon from '@/assets/dark_icons/gemini.svg';
import chatLightIcon from '@/assets/light_icons/chat.svg';
import messagesLightIcon from '@/assets/light_icons/messages.svg';
import geminiLightIcon from '@/assets/light_icons/gemini.svg';

interface Provider {
  name: string;
  enabled: boolean;
  baseUrls: {
    chat?: { url: string; enabled: boolean };
    messages?: { url: string; enabled: boolean };
    gemini?: { url: string; enabled: boolean };
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
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);
  const { theme } = useTheme();

  const [formData, setFormData] = useState({
    name: '',
    enabled: true as boolean,
    baseUrls: {
      chat: { url: '', enabled: false } as { url: string; enabled: boolean },
      messages: { url: '', enabled: false } as { url: string; enabled: boolean },
      gemini: { url: '', enabled: false } as { url: string; enabled: boolean },
    },
    auth: {
      type: 'bearer' as 'bearer' | 'x-api-key',
      apiKey: '',
    },
    models: [] as Tag[],
    discount: 1.0,
    customHeaders: '',
    extraBody: '',
  });

  const getIcon = (iconType: 'chat' | 'messages' | 'gemini') => {
    const isDark = theme === 'dark';
    switch (iconType) {
      case 'chat':
        return isDark ? chatDarkIcon : chatLightIcon;
      case 'messages':
        return isDark ? messagesDarkIcon : messagesLightIcon;
      case 'gemini':
        return isDark ? geminiDarkIcon : geminiLightIcon;
    }
  };

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
      baseUrls: { chat: { url: '', enabled: false }, messages: { url: '', enabled: false }, gemini: { url: '', enabled: false } },
      auth: { type: 'bearer', apiKey: '' },
      models: [],
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
      baseUrls: {
        chat: provider.baseUrls.chat || { url: '', enabled: false },
        messages: provider.baseUrls.messages || { url: '', enabled: false },
        gemini: provider.baseUrls.gemini || { url: '', enabled: false },
      },
      auth: {
        type: provider.auth.type,
        apiKey: provider.auth.apiKey,
      },
      models: provider.models.map(model => ({ id: model, text: model })),
      discount: provider.discount || 1.0,
      customHeaders: provider.customHeaders ? stringify(provider.customHeaders) : '',
      extraBody: provider.extraBody ? stringify(provider.extraBody) : '',
    });
    setShowModal(true);
  };

  const handleToggleEnabled = async (name: string, enabled: boolean) => {
    try {
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;
      const provider = config.providers.find(p => p.name === name);
      if (provider) {
        provider.enabled = enabled;
        await api.updateConfig(stringify(config));
        loadConfig();
      }
    } catch (error) {
      console.error('Failed to update provider:', error);
      alert('Failed to update provider');
    }
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

      const newProvider: Provider = {
        name: formData.name,
        enabled: formData.enabled,
        baseUrls: {
          chat: formData.baseUrls.chat?.url ? { url: formData.baseUrls.chat.url, enabled: formData.baseUrls.chat.enabled } : undefined,
          messages: formData.baseUrls.messages?.url ? { url: formData.baseUrls.messages.url, enabled: formData.baseUrls.messages.enabled } : undefined,
          gemini: formData.baseUrls.gemini?.url ? { url: formData.baseUrls.gemini.url, enabled: formData.baseUrls.gemini.enabled } : undefined,
        },
        auth: {
          type: formData.auth.type,
          apiKey: formData.auth.apiKey,
        },
        models: formData.models.map(tag => tag.text),
        discount: formData.discount !== 1.0 ? formData.discount : undefined,
      };

      if (formData.customHeaders) {
        try {
          newProvider.customHeaders = parse(formData.customHeaders) as Record<string, string>;
        } catch (e) {
          alert('Invalid YAML for custom headers');
          return;
        }
      }

      if (formData.extraBody) {
        try {
          newProvider.extraBody = parse(formData.extraBody) as Record<string, string | number | boolean | unknown>;
        } catch (e) {
          alert('Invalid YAML for extra body');
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
                      {Object.entries(provider.baseUrls)
                        .filter(([_, config]) => config && config.enabled)
                        .map(([type, _]) => (
                          <Badge key={type} variant="outline" className="mr-1">
                            {type}
                          </Badge>
                        ))}
                    </TableCell>
                    <TableCell>{provider.models.length} configured</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2 items-center">
                        <Switch
                          checked={provider.enabled}
                          onCheckedChange={(checked) => handleToggleEnabled(provider.name, checked)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(provider)}
                        >
                          <Settings2 className="h-4 w-4" />
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

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="provider-name">Provider Name</Label>
                <Input
                  id="provider-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., openai"
                  disabled={!!editingProvider}
                />
              </div>
              <div className="flex items-center space-x-2 mt-6">
                <Switch
                  id="provider-enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                />
                <Label htmlFor="provider-enabled" className="cursor-pointer">Enabled</Label>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-sm">API Support</h3>

              <div className="flex items-center gap-3">
                <Label htmlFor="api-chat" className="text-xs w-[130px] flex items-center gap-1.5">
                  <img src={getIcon('chat')} alt="Chat" className="w-4 h-4" />
                  Chat
                </Label>
                <Switch
                  id="api-chat"
                  checked={formData.baseUrls.chat?.enabled || false}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, chat: { ...formData.baseUrls.chat, enabled: checked } },
                    })
                  }
                />
                <Input
                  placeholder="https://api.openai.com/v1/chat/completions"
                  value={formData.baseUrls.chat?.url || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, chat: { ...formData.baseUrls.chat, url: e.target.value } },
                    })
                  }
                />
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor="api-messages" className="text-xs w-[130px] flex items-center gap-1.5">
                  <img src={getIcon('messages')} alt="Messages" className="w-4 h-4" />
                  Messages
                </Label>
                <Switch
                  id="api-messages"
                  checked={formData.baseUrls.messages?.enabled || false}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, messages: { ...formData.baseUrls.messages, enabled: checked } },
                    })
                  }
                />
                <Input
                  placeholder="https://api.anthropic.com/v1/messages"
                  value={formData.baseUrls.messages?.url || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, messages: { ...formData.baseUrls.messages, url: e.target.value } },
                    })
                  }
                />
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor="api-gemini" className="text-xs w-[130px] flex items-center gap-1.5">
                  <img src={getIcon('gemini')} alt="Gemini" className="w-4 h-4" />
                  Gemini
                </Label>
                <Switch
                  id="api-gemini"
                  checked={formData.baseUrls.gemini?.enabled || false}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, gemini: { ...formData.baseUrls.gemini, enabled: checked } },
                    })
                  }
                />
                <Input
                  placeholder="https://generativelanguage.googleapis.com/v1beta/models"
                  value={formData.baseUrls.gemini?.url || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      baseUrls: { ...formData.baseUrls, gemini: { ...formData.baseUrls.gemini, url: e.target.value } },
                    })
                  }
                />
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="auth-type">Auth Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formData.auth.type === 'bearer' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormData({ ...formData, auth: { ...formData.auth, type: 'bearer' } })}
                  >
                    Bearer
                  </Button>
                  <Button
                    type="button"
                    variant={formData.auth.type === 'x-api-key' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormData({ ...formData, auth: { ...formData.auth, type: 'x-api-key' } })}
                  >
                    x-api-key
                  </Button>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="api-key"
                    type={showApikey ? 'text' : 'password'}
                    value={formData.auth.apiKey}
                    onChange={(e) =>
                      setFormData({ ...formData, auth: { ...formData.auth, apiKey: e.target.value } })
                    }
                    placeholder="Enter key or {env:VAR}"
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="models">Models</Label>
              <TagInput
                placeholder="e.g., gpt-4o, gpt-4o-mini, o1-preview"
                tags={formData.models}
                setTags={(newTags) => setFormData({ ...formData, models: newTags as Tag[] })}
                activeTagIndex={activeTagIndex}
                setActiveTagIndex={setActiveTagIndex}
                inputFieldPosition="bottom"
                styleClasses={{
                  tag: {
                    body: "rounded-full h-8 text-xs",
                  },
                  input: "h-8",
                }}
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
                    <Label htmlFor="custom-headers">Custom Headers (YAML)</Label>
                    <MonacoEditor
                      value={formData.customHeaders}
                      onChange={(value) => setFormData({ ...formData, customHeaders: value || '' })}
                      language="yaml"
                      height="150px"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'off',
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extra-body">Extra Body Fields (YAML)</Label>
                    <MonacoEditor
                      value={formData.extraBody}
                      onChange={(value) => setFormData({ ...formData, extraBody: value || '' })}
                      language="yaml"
                      height="150px"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'off',
                      }}
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
