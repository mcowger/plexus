import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  Provider,
  OAuthSession,
  initQuotaCheckerTypes,
  getQuotaCheckerTypes,
} from '../lib/api';
import type { QuotaCheckerInfo } from '../types/quota';
import { formatMeterValue } from '../components/quota/MeterValue';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../contexts/ToastContext';

const KNOWN_APIS = [
  'chat',
  'messages',
  'gemini',
  'embeddings',
  'transcriptions',
  'speech',
  'images',
  'responses',
  'ollama',
];

export const OAUTH_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude Code Pro/Max)' },
  { value: 'github-copilot', label: 'GitHub Copilot' },
  { value: 'google-gemini-cli', label: 'Google Cloud Code Assist (Gemini CLI)' },
  { value: 'google-antigravity', label: 'Antigravity (Gemini 3, Claude, GPT-OSS)' },
  { value: 'openai-codex', label: 'ChatGPT Plus/Pro (Codex Subscription)' },
];

const QUOTA_CHECKER_TYPES_FALLBACK = [
  'synthetic',
  'naga',
  'nanogpt',
  'openai-codex',
  'claude-code',
  'kimi-code',
  'zai',
  'moonshot',
  'novita',
  'minimax',
  'minimax-coding',
  'openrouter',
  'kilo',
  'wisdomgate',
  'apertis',
  'poe',
  'copilot',
  'gemini-cli',
  'antigravity',
  'ollama',
  'neuralwatt',
  'zenmux',
  'devpass',
  'wafer',
  'opencode-go',
] as const;

const getOAuthCheckerType = (oauthProvider?: string): string | null => {
  if (!oauthProvider) return null;
  const map: Record<string, string> = {
    'openai-codex': 'openai-codex',
    anthropic: 'claude-code',
    'claude-code': 'claude-code',
    'github-copilot': 'copilot',
    'google-gemini-cli': 'gemini-cli',
    'google-antigravity': 'antigravity',
  };
  return map[oauthProvider] ?? null;
};

const inferProviderTypes = (apiBaseUrl?: string | Record<string, string>): string[] => {
  if (!apiBaseUrl) return ['chat'];
  if (typeof apiBaseUrl === 'string') {
    const url = apiBaseUrl.toLowerCase();
    if (url.startsWith('oauth://')) return ['oauth'];
    if (url.includes('anthropic.com')) return ['messages'];
    if (url.includes('generativelanguage.googleapis.com')) return ['gemini'];
    return ['chat'];
  }
  return Object.keys(apiBaseUrl).filter((key) => {
    const value = apiBaseUrl[key];
    return typeof value === 'string' && value.length > 0;
  });
};

export const EMPTY_PROVIDER: Provider = {
  id: '',
  name: '',
  type: [],
  apiKey: '',
  oauthProvider: '',
  oauthAccount: '',
  enabled: true,
  disableCooldown: false,
  estimateTokens: false,
  useClaudeMasking: false,
  apiBaseUrl: {},
  headers: {},
  extraBody: {},
  models: {},
};

export interface FetchedModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  object?: string;
  owned_by?: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
}

export function useProviderForm() {
  const toast = useToast();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider>(EMPTY_PROVIDER);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [quotaCheckerTypes, setQuotaCheckerTypes] = useState<string[]>([
    ...QUOTA_CHECKER_TYPES_FALLBACK,
  ]);
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(true);

  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
  const [oauthPromptValue, setOauthPromptValue] = useState('');
  const [oauthManualCode, setOauthManualCode] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthCredentialReady, setOauthCredentialReady] = useState(false);
  const [oauthCredentialChecking, setOauthCredentialChecking] = useState(false);

  // Accordion state
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [openModelIdx, setOpenModelIdx] = useState<string | null>(null);
  const [isApiBaseUrlsOpen, setIsApiBaseUrlsOpen] = useState(true);
  const [isHeadersOpen, setIsHeadersOpen] = useState(false);
  const [isExtraBodyOpen, setIsExtraBodyOpen] = useState(false);
  const [isModelExtraBodyOpen, setIsModelExtraBodyOpen] = useState<Record<string, boolean>>({});
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Fetch Models Modal state
  const [isFetchModelsModalOpen, setIsFetchModelsModalOpen] = useState(false);
  const [modelsUrl, setModelsUrl] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [deleteModalProvider, setDeleteModalProvider] = useState<Provider | null>(null);
  const [deleteModalLoading, setDeleteModalLoading] = useState(false);
  const [affectedAliases, setAffectedAliases] = useState<
    { aliasId: string; targetsCount: number }[]
  >([]);

  const [testStates, setTestStates] = useState<
    Record<
      string,
      {
        loading: boolean;
        result?: 'success' | 'error';
        message?: string;
        showResult: boolean;
        showMessage?: boolean;
      }
    >
  >({});

  // Derived
  const isOAuthMode =
    typeof editingProvider.apiBaseUrl === 'string' &&
    editingProvider.apiBaseUrl.toLowerCase().startsWith('oauth://');
  const oauthCheckerType = isOAuthMode ? getOAuthCheckerType(editingProvider.oauthProvider) : null;
  const selectableQuotaCheckerTypes = oauthCheckerType
    ? [oauthCheckerType]
    : isOAuthMode
      ? []
      : quotaCheckerTypes;
  const selectedQuotaCheckerType =
    editingProvider.quotaChecker?.type &&
    (selectableQuotaCheckerTypes.includes(editingProvider.quotaChecker.type) ||
      editingProvider.quotaChecker.type === oauthCheckerType)
      ? editingProvider.quotaChecker.type
      : '';

  const oauthStatus = oauthSession?.status;
  const oauthIsTerminal = oauthStatus
    ? ['success', 'error', 'cancelled'].includes(oauthStatus)
    : false;
  const oauthStatusLabel = oauthStatus
    ? {
        in_progress: 'Starting',
        awaiting_auth: 'Awaiting browser',
        awaiting_prompt: 'Awaiting input',
        awaiting_manual_code: 'Awaiting redirect',
        success: 'Authenticated',
        error: 'Error',
        cancelled: 'Cancelled',
      }[oauthStatus] || oauthStatus
    : oauthCredentialChecking
      ? 'Checking...'
      : oauthCredentialReady
        ? 'Ready'
        : 'Not started';

  // Effects
  useEffect(() => {
    initQuotaCheckerTypes().then(() => {
      const types = Array.from(getQuotaCheckerTypes());
      setQuotaCheckerTypes(types.length > 0 ? types : [...QUOTA_CHECKER_TYPES_FALLBACK]);
    });
  }, []);

  useEffect(() => {
    api
      .getQuotas()
      .then(setQuotas)
      .catch(() => {})
      .finally(() => setQuotasLoading(false));
  }, []);

  const loadData = async () => {
    try {
      const p = await api.getProviders();
      setProviders(p);
    } catch (e) {
      console.error('Failed to load data', e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Modal close resets OAuth
  useEffect(() => {
    if (!isModalOpen) {
      resetOAuthState();
      setOauthCredentialReady(false);
      setOauthCredentialChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  // OAuth credential check
  useEffect(() => {
    if (!isModalOpen || !isOAuthMode) {
      setOauthCredentialReady(false);
      setOauthCredentialChecking(false);
      return;
    }
    const providerId = editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value;
    const accountId = editingProvider.oauthAccount?.trim();
    if (!accountId) {
      setOauthCredentialReady(false);
      setOauthCredentialChecking(false);
      return;
    }
    let cancelled = false;
    setOauthCredentialChecking(true);
    api
      .getOAuthCredentialStatus(providerId, accountId)
      .then((result) => {
        if (!cancelled) setOauthCredentialReady(!!result.ready);
      })
      .catch(() => {
        if (!cancelled) setOauthCredentialReady(false);
      })
      .finally(() => {
        if (!cancelled) setOauthCredentialChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isModalOpen,
    isOAuthMode,
    editingProvider.oauthProvider,
    editingProvider.oauthAccount,
    oauthStatus,
  ]);

  useEffect(() => {
    if (!isOAuthMode) return;
    resetOAuthState();
  }, [editingProvider.oauthProvider, isOAuthMode]);

  // OAuth session polling
  useEffect(() => {
    if (!oauthSessionId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const session = await api.getOAuthSession(oauthSessionId);
        if (cancelled) return;
        setOauthSession(session);
        if (['awaiting_prompt', 'awaiting_manual_code', 'awaiting_auth'].includes(session.status)) {
          setOauthBusy(false);
        }
        if (['success', 'error', 'cancelled'].includes(session.status)) {
          setOauthBusy(false);
          return;
        }
        setTimeout(poll, 1000);
      } catch (error) {
        if (!cancelled) {
          setOauthError(error instanceof Error ? error.message : 'Failed to load OAuth session');
          setOauthBusy(false);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [oauthSessionId]);

  // Handlers
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

  const openDeleteModal = async (provider: Provider) => {
    const affected = await api.getAffectedAliases(provider.id);
    setAffectedAliases(affected);
    setDeleteModalProvider(provider);
  };

  const handleDelete = async (cascade: boolean) => {
    if (!deleteModalProvider) return;
    setDeleteModalLoading(true);
    try {
      await api.deleteProvider(deleteModalProvider.id, cascade);
      await loadData();
      setDeleteModalProvider(null);
    } catch (e) {
      toast.error('Failed to delete provider: ' + e);
    } finally {
      setDeleteModalLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editingProvider.id) {
      toast.error('Provider ID is required');
      return;
    }
    setIsSaving(true);
    try {
      let providerToSave = editingProvider;
      if (isOAuthMode && !providerToSave.oauthProvider) {
        providerToSave = { ...providerToSave, oauthProvider: OAUTH_PROVIDERS[0].value };
      }
      if (isOAuthMode && !providerToSave.oauthAccount?.trim()) {
        toast.error('OAuth account is required');
        return;
      }
      if (providerToSave.quotaChecker && !providerToSave.quotaChecker.type?.trim()) {
        providerToSave = { ...providerToSave, quotaChecker: undefined };
      }
      await api.saveProvider(providerToSave, originalId || undefined);
      await loadData();
      setIsModalOpen(false);
    } catch (e) {
      console.error('Save error', e);
      toast.error('Failed to save provider: ' + e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (provider: Provider, newState: boolean) => {
    setProviders(providers.map((p) => (p.id === provider.id ? { ...p, enabled: newState } : p)));
    try {
      await api.saveProvider({ ...provider, enabled: newState }, provider.id);
    } catch (e) {
      console.error('Toggle error', e);
      toast.error('Failed to update provider status: ' + e);
      loadData();
    }
  };

  const handleTestModel = async (providerId: string, modelId: string, modelType?: string) => {
    const testKey = `${providerId}-${modelId}`;
    setTestStates((prev) => ({
      ...prev,
      [testKey]: { loading: true, showResult: true, showMessage: false },
    }));
    let testApiTypes: string[] = ['chat'];
    if (modelType === 'embeddings') testApiTypes = ['embeddings'];
    else if (modelType === 'image') testApiTypes = ['images'];
    else if (modelType === 'responses') testApiTypes = ['responses'];
    else if (modelType === 'transcriptions') testApiTypes = ['transcriptions'];
    else if (modelType === 'speech') testApiTypes = ['speech'];
    try {
      const results = await Promise.all(
        testApiTypes.map((t) => api.testModel(providerId, modelId, t))
      );
      const allSuccess = results.every((r) => r.success);
      const firstError = results.find((r) => !r.success);
      const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
      const avgDuration = Math.round(totalDuration / results.length);
      setTestStates((prev) => ({
        ...prev,
        [testKey]: {
          loading: false,
          result: allSuccess ? 'success' : 'error',
          message: allSuccess
            ? `Success (${avgDuration}ms avg, ${testApiTypes.length} API${testApiTypes.length > 1 ? 's' : ''})`
            : `Failed via ${firstError?.apiType || 'unknown'}: ${firstError?.error || 'Test failed'}`,
          showResult: true,
          showMessage: true,
        },
      }));
      setTimeout(
        () => {
          setTestStates((prev) => ({
            ...prev,
            [testKey]: { ...prev[testKey], showResult: false },
          }));
        },
        allSuccess ? 3000 : 1500
      );
      if (allSuccess) {
        setTimeout(() => {
          setTestStates((prev) => ({
            ...prev,
            [testKey]: { ...prev[testKey], showMessage: false },
          }));
        }, 3000);
      }
    } catch (e) {
      setTestStates((prev) => ({
        ...prev,
        [testKey]: {
          loading: false,
          result: 'error',
          message: String(e),
          showResult: true,
          showMessage: true,
        },
      }));
      setTimeout(() => {
        setTestStates((prev) => ({
          ...prev,
          [testKey]: { ...prev[testKey], showResult: false },
        }));
      }, 1500);
    }
  };

  const dismissTestMessage = (testKey: string) => {
    setTestStates((prev) => ({
      ...prev,
      [testKey]: { ...prev[testKey], showMessage: false },
    }));
  };

  // OAuth handlers
  const resetOAuthState = () => {
    setOauthSessionId(null);
    setOauthSession(null);
    setOauthPromptValue('');
    setOauthManualCode('');
    setOauthError(null);
    setOauthBusy(false);
  };

  const handleStartOAuth = async () => {
    const providerId = editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value;
    const accountId = editingProvider.oauthAccount?.trim();
    if (!accountId) {
      setOauthError('OAuth account is required before starting login');
      return;
    }
    setOauthBusy(true);
    setOauthError(null);
    setOauthSession(null);
    setOauthSessionId(null);
    try {
      const session = await api.startOAuthSession(providerId, accountId);
      setOauthSessionId(session.id);
      setOauthSession(session);
      if (['awaiting_prompt', 'awaiting_manual_code', 'awaiting_auth'].includes(session.status))
        setOauthBusy(false);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : 'Failed to start OAuth');
      setOauthBusy(false);
    }
  };

  const handleSubmitPrompt = async () => {
    if (!oauthSessionId) return;
    setOauthBusy(true);
    setOauthError(null);
    try {
      const session = await api.submitOAuthPrompt(oauthSessionId, oauthPromptValue);
      setOauthSession(session);
      setOauthPromptValue('');
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : 'Failed to submit prompt');
    } finally {
      setOauthBusy(false);
    }
  };

  const handleSubmitManualCode = async () => {
    if (!oauthSessionId) return;
    setOauthBusy(true);
    setOauthError(null);
    try {
      const session = await api.submitOAuthManualCode(oauthSessionId, oauthManualCode);
      setOauthSession(session);
      setOauthManualCode('');
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : 'Failed to submit code');
    } finally {
      setOauthBusy(false);
    }
  };

  const handleCancelOAuth = async () => {
    if (!oauthSessionId) return;
    setOauthBusy(true);
    setOauthError(null);
    try {
      const session = await api.cancelOAuthSession(oauthSessionId);
      setOauthSession(session);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : 'Failed to cancel session');
    } finally {
      setOauthBusy(false);
    }
  };

  // API URL helpers
  const getApiBaseUrlMap = (): Record<string, string> => {
    if (
      typeof editingProvider.apiBaseUrl === 'object' &&
      editingProvider.apiBaseUrl !== null &&
      !Array.isArray(editingProvider.apiBaseUrl)
    ) {
      return { ...(editingProvider.apiBaseUrl as Record<string, string>) };
    }
    if (typeof editingProvider.apiBaseUrl === 'string' && editingProvider.apiBaseUrl.trim()) {
      const inferredTypes = inferProviderTypes(editingProvider.apiBaseUrl);
      return { [inferredTypes[0] || 'chat']: editingProvider.apiBaseUrl };
    }
    return {};
  };

  const getApiUrlValue = (apiType: string) => {
    if (typeof editingProvider.apiBaseUrl === 'string') {
      const types = Array.isArray(editingProvider.type)
        ? editingProvider.type
        : [editingProvider.type];
      if (types.includes(apiType) && types.length === 1) return editingProvider.apiBaseUrl;
      return '';
    }
    return (editingProvider.apiBaseUrl as any)?.[apiType] || '';
  };

  const addApiBaseUrlEntry = () => {
    if (isOAuthMode) return;
    const currentMap = getApiBaseUrlMap();
    const nextType = KNOWN_APIS.find((t) => !(t in currentMap));
    if (!nextType) return;
    const updated = { ...currentMap, [nextType]: '' };
    setEditingProvider({
      ...editingProvider,
      apiBaseUrl: updated,
      type: inferProviderTypes(updated),
    });
    setIsApiBaseUrlsOpen(true);
  };

  const updateApiBaseUrlEntry = (oldType: string, newType: string, url: string) => {
    if (isOAuthMode) return;
    const currentMap = getApiBaseUrlMap();
    const updated: Record<string, string> = { ...currentMap };
    delete updated[oldType];
    const normalizedType = newType.trim();
    if (normalizedType) updated[normalizedType] = url;
    setEditingProvider({
      ...editingProvider,
      apiBaseUrl: updated,
      type: inferProviderTypes(updated),
    });
  };

  const removeApiBaseUrlEntry = (apiType: string) => {
    if (isOAuthMode) return;
    const currentMap = getApiBaseUrlMap();
    const updated = { ...currentMap };
    delete updated[apiType];
    setEditingProvider({
      ...editingProvider,
      apiBaseUrl: updated,
      type: inferProviderTypes(updated),
    });
  };

  // Generic KV helpers
  const addKV = (field: 'headers' | 'extraBody') => {
    const current = editingProvider[field] || {};
    setEditingProvider({ ...editingProvider, [field]: { ...current, '': '' } });
  };

  const updateKV = (field: 'headers' | 'extraBody', oldKey: string, newKey: string, value: any) => {
    const current = { ...(editingProvider[field] || {}) };
    if (oldKey !== newKey) delete current[oldKey];
    current[newKey] = value;
    setEditingProvider({ ...editingProvider, [field]: current });
  };

  const removeKV = (field: 'headers' | 'extraBody', key: string) => {
    const current = { ...(editingProvider[field] || {}) };
    delete current[key];
    setEditingProvider({ ...editingProvider, [field]: current });
  };

  // Model-level extraBody helpers
  const addModelKV = (modelId: string) => {
    const models = { ...(editingProvider.models as Record<string, any>) };
    const current = models[modelId]?.extraBody || {};
    models[modelId] = { ...models[modelId], extraBody: { ...current, '': '' } };
    setEditingProvider({ ...editingProvider, models });
  };

  const updateModelKV = (modelId: string, oldKey: string, newKey: string, value: any) => {
    const models = { ...(editingProvider.models as Record<string, any>) };
    const current = { ...(models[modelId]?.extraBody || {}) };
    if (oldKey !== newKey) delete current[oldKey];
    current[newKey] = value;
    models[modelId] = { ...models[modelId], extraBody: current };
    setEditingProvider({ ...editingProvider, models });
  };

  const removeModelKV = (modelId: string, key: string) => {
    const models = { ...(editingProvider.models as Record<string, any>) };
    const current = { ...(models[modelId]?.extraBody || {}) };
    delete current[key];
    models[modelId] = { ...models[modelId], extraBody: current };
    setEditingProvider({ ...editingProvider, models });
  };

  // Model management
  const addModel = () => {
    const modelId = `model-${Date.now()}`;
    const newModels = {
      ...(typeof editingProvider.models === 'object' && !Array.isArray(editingProvider.models)
        ? editingProvider.models
        : {}),
    };
    newModels[modelId] = { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] };
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

  // Fetch models helpers
  const generateModelsUrl = (): string => {
    if (isOAuthMode) return '';
    const ollamaUrl = getApiUrlValue('ollama');
    if (ollamaUrl) return 'https://ollama.com/api/tags';
    const chatUrl = getApiUrlValue('chat');
    if (!chatUrl) return '';
    return `${chatUrl.replace(/\/chat\/completions\/?$/, '')}/models`;
  };

  const handleOpenFetchModels = () => {
    const defaultUrl = generateModelsUrl();
    setModelsUrl(defaultUrl);
    setFetchedModels([]);
    setSelectedModelIds(new Set());
    setFetchError(null);
    setIsFetchModelsModalOpen(true);
  };

  const handleFetchModels = async () => {
    if (isOAuthMode) {
      const oauthProvider = editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value;
      setIsFetchingModels(true);
      setFetchError(null);
      try {
        const models = await api.getOAuthProviderModels(oauthProvider);
        const sortedModels = [...models].sort((a, b) => a.id.localeCompare(b.id));
        if (sortedModels.length === 0) {
          setFetchError(`No models found for OAuth provider '${oauthProvider}'.`);
          setFetchedModels([]);
          setSelectedModelIds(new Set());
          return;
        }
        setFetchedModels(sortedModels);
        setSelectedModelIds(new Set());
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : 'Failed to fetch models');
        setFetchedModels([]);
      } finally {
        setIsFetchingModels(false);
      }
      return;
    }
    if (!modelsUrl) {
      setFetchError('Please enter a URL');
      return;
    }
    setIsFetchingModels(true);
    setFetchError(null);
    try {
      const data = await api.fetchProviderModels(modelsUrl, editingProvider.apiKey);
      if (!data.data || !Array.isArray(data.data)) throw new Error('Invalid response format');
      setFetchedModels(
        [...data.data].sort((a: FetchedModel, b: FetchedModel) => a.id.localeCompare(b.id))
      );
      setSelectedModelIds(new Set());
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch models');
      setFetchedModels([]);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const toggleModelSelection = (modelId: string) => {
    const next = new Set(selectedModelIds);
    if (next.has(modelId)) next.delete(modelId);
    else next.add(modelId);
    setSelectedModelIds(next);
  };

  const handleAddSelectedModels = () => {
    const models = {
      ...(typeof editingProvider.models === 'object' && !Array.isArray(editingProvider.models)
        ? editingProvider.models
        : {}),
    };
    fetchedModels.forEach((model) => {
      if (selectedModelIds.has(model.id) && !models[model.id]) {
        models[model.id] = { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] };
      }
    });
    setEditingProvider({ ...editingProvider, models });
    setIsFetchModelsModalOpen(false);
  };

  const validateQuotaChecker = (): string | null => {
    const quotaType = editingProvider.quotaChecker?.type;
    const options = editingProvider.quotaChecker?.options || {};
    if (!quotaType) return null;
    if (quotaType === 'naga' && (!options.apiKey || !(options.apiKey as string).trim()))
      return 'Provisioning API Key is required for Naga quota checker';
    if (quotaType === 'minimax') {
      if (!options.groupid || !(options.groupid as string).trim())
        return 'Group ID is required for MiniMax quota checker';
      if (!options.hertzSession || !(options.hertzSession as string).trim())
        return 'HERTZ-SESSION cookie value is required for MiniMax quota checker';
    }
    if (quotaType === 'wisdomgate' && (!options.session || !(options.session as string).trim()))
      return 'Session cookie is required for Wisdom Gate quota checker';
    if (quotaType === 'devpass' && (!options.session || !(options.session as string).trim()))
      return 'Session cookie is required for DevPass quota checker';
    if (quotaType === 'opencode-go') {
      if (!options.workspaceId || !(options.workspaceId as string).trim())
        return 'Workspace ID is required for OpenCode Go quota checker';
      if (!options.authCookie || !(options.authCookie as string).trim())
        return 'Auth cookie is required for OpenCode Go quota checker';
    }
    return null;
  };

  const getQuotaDisplay = (provider: Provider): React.ReactNode => {
    if (!provider.quotaChecker?.enabled) return null;
    if (quotasLoading) return <span className="text-text-secondary text-xs">—</span>;
    const quota = quotas.find((q) => q.checkerId === provider.id);
    if (!quota?.meters?.length) return null;
    const handleQuotaClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigate('/quotas');
    };
    const balanceMeter = quota.meters.find(
      (m) => m.kind === 'balance' && m.remaining !== undefined
    );
    if (balanceMeter && balanceMeter.remaining !== undefined) {
      return (
        <Badge
          status="neutral"
          className="[&_.connection-dot]:hidden cursor-pointer text-[10px] py-0.5 px-2 bg-bg-subtle border border-border text-text-secondary"
          onClick={handleQuotaClick}
        >
          {formatMeterValue(balanceMeter.remaining, balanceMeter.unit)}
        </Badge>
      );
    }
    const allowances = quota.meters.filter((m) => m.kind === 'allowance');
    const primary = allowances.reduce<(typeof allowances)[0] | undefined>((worst, m) => {
      if (!worst) return m;
      const wu = typeof worst.utilizationPercent === 'number' ? worst.utilizationPercent : 0;
      const mu = typeof m.utilizationPercent === 'number' ? m.utilizationPercent : 0;
      return mu > wu ? m : worst;
    }, undefined);
    if (!primary || typeof primary.utilizationPercent !== 'number') return null;
    const pct = Math.round(primary.utilizationPercent);
    const status = pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'connected';
    return (
      <Badge
        status={status}
        className="[&_.connection-dot]:hidden cursor-pointer text-[10px] py-0.5 px-2"
        onClick={handleQuotaClick}
      >
        {pct}%
      </Badge>
    );
  };

  const sortedProviders = [...providers].sort((a, b) => a.id.localeCompare(b.id));
  const quotaValidationError = validateQuotaChecker();

  return {
    // State
    providers,
    sortedProviders,
    isModalOpen,
    setIsModalOpen,
    editingProvider,
    setEditingProvider,
    originalId,
    isSaving,
    quotaCheckerTypes,
    quotas,
    quotasLoading,
    oauthSessionId,
    oauthSession,
    oauthPromptValue,
    setOauthPromptValue,
    oauthManualCode,
    setOauthManualCode,
    oauthError,
    oauthBusy,
    oauthCredentialReady,
    oauthCredentialChecking,
    oauthStatus,
    oauthIsTerminal,
    oauthStatusLabel,
    isOAuthMode,
    oauthCheckerType,
    selectableQuotaCheckerTypes,
    selectedQuotaCheckerType,
    quotaValidationError,
    // Accordion
    isModelsOpen,
    setIsModelsOpen,
    openModelIdx,
    setOpenModelIdx,
    isApiBaseUrlsOpen,
    setIsApiBaseUrlsOpen,
    isHeadersOpen,
    setIsHeadersOpen,
    isExtraBodyOpen,
    setIsExtraBodyOpen,
    isModelExtraBodyOpen,
    setIsModelExtraBodyOpen,
    isAdvancedOpen,
    setIsAdvancedOpen,
    // Fetch models
    isFetchModelsModalOpen,
    setIsFetchModelsModalOpen,
    modelsUrl,
    setModelsUrl,
    isFetchingModels,
    fetchedModels,
    selectedModelIds,
    setSelectedModelIds,
    fetchError,
    // Delete
    deleteModalProvider,
    setDeleteModalProvider,
    deleteModalLoading,
    affectedAliases,
    // Test
    testStates,
    dismissTestMessage,
    // Handlers
    handleEdit,
    handleAddNew,
    handleSave,
    handleDelete,
    handleToggleEnabled,
    handleTestModel,
    openDeleteModal,
    // OAuth
    handleStartOAuth,
    handleSubmitPrompt,
    handleSubmitManualCode,
    handleCancelOAuth,
    // API URLs
    getApiBaseUrlMap,
    getApiUrlValue,
    addApiBaseUrlEntry,
    updateApiBaseUrlEntry,
    removeApiBaseUrlEntry,
    // KV
    addKV,
    updateKV,
    removeKV,
    // Model KV
    addModelKV,
    updateModelKV,
    removeModelKV,
    // Models
    addModel,
    updateModelId,
    updateModelConfig,
    removeModel,
    // Fetch
    handleOpenFetchModels,
    handleFetchModels,
    toggleModelSelection,
    handleAddSelectedModels,
    // Quota
    getQuotaDisplay,
    // Constants
    KNOWN_APIS,
    OAUTH_PROVIDERS,
  };
}
