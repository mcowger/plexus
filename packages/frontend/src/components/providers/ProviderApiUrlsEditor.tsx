import { useRef } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { Provider } from '../../lib/api';
import { switchConnectionMode, type ConnectionDraftMap } from '../../lib/providerConnectionDraft';

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
    <div className="flex flex-col gap-1 border border-border-glass rounded-md p-3 bg-bg-subtle">
      <div className="flex flex-col gap-1" style={{ marginBottom: '6px' }}>
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Connection Type
        </label>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Connection Type"
            className="inline-flex self-start overflow-hidden rounded-md border border-border-glass"
          >
            {(['url', 'oauth'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={isOAuthMode === (mode === 'oauth')}
                className={`px-3 py-1 font-body text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${mode === 'oauth' ? 'border-l border-border-glass' : ''} ${isOAuthMode === (mode === 'oauth') ? 'bg-bg-hover text-text font-medium' : 'bg-transparent text-text-muted hover:bg-bg-hover hover:text-text'}`}
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
      <label className="font-body text-[13px] font-medium text-text-secondary">
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
            <label className="font-body text-[13px] font-medium text-text-secondary">
              OAuth Provider
            </label>
            <select
              className="w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
              value={editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value}
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
          </div>
          <div className="text-[11px] text-text-secondary" style={{ lineHeight: '1.5' }}>
            Uses the provider ID as its OAuth account — one login per provider.
          </div>
        </div>
      ) : (
        <div className="border border-border-glass rounded-md overflow-hidden">
          <div
            className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
            onClick={() => setIsApiBaseUrlsOpen(!isApiBaseUrlsOpen)}
          >
            {isApiBaseUrlsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <label
              className="font-body text-[13px] font-medium text-text-secondary"
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
                <div className="font-body text-[11px] text-text-secondary italic">
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
                        className="w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
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
                        className="w-full h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                        placeholder={
                          apiType === 'ollama'
                            ? 'http://localhost:11434'
                            : 'https://api.example.com/v1/...'
                        }
                        value={typeof url === 'string' ? url : ''}
                        onChange={(e) => updateApiBaseUrlEntry(apiType, apiType, e.target.value)}
                      />
                      {showOllamaV1Warning && (
                        <div className="flex items-start gap-2 py-1.5 px-2 bg-warning/10 border border-warning/30 rounded-sm">
                          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                          <span className="text-[11px] text-warning">
                            <span style={{ fontWeight: 600 }}>native ollama</span> type expects root
                            URL. URLs with <code>/v1</code> are OpenAI-compatible — use{' '}
                            <span style={{ fontWeight: 600 }}>chat</span> type.
                          </span>
                        </div>
                      )}
                      {showChatOllamaWarning && (
                        <div className="flex items-start gap-2 py-1.5 px-2 bg-warning/10 border border-warning/30 rounded-sm">
                          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                          <span className="text-[11px] text-warning">
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
