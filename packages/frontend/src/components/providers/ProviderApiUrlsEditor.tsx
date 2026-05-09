import { ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import type { Provider } from '../../lib/api';

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
}: Props) {
  return (
    <div className="flex flex-col gap-1 border border-border-glass rounded-md p-3 bg-bg-subtle">
      <div className="flex flex-col gap-1" style={{ marginBottom: '6px' }}>
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Connection Type
        </label>
        <select
          className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
          value={isOAuthMode ? 'oauth' : 'url'}
          onChange={(e) => {
            if (e.target.value === 'oauth') {
              setEditingProvider({
                ...editingProvider,
                apiBaseUrl: 'oauth://',
                apiKey: 'oauth',
                oauthProvider: editingProvider.oauthProvider || OAUTH_PROVIDERS[0].value,
                oauthAccount: editingProvider.oauthAccount || '',
                type: ['oauth'],
              });
            } else {
              setEditingProvider({
                ...editingProvider,
                apiBaseUrl: {},
                apiKey: '',
                oauthProvider: '',
                oauthAccount: '',
                type: [],
              });
            }
          }}
        >
          <option value="url">Custom API URL</option>
          <option value="oauth">OAuth (pi-ai)</option>
        </select>
      </div>
      <label className="font-body text-[13px] font-medium text-text-secondary">
        Supported APIs & Base URLs
      </label>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          marginBottom: '4px',
          lineHeight: '1.5',
        }}
      >
        <span style={{ fontStyle: 'italic' }}>API types determine the protocol:</span>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
          <li>
            <span style={{ fontWeight: 600 }}>chat</span> — OpenAI-compatible endpoints, including
            Ollama&apos;s <code className="text-primary">/v1</code> API
          </li>
          <li>
            <span style={{ fontWeight: 600 }}>ollama</span> — Native Ollama API, use the root URL
            (e.g. <code className="text-primary">http://localhost:11434</code>)
          </li>
        </ul>
      </div>
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
              className="w-full py-2 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
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
          <Input
            label="OAuth Account"
            value={editingProvider.oauthAccount || ''}
            onChange={(e) =>
              setEditingProvider({ ...editingProvider, oauthAccount: e.target.value })
            }
            placeholder="e.g. work, personal, team-a"
          />
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
              disabled={Object.keys(getApiBaseUrlMap()).length >= KNOWN_APIS.length}
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
                        className="w-full py-1.5 px-3 font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
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
                      </select>
                      <input
                        className="w-full py-1.5 px-3 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
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
