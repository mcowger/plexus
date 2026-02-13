import { useEffect, useState } from 'react';
import { api, Provider, OAuthSession } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, X, Download, Info } from 'lucide-react';

import { Switch } from '../components/ui/Switch';
import { OpenRouterSlugInput } from '../components/ui/OpenRouterSlugInput';
import { NagaQuotaConfig } from '../components/quota/NagaQuotaConfig';
import { SyntheticQuotaConfig } from '../components/quota/SyntheticQuotaConfig';
import { NanoGPTQuotaConfig } from '../components/quota/NanoGPTQuotaConfig';
import { ZAIQuotaConfig } from '../components/quota/ZAIQuotaConfig';
import { MoonshotQuotaConfig } from '../components/quota/MoonshotQuotaConfig';
import { MiniMaxQuotaConfig } from '../components/quota/MiniMaxQuotaConfig';

const KNOWN_APIS = ['chat', 'messages', 'gemini', 'embeddings', 'transcriptions', 'speech', 'images', 'responses'];

const OAUTH_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude Code Pro/Max)' },
  { value: 'github-copilot', label: 'GitHub Copilot' },
  { value: 'google-gemini-cli', label: 'Google Cloud Code Assist (Gemini CLI)' },
  { value: 'google-antigravity', label: 'Antigravity (Gemini 3, Claude, GPT-OSS)' },
  { value: 'openai-codex', label: 'ChatGPT Plus/Pro (Codex Subscription)' }
];

const QUOTA_CHECKER_TYPES = ['synthetic', 'naga', 'nanogpt', 'openai-codex', 'claude-code', 'zai', 'moonshot', 'minimax'] as const;
const VALID_QUOTA_CHECKER_TYPES = new Set<string>(QUOTA_CHECKER_TYPES);

const getForcedOAuthQuotaCheckerType = (oauthProvider?: string): string | null => {
  if (!oauthProvider) return null;
  if (oauthProvider === 'openai-codex') return 'openai-codex';
  if (oauthProvider === 'anthropic' || oauthProvider === 'claude-code') return 'claude-code';
  return null;
};

const getApiBadgeStyle = (apiType: string): React.CSSProperties => {
    switch (apiType.toLowerCase()) {
        case 'messages':
            return { backgroundColor: '#D97757', color: 'white', border: 'none' };
        case 'chat':
            return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
        case 'gemini':
            return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
        case 'embeddings':
            return { backgroundColor: '#10b981', color: 'white', border: 'none' };
        case 'transcriptions':
            return { backgroundColor: '#a855f7', color: 'white', border: 'none' };
        case 'speech':
            return { backgroundColor: '#f97316', color: 'white', border: 'none' };
        case 'images':
            return { backgroundColor: '#d946ef', color: 'white', border: 'none' };
        case 'responses':
            return { backgroundColor: '#06b6d4', color: 'white', border: 'none' };
        case 'oauth':
            return { backgroundColor: '#111827', color: 'white', border: 'none' };
        default:
            return {};
    }
};

/**
 * Infer provider API types from api_base_url
 * Matches the backend inference logic
 */
const inferProviderTypes = (apiBaseUrl?: string | Record<string, string>): string[] => {
  if (!apiBaseUrl) {
    return ['chat']; // Default fallback
  }

  if (typeof apiBaseUrl === 'string') {
    const url = apiBaseUrl.toLowerCase();
    if (url.startsWith('oauth://')) {
      return ['oauth'];
    }
    if (url.includes('anthropic.com')) {
      return ['messages'];
    } else if (url.includes('generativelanguage.googleapis.com')) {
      return ['gemini'];
    } else {
      return ['chat'];
    }
  } else {
    return Object.keys(apiBaseUrl).filter(key => {
      const value = apiBaseUrl[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
};

const EMPTY_PROVIDER: Provider = {
    id: '',
    name: '',
    type: [],
    apiKey: '',
    oauthProvider: '',
    oauthAccount: '',
    enabled: true,
    estimateTokens: false,
    apiBaseUrl: {},
    headers: {},
    extraBody: {},
    models: {}
};

interface FetchedModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  object?: string;
  owned_by?: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

const OAUTH_PROVIDER_MODELS: Record<string, FetchedModel[]> = {
  anthropic: [
    { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude Haiku 3.5 (latest)' },
    { id: 'claude-3-5-sonnet-20240620', name: 'Claude Sonnet 3.5' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude Sonnet 3.5 v2' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7' },
    { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (latest)' },
    { id: 'claude-3-haiku-20240307', name: 'Claude Haiku 3' },
    { id: 'claude-3-opus-20240229', name: 'Claude Opus 3' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude Sonnet 3' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (latest)' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-0', name: 'Claude Opus 4 (latest)' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1 (latest)' },
    { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (latest)' },
    { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-0', name: 'Claude Sonnet 4 (latest)' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (latest)' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' }
  ],
  'openai-codex': [
    { id: 'gpt-5.1', name: 'GPT-5.1' },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' }
  ],
  'github-copilot': [
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'gpt-5-mini', name: 'GPT-5-mini' },
    { id: 'gpt-5.1', name: 'GPT-5.1' },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1-Codex' },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1-Codex-max' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1-Codex-mini' },
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex' },
    { id: 'grok-code-fast-1', name: 'Grok Code Fast 1' }
  ],
  'google-gemini-cli': [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Cloud Code Assist)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Cloud Code Assist)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Cloud Code Assist)' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview (Cloud Code Assist)' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview (Cloud Code Assist)' }
  ],
  'google-antigravity': [
    { id: 'claude-opus-4-5-thinking', name: 'Claude Opus 4.5 Thinking (Antigravity)' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Antigravity)' },
    { id: 'claude-sonnet-4-5-thinking', name: 'Claude Sonnet 4.5 Thinking (Antigravity)' },
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash (Antigravity)' },
    { id: 'gemini-3-pro-high', name: 'Gemini 3 Pro High (Antigravity)' },
    { id: 'gemini-3-pro-low', name: 'Gemini 3 Pro Low (Antigravity)' },
    { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium (Antigravity)' }
  ]
};

export const Providers = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider>(EMPTY_PROVIDER);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
  const [oauthPromptValue, setOauthPromptValue] = useState('');
  const [oauthManualCode, setOauthManualCode] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthCredentialReady, setOauthCredentialReady] = useState(false);
  const [oauthCredentialChecking, setOauthCredentialChecking] = useState(false);

  const isOAuthMode =
    typeof editingProvider.apiBaseUrl === 'string' &&
    editingProvider.apiBaseUrl.toLowerCase().startsWith('oauth://');
  const forcedOAuthQuotaCheckerType = isOAuthMode
    ? getForcedOAuthQuotaCheckerType(editingProvider.oauthProvider)
    : null;
  const selectableQuotaCheckerTypes = forcedOAuthQuotaCheckerType
    ? [forcedOAuthQuotaCheckerType]
    : isOAuthMode
      ? QUOTA_CHECKER_TYPES.filter((type) => type !== 'openai-codex' && type !== 'claude-code')
      : QUOTA_CHECKER_TYPES.filter((type) => type !== 'openai-codex' && type !== 'claude-code');
  const selectedQuotaCheckerType = forcedOAuthQuotaCheckerType
    ? forcedOAuthQuotaCheckerType
    : (editingProvider.quotaChecker?.type && selectableQuotaCheckerTypes.includes(editingProvider.quotaChecker.type)
      ? editingProvider.quotaChecker.type
      : '');

  const validateQuotaChecker = (): string | null => {
    const quotaType = editingProvider.quotaChecker?.type;
    const options = editingProvider.quotaChecker?.options || {};
    
    if (!quotaType) return null;
    
    if (quotaType === 'naga') {
      if (!options.apiKey || !(options.apiKey as string).trim()) {
        return 'Provisioning API Key is required for Naga quota checker';
      }
    }

    if (quotaType === 'minimax') {
      if (!options.groupid || !(options.groupid as string).trim()) {
        return 'Group ID is required for MiniMax quota checker';
      }
      if (!options.hertzSession || !(options.hertzSession as string).trim()) {
        return 'HERTZ-SESSION cookie value is required for MiniMax quota checker';
      }
    }
    
    // synthetic and nanogpt don't require options - they use the provider's api_key
    
    return null;
  };

  const quotaValidationError = validateQuotaChecker();

  const oauthStatus = oauthSession?.status;
  const oauthIsTerminal = oauthStatus ? ['success', 'error', 'cancelled'].includes(oauthStatus) : false;
  const oauthStatusLabel = oauthStatus
    ? {
        in_progress: 'Starting',
        awaiting_auth: 'Awaiting browser',
        awaiting_prompt: 'Awaiting input',
        awaiting_manual_code: 'Awaiting redirect',
        success: 'Authenticated',
        error: 'Error',
        cancelled: 'Cancelled'
      }[oauthStatus] || oauthStatus
    : oauthCredentialChecking
      ? 'Checking...'
      : oauthCredentialReady
        ? 'Ready'
        : 'Not started';

  // Accordion state for Modal
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [openModelIdx, setOpenModelIdx] = useState<string | null>(null);
  const [isApiBaseUrlsOpen, setIsApiBaseUrlsOpen] = useState(true);
  const [isHeadersOpen, setIsHeadersOpen] = useState(false);
  const [isExtraBodyOpen, setIsExtraBodyOpen] = useState(false);

  // Fetch Models Modal state
  const [isFetchModelsModalOpen, setIsFetchModelsModalOpen] = useState(false);
  const [modelsUrl, setModelsUrl] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [deleteModalProvider, setDeleteModalProvider] = useState<Provider | null>(null);
  const [deleteModalLoading, setDeleteModalLoading] = useState(false);
  const [affectedAliases, setAffectedAliases] = useState<{ aliasId: string; targetsCount: number }[]>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
        const p = await api.getProviders();
        setProviders(p);
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
      alert("Failed to delete provider: " + e);
    } finally {
      setDeleteModalLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editingProvider.id) {
        alert("Provider ID is required");
        return;
    }
    setIsSaving(true);
    try {
        let providerToSave = editingProvider;
        if (isOAuthMode && !providerToSave.oauthProvider) {
          providerToSave = { ...providerToSave, oauthProvider: OAUTH_PROVIDERS[0].value };
        }
        if (isOAuthMode && !providerToSave.oauthAccount?.trim()) {
          alert('OAuth account is required');
          return;
        }
        if (providerToSave.quotaChecker) {
          const quotaType = providerToSave.quotaChecker.type?.trim();
          if (!quotaType) {
            providerToSave = {
              ...providerToSave,
              quotaChecker: undefined
            };
          } else {
            const isValidQuotaType = VALID_QUOTA_CHECKER_TYPES.has(quotaType);
            providerToSave = {
              ...providerToSave,
              quotaChecker: {
                type: quotaType,
                intervalMinutes: Math.max(1, providerToSave.quotaChecker.intervalMinutes || 30),
                enabled: isValidQuotaType ? providerToSave.quotaChecker.enabled !== false : false,
                options: providerToSave.quotaChecker.options
              }
            };
          }
        }
        if (isOAuthMode && providerToSave.oauthProvider) {
          const forcedType = getForcedOAuthQuotaCheckerType(providerToSave.oauthProvider);
          if (forcedType) {
            providerToSave = {
              ...providerToSave,
              quotaChecker: {
                type: forcedType,
                enabled: true,
                intervalMinutes: Math.max(1, providerToSave.quotaChecker?.intervalMinutes || 30),
                options: providerToSave.quotaChecker?.options
              }
            };
          }
        }
        await api.saveProvider(providerToSave, originalId || undefined);
        await loadData();
        setIsModalOpen(false);
    } catch (e) {
        console.error("Save error", e);
        alert("Failed to save provider: " + e);
    } finally {
        setIsSaving(false);
    }
  };

  const resetOAuthState = () => {
    setOauthSessionId(null);
    setOauthSession(null);
    setOauthPromptValue('');
    setOauthManualCode('');
    setOauthError(null);
    setOauthBusy(false);
  };

  useEffect(() => {
    if (!isModalOpen) {
      resetOAuthState();
      setOauthCredentialReady(false);
      setOauthCredentialChecking(false);
      return;
    }
  }, [isModalOpen]);

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
    api.getOAuthCredentialStatus(providerId, accountId)
      .then((result) => {
        if (cancelled) return;
        setOauthCredentialReady(!!result.ready);
      })
      .catch(() => {
        if (cancelled) return;
        setOauthCredentialReady(false);
      })
      .finally(() => {
        if (cancelled) return;
        setOauthCredentialChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isModalOpen, isOAuthMode, editingProvider.oauthProvider, editingProvider.oauthAccount, oauthStatus]);

  useEffect(() => {
    if (!isOAuthMode) return;
    resetOAuthState();
  }, [editingProvider.oauthProvider, isOAuthMode]);

  useEffect(() => {
    if (!forcedOAuthQuotaCheckerType) return;
    setEditingProvider((prev) => {
      const intervalMinutes = Math.max(1, prev.quotaChecker?.intervalMinutes || 30);
      if (
        prev.quotaChecker?.type === forcedOAuthQuotaCheckerType &&
        prev.quotaChecker?.enabled === true &&
        prev.quotaChecker?.intervalMinutes === intervalMinutes
      ) {
        return prev;
      }

      return {
        ...prev,
        quotaChecker: {
          type: forcedOAuthQuotaCheckerType,
          enabled: true,
          intervalMinutes
        }
      };
    });
  }, [forcedOAuthQuotaCheckerType]);

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
      if (['awaiting_prompt', 'awaiting_manual_code', 'awaiting_auth'].includes(session.status)) {
        setOauthBusy(false);
      }
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

  const handleToggleEnabled = async (provider: Provider, newState: boolean) => {
      const updated = providers.map(p => p.id === provider.id ? { ...p, enabled: newState } : p);
      setProviders(updated);

      try {
          const p = { ...provider, enabled: newState };
          await api.saveProvider(p, provider.id);
      } catch (e) {
          console.error("Toggle error", e);
          alert("Failed to update provider status: " + e);
          loadData();
      }
  };


  const getApiBaseUrlMap = (): Record<string, string> => {
    if (typeof editingProvider.apiBaseUrl === 'object' && editingProvider.apiBaseUrl !== null && !Array.isArray(editingProvider.apiBaseUrl)) {
      return { ...(editingProvider.apiBaseUrl as Record<string, string>) };
    }

    if (typeof editingProvider.apiBaseUrl === 'string' && editingProvider.apiBaseUrl.trim()) {
      const inferredTypes = inferProviderTypes(editingProvider.apiBaseUrl);
      const fallbackType = inferredTypes[0] || 'chat';
      return { [fallbackType]: editingProvider.apiBaseUrl };
    }

    return {};
  };

  const addApiBaseUrlEntry = () => {
    if (isOAuthMode) return;
    const currentMap = getApiBaseUrlMap();
    const nextType = KNOWN_APIS.find((apiType) => !(apiType in currentMap));
    if (!nextType) return;

    const updated = { ...currentMap, [nextType]: '' };
    setEditingProvider({
      ...editingProvider,
      apiBaseUrl: updated,
      type: inferProviderTypes(updated)
    });
    setIsApiBaseUrlsOpen(true);
  };

  const updateApiBaseUrlEntry = (oldType: string, newType: string, url: string) => {
    if (isOAuthMode) return;
    const currentMap = getApiBaseUrlMap();
    const updated: Record<string, string> = { ...currentMap };
    delete updated[oldType];

    const normalizedType = newType.trim();
    if (normalizedType && url.trim()) {
      updated[normalizedType] = url;
    }

    setEditingProvider({
      ...editingProvider,
      apiBaseUrl: updated,
      type: inferProviderTypes(updated)
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
      type: inferProviderTypes(updated)
    });
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

  // Generate default models URL from chat URL
  const generateModelsUrl = (): string => {
    if (isOAuthMode) return '';
    const chatUrl = getApiUrlValue('chat');
    if (!chatUrl) return '';
    
    // Remove /chat/completions suffix and add /models
    const baseUrl = chatUrl.replace(/\/chat\/completions\/?$/, '');
    return `${baseUrl}/models`;
  };

  // Open fetch models modal
  const handleOpenFetchModels = () => {
    const defaultUrl = generateModelsUrl();
    setModelsUrl(defaultUrl);
    setFetchedModels([]);
    setSelectedModelIds(new Set());
    setFetchError(null);
    setIsFetchModelsModalOpen(true);
  };

  // Fetch models from URL
  const handleFetchModels = async () => {
    if (isOAuthMode) {
      const oauthProvider = editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value;
      const oauthModels = OAUTH_PROVIDER_MODELS[oauthProvider] || [];
      const sortedModels = [...oauthModels].sort((a, b) => a.id.localeCompare(b.id));

      if (sortedModels.length === 0) {
        setFetchError(`No known models found for OAuth provider '${oauthProvider}'.`);
        setFetchedModels([]);
        setSelectedModelIds(new Set());
        return;
      }

      setFetchedModels(sortedModels);
      setSelectedModelIds(new Set());
      setFetchError(null);
      return;
    }

    if (!modelsUrl) {
      setFetchError('Please enter a URL');
      return;
    }

    setIsFetchingModels(true);
    setFetchError(null);
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add Bearer token if available
      if (editingProvider.apiKey) {
        headers['Authorization'] = `Bearer ${editingProvider.apiKey}`;
      }

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format: expected { data: [...] }');
      }

      // Sort models alphabetically by ID
      const sortedModels = [...data.data].sort((a, b) => a.id.localeCompare(b.id));
      setFetchedModels(sortedModels);
      setSelectedModelIds(new Set());
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch models');
      setFetchedModels([]);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Toggle model selection
  const toggleModelSelection = (modelId: string) => {
    const newSelection = new Set(selectedModelIds);
    if (newSelection.has(modelId)) {
      newSelection.delete(modelId);
    } else {
      newSelection.add(modelId);
    }
    setSelectedModelIds(newSelection);
  };

  // Add selected models to provider
  const handleAddSelectedModels = () => {
    const models = { ...(typeof editingProvider.models === 'object' && !Array.isArray(editingProvider.models) ? editingProvider.models : {}) };
    
    fetchedModels.forEach(model => {
      if (selectedModelIds.has(model.id)) {
        // Only add if not already exists
        if (!models[model.id]) {
          models[model.id] = {
            pricing: { source: 'simple', input: 0, output: 0 },
            access_via: []
          };
        }
      }
    });

    setEditingProvider({ ...editingProvider, models });
    setIsFetchModelsModalOpen(false);
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <Card 
        title="Configured Providers"
        extra={<Button leftIcon={<Plus size={16}/>} onClick={handleAddNew}>Add Provider</Button>}
      >
          <div className="overflow-x-auto -m-6">
              <table className="w-full border-collapse font-body text-[13px]">
                  <thead>
                      <tr>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingLeft: '24px'}}>ID / Name</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">APIs</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Models</th>
                          <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider" style={{paddingRight: '24px', textAlign: 'right'}}>Actions</th>
                      </tr>
                  </thead>
                  <tbody>
                      {providers.map(p => (
                          <tr key={p.id} onClick={() => handleEdit(p)} style={{cursor: 'pointer'}} className="hover:bg-bg-hover">
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingLeft: '24px'}}>
                                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                      <Edit2 size={12} style={{opacity: 0.5}} />
                                      <div style={{fontWeight: 600}}>{p.id}</div>
                                      <div style={{fontSize: '12px', color: 'var(--color-text-secondary)'}}>( {p.name} )</div>
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <div onClick={(e) => e.stopPropagation()}>
                                      <Switch 
                                        checked={p.enabled !== false} 
                                        onChange={(val) => handleToggleEnabled(p, val)} 
                                        size="sm"
                                      />
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  <div style={{display: 'flex', gap: '4px'}}>
                                      {(Array.isArray(p.type) ? p.type : [p.type]).map(t => (
                                          <Badge 
                                            key={t} 
                                            status="connected" 
                                            style={{ ...getApiBadgeStyle(t), fontSize: '10px', padding: '2px 8px' }}
                                            className="[&_.connection-dot]:hidden"
                                          >
                                              {t}
                                          </Badge>
                                      ))}
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                                  {p.models 
                                    ? (Array.isArray(p.models) 
                                        ? p.models.length 
                                        : typeof p.models === 'object' 
                                          ? Object.keys(p.models).length 
                                          : 0)
                                    : 0}
                              </td>
                              <td className="px-4 py-3 text-left border-b border-border-glass text-text" style={{paddingRight: '24px', textAlign: 'right'}}>
                                  <div style={{display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDeleteModal(p); }} style={{color: 'var(--color-danger)'}}><Trash2 size={14}/></Button>
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
                <Button 
                  onClick={handleSave} 
                  isLoading={isSaving}
                  disabled={!!quotaValidationError}
                >Save Provider</Button>
            </div>
        }
      >
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '-8px'}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end'}}>
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
                  <Input
                    label="API Key"
                    type="password"
                    value={editingProvider.apiKey}
                    onChange={(e) => setEditingProvider({...editingProvider, apiKey: e.target.value})}
                    placeholder="sk-..."
                    disabled={isOAuthMode}
                  />
                  <div className="flex flex-col gap-2">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Enabled</label>
                      <div style={{height: '38px', display: 'flex', alignItems: 'center'}}>
                          <Switch
                            checked={editingProvider.enabled !== false}
                            onChange={(checked) => setEditingProvider({...editingProvider, enabled: checked})}
                          />
                      </div>
                  </div>
              </div>

              {/* Separator */}
              <div style={{height: '1px', background: 'var(--color-border-glass)', margin: '4px 0'}} />

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
                  {/* Left: APIs & Base URLs */}
                  <div className="flex flex-col gap-1 border border-border-glass rounded-md p-3 bg-bg-subtle">
                      <div className="flex flex-col gap-1" style={{ marginBottom: '6px' }}>
                        <label className="font-body text-[13px] font-medium text-text-secondary">Connection Type</label>
                        <select
                          className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                          value={isOAuthMode ? 'oauth' : 'url'}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === 'oauth') {
                              setEditingProvider({
                                ...editingProvider,
                                apiBaseUrl: 'oauth://',
                                apiKey: 'oauth',
                                oauthProvider: editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value,
                                oauthAccount: editingProvider.oauthAccount || '',
                                type: ['oauth']
                              });
                            } else {
                              setEditingProvider({
                                ...editingProvider,
                                apiBaseUrl: {},
                                apiKey: '',
                                oauthProvider: '',
                                oauthAccount: '',
                                type: []
                              });
                            }
                          }}
                        >
                          <option value="url">Custom API URL</option>
                          <option value="oauth">OAuth (pi-ai)</option>
                        </select>
                      </div>
                      <label className="font-body text-[13px] font-medium text-text-secondary">Supported APIs & Base URLs</label>
                      <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '4px', fontStyle: 'italic'}}>
                          API types are automatically inferred from the URLs you provide.
                      </div>
                      {isOAuthMode ? (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--color-bg-subtle)', padding: '8px', borderRadius: 'var(--radius-md)'}}>
                          <div className="flex flex-col gap-1">
                            <label className="font-body text-[13px] font-medium text-text-secondary">OAuth Provider</label>
                            <select
                              className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                              value={editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value}
                              onChange={(e) => setEditingProvider({
                                ...editingProvider,
                                oauthProvider: e.target.value
                              })}
                            >
                              {OAUTH_PROVIDERS.map((provider) => (
                                <option key={provider.value} value={provider.value}>
                                  {provider.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Input
                            label="OAuth Account"
                            value={editingProvider.oauthAccount || ''}
                            onChange={(e) => setEditingProvider({
                              ...editingProvider,
                              oauthAccount: e.target.value
                            })}
                            placeholder="e.g. work, personal, team-a"
                          />

                          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle" style={{marginTop: '4px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '8px'}}>
                              <div>
                                <div className="font-body text-[13px] font-medium text-text">OAuth Authentication</div>
                                <div className="text-[11px] text-text-secondary">Tokens are saved to auth.json after login.</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '999px',
                                    background: oauthStatus === 'success' || (!oauthStatus && oauthCredentialReady)
                                      ? 'var(--color-success)'
                                      : oauthStatus === 'error' || oauthStatus === 'cancelled'
                                        ? 'var(--color-danger)'
                                        : 'var(--color-text-secondary)',
                                    opacity: oauthCredentialChecking ? 0.6 : 1
                                  }}
                                />
                                <span className="text-[11px] font-medium text-text-secondary" style={{textTransform: 'lowercase'}}>
                                  {oauthStatusLabel}
                                </span>
                              </div>
                            </div>

                            {oauthError && (
                              <div className="text-[11px] text-danger" style={{marginBottom: '8px'}}>
                                {oauthError}
                              </div>
                            )}

                            {oauthSession?.authInfo && (
                              <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px'}}>
                                <Input
                                  label="Authorization URL"
                                  value={oauthSession.authInfo.url}
                                  readOnly
                                />
                                {oauthSession.authInfo.instructions && (
                                  <div className="text-[11px] text-text-secondary flex items-center gap-1">
                                    <Info size={12} />
                                    <span>{oauthSession.authInfo.instructions}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {oauthSession?.prompt && (
                              <div style={{display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px'}}>
                                <div style={{flex: 1}}>
                                  <Input
                                    label={oauthSession.prompt.message}
                                    placeholder={oauthSession.prompt.placeholder}
                                    value={oauthPromptValue}
                                    onChange={(e) => setOauthPromptValue(e.target.value)}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  onClick={handleSubmitPrompt}
                                  disabled={oauthBusy || (!oauthSession.prompt.allowEmpty && !oauthPromptValue)}
                                >
                                  Submit
                                </Button>
                              </div>
                            )}

                            {oauthSession?.status === 'awaiting_manual_code' && (
                              <div style={{display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px'}}>
                                <div style={{flex: 1}}>
                                  <Input
                                    label="Paste redirect URL or code"
                                    value={oauthManualCode}
                                    onChange={(e) => setOauthManualCode(e.target.value)}
                                    placeholder="https://..."
                                  />
                                </div>
                                <Button size="sm" onClick={handleSubmitManualCode} disabled={oauthBusy || !oauthManualCode}>
                                  Submit
                                </Button>
                              </div>
                            )}

                            {oauthSession?.progress && oauthSession.progress.length > 0 && (
                              <div style={{marginBottom: '8px'}}>
                                <div className="text-[11px] text-text-secondary">Progress</div>
                                <div className="text-[11px] text-text" style={{marginTop: '4px'}}>
                                  {(oauthSession?.progress ?? []).slice(-3).map((message, idx) => (
                                    <div key={`${message}-${idx}`}>{message}</div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {oauthStatus === 'success' && (
                              <div className="text-[11px] text-success" style={{marginBottom: '8px'}}>
                                Authentication complete. Tokens saved to auth.json.
                              </div>
                            )}

                            <div style={{display: 'flex', gap: '8px'}}>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleStartOAuth}
                                isLoading={oauthBusy && !oauthSessionId}
                                disabled={oauthBusy || (!!oauthSessionId && !oauthIsTerminal)}
                              >
                                {oauthSessionId && !oauthIsTerminal
                                  ? 'OAuth in progress'
                                  : oauthCredentialReady
                                    ? 'Restart OAuth'
                                    : 'Start OAuth'}
                              </Button>
                              {oauthSessionId && !oauthIsTerminal && (
                                <Button size="sm" variant="ghost" onClick={handleCancelOAuth} disabled={oauthBusy}>
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="border border-border-glass rounded-md overflow-hidden">
                          <div
                            className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                            onClick={() => setIsApiBaseUrlsOpen(!isApiBaseUrlsOpen)}
                          >
                            {isApiBaseUrlsOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>} 
                            <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0, flex: 1}}>Base URL Entries</label>
                            <Badge status="neutral" style={{fontSize: '10px', padding: '2px 8px'}}>{Object.keys(getApiBaseUrlMap()).length}</Badge>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                addApiBaseUrlEntry();
                              }}
                              disabled={Object.keys(getApiBaseUrlMap()).length >= KNOWN_APIS.length}
                            >
                              <Plus size={14}/>
                            </Button>
                          </div>
                          {isApiBaseUrlsOpen && (
                            <div style={{display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-subtle)'}}>
                              {Object.entries(getApiBaseUrlMap()).length === 0 && (
                                <div className="font-body text-[11px] text-text-secondary italic">No base URLs configured yet.</div>
                              )}
                              {Object.entries(getApiBaseUrlMap()).map(([apiType, url]) => (
                                <div key={apiType} style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'start'}}>
                                  <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                                    <select
                                      className="w-full py-1.5 px-3 font-body text-xs border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                      style={{ ...getApiBadgeStyle(apiType), fontWeight: 600 }}
                                      value={apiType}
                                      onChange={(e) => updateApiBaseUrlEntry(apiType, e.target.value, typeof url === 'string' ? url : '')}
                                    >
                                      {KNOWN_APIS.map((knownType) => (
                                        <option key={knownType} value={knownType}>{knownType}</option>
                                      ))}
                                    </select>
                                    <input
                                      className="w-full py-1.5 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                      placeholder="https://api.example.com/..."
                                      value={typeof url === 'string' ? url : ''}
                                      onChange={(e) => updateApiBaseUrlEntry(apiType, apiType, e.target.value)}
                                    />
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => removeApiBaseUrlEntry(apiType)} style={{padding: '4px', marginTop: '4px'}}>
                                    <Trash2 size={14} style={{color: 'var(--color-danger)'}}/>
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                  </div>

                  {/* Right: Advanced Configuration */}
                  <div className="flex flex-col gap-1 border border-border-glass rounded-md p-3 bg-bg-subtle">
                      <label className="font-body text-[13px] font-medium text-text-secondary">Advanced Configuration</label>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                          <div style={{display: 'grid', gridTemplateColumns: '140px', gap: '12px', alignItems: 'end'}}>
                            <div className="flex flex-col gap-1">
                              <label className="font-body text-[11px] font-medium text-text-secondary">Discount (%)</label>
                              <div style={{position: 'relative'}}>
                                <input
                                  className="w-full py-2 pl-3 pr-7 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                  type="number"
                                  step="1"
                                  min="0"
                                  max="100"
                                  value={Math.round((editingProvider.discount ?? 0) * 100)}
                                  onChange={(e) => {
                                    const percent = Number(e.target.value || '0');
                                    const clamped = Math.min(100, Math.max(0, percent));
                                    setEditingProvider({...editingProvider, discount: clamped / 100});
                                  }}
                                />
                                <span
                                  className="font-body text-[12px] text-text-secondary"
                                  style={{position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none'}}
                                >
                                  %
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="border border-border-glass rounded-md overflow-hidden">
                              <div
                                className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                                onClick={() => setIsHeadersOpen(!isHeadersOpen)}
                              >
                                  {isHeadersOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                  <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0, flex: 1}}>Custom Headers</label>
                                  <Badge status="neutral" style={{fontSize: '10px', padding: '2px 8px'}}>{Object.keys(editingProvider.headers || {}).length}</Badge>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => { e.stopPropagation(); addKV('headers'); setIsHeadersOpen(true); }}
                                  >
                                    <Plus size={14}/>
                                  </Button>
                              </div>
                              {isHeadersOpen && (
                                <div style={{display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-deep)'}}>
                                    {Object.entries(editingProvider.headers || {}).length === 0 && (
                                      <div className="font-body text-[11px] text-text-secondary italic">No custom headers configured.</div>
                                    )}
                                    {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                                        <div key={idx} style={{display: 'flex', gap: '6px'}}>
                                            <Input placeholder="Header Name" value={key} onChange={(e) => updateKV('headers', key, e.target.value, val)} style={{flex: 1}}/>
                                            <Input placeholder="Value" value={typeof val === 'object' ? JSON.stringify(val) : val} onChange={(e) => {
                                                    const rawValue = e.target.value;
                                                    let parsedValue;
                                                    try {
                                                        parsedValue = JSON.parse(rawValue);
                                                    } catch {
                                                        parsedValue = rawValue;
                                                    }
                                                    updateKV('headers', key, key, parsedValue);
                                                }} style={{flex: 1}}/>
                                            <Button variant="ghost" size="sm" onClick={() => removeKV('headers', key)} style={{padding: '4px'}}><Trash2 size={14} style={{color: 'var(--color-danger)'}}/></Button>
                                        </div>
                                    ))}
                                </div>
                              )}
                          </div>

                          <div className="border border-border-glass rounded-md overflow-hidden">
                              <div
                                className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                                onClick={() => setIsExtraBodyOpen(!isExtraBodyOpen)}
                              >
                                  {isExtraBodyOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                  <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0, flex: 1}}>Extra Body Fields</label>
                                  <Badge status="neutral" style={{fontSize: '10px', padding: '2px 8px'}}>{Object.keys(editingProvider.extraBody || {}).length}</Badge>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={(e) => { e.stopPropagation(); addKV('extraBody'); setIsExtraBodyOpen(true); }}
                                  >
                                    <Plus size={14}/>
                                  </Button>
                              </div>
                              {isExtraBodyOpen && (
                                <div style={{display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-deep)'}}>
                                    {Object.entries(editingProvider.extraBody || {}).length === 0 && (
                                      <div className="font-body text-[11px] text-text-secondary italic">No extra body fields configured.</div>
                                    )}
                                    {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                                        <div key={idx} style={{display: 'flex', gap: '6px'}}>
                                            <Input placeholder="Field Name" value={key} onChange={(e) => updateKV('extraBody', key, e.target.value, val)} style={{flex: 1}}/>
                                            <Input placeholder="Value" value={typeof val === 'object' ? JSON.stringify(val) : val} onChange={(e) => {
                                                    const rawValue = e.target.value;
                                                    let parsedValue;
                                                    try {
                                                        parsedValue = JSON.parse(rawValue);
                                                    } catch {
                                                        parsedValue = rawValue;
                                                    }
                                                    updateKV('extraBody', key, key, parsedValue);
                                                }} style={{flex: 1}}/>
                                            <Button variant="ghost" size="sm" onClick={() => removeKV('extraBody', key)} style={{padding: '4px'}}><Trash2 size={14} style={{color: 'var(--color-danger)'}}/></Button>
                                        </div>
                                    ))}
                                </div>
                              )}
                          </div>

                          <div>
                            <label className="font-body text-[13px] font-medium text-text-secondary">Quota Checker</label>
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 120px', gap: '8px', alignItems: 'end', marginTop: '4px'}}>
                              <div className="flex flex-col gap-1">
                                <label className="font-body text-[11px] font-medium text-text-secondary">Type</label>
                                <select
                                  className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                  value={selectedQuotaCheckerType}
                                  disabled={!!forcedOAuthQuotaCheckerType}
                                  onChange={(e) => {
                                    const quotaType = e.target.value;
                                    if (!quotaType) {
                                      setEditingProvider({ ...editingProvider, quotaChecker: undefined });
                                      return;
                                    }
                                    setEditingProvider({
                                      ...editingProvider,
                                      quotaChecker: {
                                        type: quotaType,
                                        enabled: true,
                                        intervalMinutes: Math.max(1, editingProvider.quotaChecker?.intervalMinutes || 30)
                                      }
                                    });
                                  }}
                                >
                                  {!forcedOAuthQuotaCheckerType && <option value="">&lt;none&gt;</option>}
                                  {selectableQuotaCheckerTypes.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="font-body text-[11px] font-medium text-text-secondary">Interval (min)</label>
                                <input
                                  className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={editingProvider.quotaChecker?.intervalMinutes || 30}
                                  disabled={!selectedQuotaCheckerType}
                                  onChange={(e) => {
                                    const intervalMinutes = Math.max(1, parseInt(e.target.value, 10) || 30);
                                    setEditingProvider({
                                      ...editingProvider,
                                      quotaChecker: {
                                        type: selectedQuotaCheckerType,
                                        enabled: selectedQuotaCheckerType
                                          ? VALID_QUOTA_CHECKER_TYPES.has(selectedQuotaCheckerType)
                                            ? editingProvider.quotaChecker?.enabled !== false
                                            : false
                                          : false,
                                        intervalMinutes
                                      }
                                    });
                                  }}
                                />
                              </div>
                            </div>
                            <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic'}}>
                              {forcedOAuthQuotaCheckerType
                                ? `Quota checker type is fixed to '${forcedOAuthQuotaCheckerType}' for this OAuth provider.`
                                : <>Select <span style={{fontWeight: 600}}>&lt;none&gt;</span> to disable provider quota checks.</>}
                            </div>

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'naga' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <NagaQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'synthetic' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <SyntheticQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'nanogpt' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <NanoGPTQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'zai' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <ZAIQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'moonshot' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <MoonshotQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {selectedQuotaCheckerType && selectedQuotaCheckerType === 'minimax' && (
                              <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
                                <MiniMaxQuotaConfig
                                  options={editingProvider.quotaChecker?.options || {}}
                                  onChange={(options) => setEditingProvider({
                                    ...editingProvider,
                                    quotaChecker: {
                                      ...editingProvider.quotaChecker,
                                      options
                                    } as Provider['quotaChecker']
                                  })}
                                />
                              </div>
                            )}

                            {quotaValidationError && (
                              <div className="mt-2 text-xs text-danger bg-danger/10 border border-danger/20 rounded px-3 py-2">
                                {quotaValidationError}
                              </div>
                            )}
                          </div>

                          <div className="border border-border-glass rounded-md p-3 bg-bg-subtle">
                            <div className="flex items-center gap-2" style={{minHeight: '38px'}}>
                              <Switch
                                checked={editingProvider.estimateTokens || false}
                                onChange={(checked) => setEditingProvider({...editingProvider, estimateTokens: checked})}
                              />
                              <label className="font-body text-[13px] font-medium text-text" style={{marginBottom: 0}}>Estimate Tokens</label>
                            </div>
                            <div className="font-body text-[11px] text-text-secondary" style={{lineHeight: 1.35, marginTop: '4px'}}>
                              Enable token estimation only when a provider does not return usage data.
                              <span className="text-warning" style={{marginLeft: '6px'}}>Use sparingly—this is rarely needed.</span>
                            </div>
                          </div>
                      </div>
                  </div>
              </div>



              {/* Models Accordion */}
              <div className="border border-border-glass rounded-md">
                  <div
                    className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                    onClick={() => setIsModelsOpen(!isModelsOpen)}
                  >
                      {isModelsOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                      <span style={{fontWeight: 600, fontSize: '13px', flex: 1}}>Provider Models</span>
                      <Badge status="connected">{Object.keys(editingProvider.models || {}).length} Models</Badge>
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={(e) => { e.stopPropagation(); handleOpenFetchModels(); }}
                          leftIcon={<Download size={14}/>}
                          style={{marginLeft: '8px'}}
                        >
                          Fetch Models
                        </Button>
                  </div>
                  {isModelsOpen && (
                      <div style={{padding: '8px', borderTop: '1px solid var(--color-border-glass)', background: 'var(--color-bg-deep)'}}>
                          <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                              {Object.entries(editingProvider.models || {}).map(([mId, mCfg]: [string, any]) => (
                                  <div key={mId} style={{border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)'}}>
                                      <div
                                        style={{padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}
                                        onClick={() => setOpenModelIdx(openModelIdx === mId ? null : mId)}
                                      >
                                          {openModelIdx === mId ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                          <span style={{fontWeight: 600, fontSize: '12px', flex: 1}}>{mId}</span>
                                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeModel(mId); }} style={{color: 'var(--color-danger)', padding: '2px'}}><X size={12}/></Button>
                                      </div>
                                      {openModelIdx === mId && (
                                          <div style={{padding: '8px', borderTop: '1px solid var(--color-border-glass)', display: 'flex', flexDirection: 'column', gap: '6px'}}>
                                              <Input
                                                label="Model ID"
                                                value={mId}
                                                onChange={(e) => updateModelId(mId, e.target.value)}
                                              />

                                              <div className="grid gap-4 grid-cols-3">
                                                  <div className="flex flex-col gap-1">
                                                      <label className="font-body text-[13px] font-medium text-text-secondary">Model Type</label>
                                                      <select
                                                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                                        value={mCfg.type || 'chat'}
                                                          onChange={(e) => {
                                                          const newType = e.target.value as 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses';
                                                          // If switching to embeddings, clear non-embeddings APIs from access_via
                                                          if (newType === 'embeddings') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'embeddings');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['embeddings'] });
                                                          } else if (newType === 'transcriptions') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'transcriptions');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['transcriptions'] });
                                                          } else if (newType === 'speech') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'speech');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['speech'] });
                                                          } else if (newType === 'image') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'images');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['images'] });
                                                          } else if (newType === 'responses') {
                                                            const filteredAccessVia = (mCfg.access_via || []).filter((api: string) => api === 'responses');
                                                            updateModelConfig(mId, { type: newType, access_via: filteredAccessVia.length > 0 ? filteredAccessVia : ['responses'] });
                                                          } else {
                                                            updateModelConfig(mId, { type: newType });
                                                          }
                                                        }}
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
                                                      <label className="font-body text-[13px] font-medium text-text-secondary">Pricing Source</label>
                                                      <select
                                                        className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                                                        value={mCfg.pricing?.source || 'simple'}
                                                        onChange={(e) => {
                                                          const newSource = e.target.value;
                                                          let newPricing: any;
                                                          
                                                          // Create a clean pricing object based on the selected source
                                                          if (newSource === 'simple') {
                                                            newPricing = {
                                                              source: 'simple',
                                                              input: mCfg.pricing?.input || 0,
                                                              output: mCfg.pricing?.output || 0,
                                                              cached: mCfg.pricing?.cached || 0
                                                            };
                                                          } else if (newSource === 'openrouter') {
                                                            newPricing = {
                                                              source: 'openrouter',
                                                              slug: mCfg.pricing?.slug || '',
                                                              ...(mCfg.pricing?.discount !== undefined && { discount: mCfg.pricing.discount })
                                                            };
                                                          } else if (newSource === 'defined') {
                                                            newPricing = {
                                                              source: 'defined',
                                                              range: mCfg.pricing?.range || []
                                                            };
                                                          }
                                                          
                                                          updateModelConfig(mId, { pricing: newPricing });
                                                        }}
                                                      >
                                                          <option value="simple">Simple</option>
                                                          <option value="openrouter">OpenRouter</option>
                                                          <option value="defined">Ranges (Complex)</option>
                                                      </select>
                                                  </div>
                                                   {mCfg.type !== 'embeddings' && mCfg.type !== 'transcriptions' && mCfg.type !== 'speech' && mCfg.type !== 'image' && mCfg.type !== 'responses' && (
                                                       <div className="flex flex-col gap-1">
                                                           <label className="font-body text-[13px] font-medium text-text-secondary">Access Via (APIs)</label>
                                                            <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px'}}>
                                                                {KNOWN_APIS.filter(apiType => {
                                                                    if (mCfg.type === 'chat') {
                                                                        return ['messages', 'chat', 'gemini', 'responses'].includes(apiType);
                                                                    }
                                                                    return true;
                                                                }).map(apiType => {
                                                                      const isEmbeddingsModel = mCfg.type === 'embeddings';
                                                                      const isTranscriptionsModel = mCfg.type === 'transcriptions';
                                                                      const isSpeechModel = mCfg.type === 'speech';
                                                                      const isImageModel = mCfg.type === 'image';
                                                                      const isResponsesModel = mCfg.type === 'responses';
                                                                      const isDisabled = (isEmbeddingsModel && apiType !== 'embeddings') || (isTranscriptionsModel && apiType !== 'transcriptions') || (isSpeechModel && apiType !== 'speech') || (isImageModel && apiType !== 'images') || (isResponsesModel && apiType !== 'responses');
                                                                   
                                                                   return (
                                                                       <label key={apiType} style={{display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', opacity: isDisabled ? 0.4 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer'}}>
                                                                           <input 
                                                                             type="checkbox" 
                                                                             checked={(mCfg.access_via || []).includes(apiType)}
                                                                             disabled={isDisabled}
                                                                             onChange={() => {
                                                                                 const current = mCfg.access_via || [];
                                                                                 const next = current.includes(apiType) ? current.filter((a: string) => a !== apiType) : [...current, apiType];
                                                                                 updateModelConfig(mId, { access_via: next });
                                                                             }}
                                                                           />
                                                                           <span className="inline-flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-medium" style={{ ...getApiBadgeStyle(apiType), fontSize: '10px', padding: '2px 6px', opacity: (mCfg.access_via || []).includes(apiType) ? 1 : 0.5 }}>
                                                                             {apiType}
                                                                           </span>
                                                                       </label>
                                                                   );
                                                               })}
                                                            </div>
                                                          {(!mCfg.access_via || mCfg.access_via.length === 0) && (
                                                              <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic'}}>
                                                                  No APIs selected. Defaults to ALL supported APIs.
                                                              </div>
                                                          )}
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'embeddings' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Embeddings models automatically use the 'embeddings' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'transcriptions' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Transcriptions models automatically use the 'transcriptions' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                  {mCfg.type === 'speech' && (
                                                      <div className="flex flex-col gap-1">
                                                          <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                               <Info className="inline w-3 h-3 mb-0.5 mr-1" />Speech models automatically use the 'speech' API only.
                                                          </div>
                                                      </div>
                                                  )}
                                                   {mCfg.type === 'image' && (
                                                       <div className="flex flex-col gap-1">
                                                           <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                                <Info className="inline w-3 h-3 mb-0.5 mr-1" />Image models automatically use the 'images' API only.
                                                           </div>
                                                       </div>
                                                   )}
                                                   {mCfg.type === 'responses' && (
                                                       <div className="flex flex-col gap-1">
                                                           <div style={{fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px', fontStyle: 'italic', padding: '8px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)'}}>
                                                                <Info className="inline w-3 h-3 mb-0.5 mr-1" />Responses models automatically use the 'responses' API only.
                                                           </div>
                                                       </div>
                                                   )}
                                              </div>

                                              {mCfg.pricing?.source === 'simple' && (
                                                  <div className="grid grid-cols-3 gap-4" style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)'}}>
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
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '12px', alignItems: 'end'}}>
                                                      <div style={{flex: '1'}}>
                                                          <OpenRouterSlugInput 
                                                            label="OpenRouter Model Slug" 
                                                            placeholder="e.g. anthropic/claude-3.5-sonnet or just 'claude-sonnet'"
                                                            value={mCfg.pricing.slug || ''}
                                                            onChange={(value) => updateModelConfig(mId, { pricing: { ...mCfg.pricing, slug: value } })}
                                                          />
                                                      </div>
                                                      <div style={{width: '10%', minWidth: '80px'}}>
                                                          <Input 
                                                            label="Discount (0-1)"
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="1"
                                                            placeholder=""
                                                            value={mCfg.pricing.discount ?? ''}
                                                            onChange={(e) => {
                                                              const val = e.target.value;
                                                              if (val === '') {
                                                                const { discount, ...rest } = mCfg.pricing;
                                                                updateModelConfig(mId, { pricing: rest });
                                                              } else {
                                                                updateModelConfig(mId, { pricing: { ...mCfg.pricing, discount: parseFloat(val) } });
                                                              }
                                                            }}
                                                          />
                                                      </div>
                                                  </div>
                                              )}

                                              {mCfg.pricing?.source === 'defined' && (
                                                  <div style={{background: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                                                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                          <label className="font-body text-[13px] font-medium text-text-secondary" style={{marginBottom: 0}}>Pricing Ranges</label>
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
                                                              
                                                              <div className="grid gap-4 grid-cols-2" style={{marginBottom: '8px'}}>
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
                                                              <div className="grid grid-cols-3 gap-4">
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
                                                          <div className="text-text-muted italic text-center text-sm p-4">No ranges defined. Pricing will likely default to 0.</div>
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

      {/* Fetch Models Modal */}
      <Modal
        isOpen={isFetchModelsModalOpen}
        onClose={() => setIsFetchModelsModalOpen(false)}
        title="Fetch Models from Provider"
        size="md"
        footer={
          <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
            <Button variant="ghost" onClick={() => setIsFetchModelsModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleAddSelectedModels} 
              disabled={selectedModelIds.size === 0}
            >
              Add {selectedModelIds.size} Model{selectedModelIds.size !== 1 ? 's' : ''}
            </Button>
          </div>
        }
      >
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          <div style={{display: 'flex', gap: '8px', alignItems: 'end'}}>
            <div style={{flex: 1}}>
              <Input
                label="Models Endpoint URL"
                value={modelsUrl}
                onChange={(e) => setModelsUrl(e.target.value)}
                placeholder={
                  isOAuthMode
                    ? 'OAuth providers use built-in model lists'
                    : 'https://api.example.com/v1/models'
                }
                disabled={isOAuthMode}
              />
            </div>
            <Button 
              onClick={handleFetchModels} 
              isLoading={isFetchingModels}
              leftIcon={<Download size={16}/>}
            >
              Fetch
            </Button>
          </div>

          {fetchError && (
            <div style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)',
              fontSize: '13px'
            }}>
              {fetchError}
            </div>
          )}

          {fetchedModels.length > 0 && (
            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Available Models ({fetchedModels.length})
                </label>
                <div style={{display: 'flex', gap: '8px'}}>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => setSelectedModelIds(new Set(fetchedModels.map(m => m.id)))}
                  >
                    Select All
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => setSelectedModelIds(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid var(--color-border-glass)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-deep)'
              }}>
                {fetchedModels.map((model) => {
                  const contextLengthK = model.context_length 
                    ? `${(model.context_length / 1000).toFixed(0)}K` 
                    : null;
                  
                  return (
                    <div
                      key={model.id}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid var(--color-border-glass)',
                        cursor: 'pointer',
                        background: selectedModelIds.has(model.id) ? 'var(--color-bg-hover)' : 'transparent',
                        transition: 'background 0.2s'
                      }}
                      onClick={() => toggleModelSelection(model.id)}
                      className="hover:bg-bg-hover"
                    >
                      <div style={{display: 'flex', alignItems: 'start', gap: '12px'}}>
                        <input
                          type="checkbox"
                          checked={selectedModelIds.has(model.id)}
                          onChange={() => toggleModelSelection(model.id)}
                          style={{marginTop: '2px', cursor: 'pointer'}}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div style={{flex: 1}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}>
                            <span style={{fontWeight: 600, fontSize: '13px', color: 'var(--color-text)'}}>
                              {model.id}
                            </span>
                            {contextLengthK && (
                              <Badge status="connected" style={{fontSize: '10px', padding: '2px 6px'}}>
                                {contextLengthK}
                              </Badge>
                            )}
                          </div>
                          {model.name && model.name !== model.id && (
                            <div style={{fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '2px'}}>
                              {model.name}
                            </div>
                          )}
                          {model.description && (
                            <div style={{fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: '1.4'}}>
                              {model.description.length > 150 
                                ? `${model.description.substring(0, 150)}...` 
                                : model.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isFetchingModels && fetchedModels.length === 0 && !fetchError && (
            <div style={{
              padding: '32px',
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: '13px',
              fontStyle: 'italic'
            }}>
              {isOAuthMode
                ? 'Click Fetch to load known OAuth models'
                : 'Enter a URL and click Fetch to load available models'}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteModalProvider}
        onClose={() => setDeleteModalProvider(null)}
        title={`Delete Provider: ${deleteModalProvider?.name || deleteModalProvider?.id || ''}`}
        size="lg"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
            Choose how to delete this provider. The action cannot be undone.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ 
              border: '1px solid var(--color-border)', 
              borderRadius: '8px', 
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-danger)' }}>
                Delete Provider (Cascade)
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                Removes this provider AND deletes all model alias targets that reference it.
              </div>
              {affectedAliases.length > 0 ? (
                <div style={{ fontSize: '13px' }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                    This will affect {affectedAliases.length} model alias(es):
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    {affectedAliases.map(a => (
                      <li key={a.aliasId}>{a.aliasId} ({a.targetsCount} target(s))</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                  No model aliases reference this provider.
                </div>
              )}
              <Button 
                onClick={() => handleDelete(true)} 
                isLoading={deleteModalLoading}
                style={{ 
                  backgroundColor: 'var(--color-danger)', 
                  marginTop: 'auto'
                }}
              >
                Delete (Cascade)
              </Button>
            </div>

            <div style={{ 
              border: '1px solid var(--color-border)', 
              borderRadius: '8px', 
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-text)' }}>
                Delete (Retain Targets)
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                Removes only the provider. Model alias targets that reference this provider will remain but may cause errors.
              </div>
              {affectedAliases.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--color-warning)', fontStyle: 'italic' }}>
                  {affectedAliases.length} model alias(es) will have orphaned targets.
                </div>
              )}
              <Button 
                variant="secondary"
                onClick={() => handleDelete(false)} 
                isLoading={deleteModalLoading}
                style={{ marginTop: 'auto' }}
              >
                Delete (Retain)
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeleteModalProvider(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
};
