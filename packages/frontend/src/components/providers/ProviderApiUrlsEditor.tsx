import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import type { OAuthProvidersStatus } from '../../hooks/useProviderForm';
import type { Provider } from '../../lib/api';
import { type ConnectionDraftMap, switchConnectionMode } from '../../lib/providerConnectionDraft';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const KNOWN_APIS = [
  'chat',
  'completions',
  'messages',
  'gemini',
  'embeddings',
  'transcriptions',
  'speech',
  'openai-images',
  'openrouter-images',
  'codex-images',
  'systemone',
  'responses',
  'ollama',
];

interface Props {
  isOAuthMode: boolean;
  getApiBaseUrlMap: () => Record<string, string>;
  addApiBaseUrlEntry: () => void;
  updateApiBaseUrlEntry: (oldType: string, newType: string, url: string) => void;
  removeApiBaseUrlEntry: (apiType: string) => void;
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  OAUTH_PROVIDERS: Array<{ value: string; label: string }>;
  /** Load state of the OAuth provider list, so loading/error/empty render differently. */
  oauthProvidersStatus: OAuthProvidersStatus;
  /** Refetch the OAuth provider list after a load failure. */
  onReloadOAuthProviders: () => void;
  isApiBaseUrlsOpen: boolean;
  setIsApiBaseUrlsOpen: (v: boolean) => void;
  /** Compact Apply Preset action shown beside the URL/OAuth toggle (URL mode only). */
  presetAction?: React.ReactNode;
  /** Revealed preset picker panel rendered inside the connection section. */
  presetPanel?: React.ReactNode;
}

export function ProviderApiUrlsEditor({
  isOAuthMode,
  getApiBaseUrlMap,
  addApiBaseUrlEntry,
  updateApiBaseUrlEntry,
  removeApiBaseUrlEntry,
  editingProvider,
  setEditingProvider,
  OAUTH_PROVIDERS,
  oauthProvidersStatus,
  onReloadOAuthProviders,
  isApiBaseUrlsOpen,
  setIsApiBaseUrlsOpen,
  presetAction,
  presetPanel,
}: Props) {
  // Per-mode connection drafts live in this component instance, which the
  // provider Modal unmounts when it closes. Closing and reopening the modal
  // therefore starts a fresh set of drafts — no stale cross-provider state.
  const connectionDrafts = useRef<ConnectionDraftMap>({});

  return (
    <div className="border-border-glass bg-bg-subtle flex flex-col gap-1 rounded-md border p-3">
      <div className="flex flex-col gap-1" style={{ marginBottom: '6px' }}>
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Connection Type
        </label>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Connection Type"
            className="border-border-glass inline-flex self-start overflow-hidden rounded-md border"
          >
            {(['url', 'oauth'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={isOAuthMode === (mode === 'oauth')}
                className={`font-body focus-visible:outline-primary px-3 py-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${mode === 'oauth' ? 'border-border-glass border-l' : ''} ${isOAuthMode === (mode === 'oauth') ? 'bg-bg-hover text-text font-medium' : 'text-text-muted hover:bg-bg-hover hover:text-text bg-transparent'}`}
                onClick={() => {
                  if (isOAuthMode === (mode === 'oauth')) return;
                  const result = switchConnectionMode(
                    editingProvider,
                    mode,
                    connectionDrafts.current,
                    OAUTH_PROVIDERS[0]?.value ?? ''
                  );
                  connectionDrafts.current = result.drafts;
                  setEditingProvider(result.provider);
                }}
              >
                {mode === 'url' ? 'URL' : 'OAuth'}
              </button>
            ))}
          </div>
          {!isOAuthMode && presetAction}
        </div>
      </div>
      {presetPanel}
      <label className="font-body text-text-secondary text-[13px] font-medium">
        Supported APIs & Base URLs
      </label>
      {isOAuthMode ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="font-body text-text-secondary text-[13px] font-medium">
              OAuth Provider
            </label>
            <select
              className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
              value={(editingProvider.oauthProvider || OAUTH_PROVIDERS[0]?.value) ?? ''}
              disabled={OAUTH_PROVIDERS.length === 0}
              onChange={(e) =>
                setEditingProvider({ ...editingProvider, oauthProvider: e.target.value })
              }
            >
              {OAUTH_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {oauthProvidersStatus === 'loading' && (
              <div className="text-text-secondary text-[11px]" style={{ fontStyle: 'italic' }}>
                Loading OAuth providers…
              </div>
            )}
            {oauthProvidersStatus === 'error' && (
              <div className="text-warning text-[11px]">
                Failed to load OAuth providers.{' '}
                <button type="button" className="underline" onClick={onReloadOAuthProviders}>
                  Retry
                </button>
              </div>
            )}
          </div>
          <div className="text-text-secondary text-[11px]" style={{ lineHeight: '1.5' }}>
            Uses the provider ID as its OAuth account — one login per provider.
          </div>
        </div>
      ) : (
        <div className="border-border-glass overflow-hidden rounded-md border">
          <div
            className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3 transition-colors duration-200 select-none"
            onClick={() => setIsApiBaseUrlsOpen(!isApiBaseUrlsOpen)}
          >
            {isApiBaseUrlsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <label
              className="font-body text-text-secondary text-[13px] font-medium"
              style={{ marginBottom: 0, flex: 1 }}
            >
              Base URL Entries
            </label>
            <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
              {Object.keys(getApiBaseUrlMap()).length}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                addApiBaseUrlEntry();
              }}
              disabled={KNOWN_APIS.every((t) =>
                Object.prototype.hasOwnProperty.call(getApiBaseUrlMap(), t)
              )}
            >
              <Plus size={14} />
            </Button>
          </div>
          {isApiBaseUrlsOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '8px',
                borderTop: '1px solid var(--color-border-glass)',
                background: 'var(--color-bg-subtle)',
              }}
            >
              {Object.entries(getApiBaseUrlMap()).length === 0 && (
                <div className="font-body text-text-secondary text-[11px] italic">
                  No base URLs configured yet.
                </div>
              )}
              {Object.entries(getApiBaseUrlMap()).map(([apiType, url]) => {
                const urlLower = typeof url === 'string' ? url.toLowerCase() : '';
                const hasNativeOllamaPath =
                  urlLower.includes('/api/chat') ||
                  urlLower.includes('/api/generate') ||
                  urlLower.includes('/api/embeddings') ||
                  urlLower.includes('/api/tags');
                const hasV1Suffix = urlLower.includes('/v1');
                const showOllamaV1Warning = apiType === 'ollama' && hasV1Suffix;
                const showChatOllamaWarning =
                  apiType === 'chat' && hasNativeOllamaPath && !hasV1Suffix;
                return (
                  <div
                    key={apiType}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-start"
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <select
                        className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
                        value={apiType}
                        onChange={(e) =>
                          updateApiBaseUrlEntry(
                            apiType,
                            e.target.value,
                            typeof url === 'string' ? url : ''
                          )
                        }
                      >
                        {KNOWN_APIS.map((t) => (
                          <option key={t} value={t} className="bg-bg-surface text-text">
                            {t}
                          </option>
                        ))}
                        {/* Stored configs can carry types no longer offered
                            (e.g. pre-collapse Decisions names): show the
                            current value so the select never misrepresents
                            the config. */}
                        {!KNOWN_APIS.includes(apiType) && (
                          <option key={apiType} value={apiType} className="bg-bg-surface text-text">
                            {apiType} (legacy)
                          </option>
                        )}
                      </select>
                      <input
                        className="font-body text-text bg-bg-glass border-border-glass focus:border-primary h-[27px] w-full rounded-sm border px-2 py-0 text-[12px] leading-none outline-none"
                        placeholder={
                          apiType === 'ollama'
                            ? 'http://localhost:11434'
                            : 'https://api.example.com/v1/...'
                        }
                        value={typeof url === 'string' ? url : ''}
                        onChange={(e) => updateApiBaseUrlEntry(apiType, apiType, e.target.value)}
                      />
                      {showOllamaV1Warning && (
                        <div className="bg-warning/10 border-warning/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
                          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                          <span className="text-warning text-[11px]">
                            <span style={{ fontWeight: 600 }}>native ollama</span> type expects root
                            URL. URLs with <code>/v1</code> are OpenAI-compatible — use{' '}
                            <span style={{ fontWeight: 600 }}>chat</span> type.
                          </span>
                        </div>
                      )}
                      {showChatOllamaWarning && (
                        <div className="bg-warning/10 border-warning/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
                          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                          <span className="text-warning text-[11px]">
                            This URL contains <code>/api/</code> paths typical of native Ollama. Use{' '}
                            <span style={{ fontWeight: 600 }}>ollama</span> type if native.
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeApiBaseUrlEntry(apiType)}
                      style={{ padding: '4px', marginTop: '4px' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
