import { useEffect, useMemo, useState } from 'react';
import { DeepChat } from 'deep-chat-react';
import {
  FlaskConical,
  Key,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { api, KeyConfig } from '../lib/api';
import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

type ModelListResponse = {
  data?: Array<{ id?: string }>;
};

type DeepChatRequestDetails = {
  body: unknown;
  headers?: Record<string, string>;
};

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

const CHAT_COMPLETIONS_ENDPOINT = '/v1/chat/completions';

const deepChatAuxiliaryStyle = `
  :host {
    display: block !important;
    height: 100% !important;
    min-height: 0 !important;
  }

  #chat-view {
    background: transparent !important;
    display: flex !important;
    flex-direction: column !important;
    height: 100% !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  #messages {
    flex: 1 1 auto !important;
    height: auto !important;
    min-height: 0 !important;
    overflow-y: scroll !important;
    overscroll-behavior: contain !important;
    -webkit-overflow-scrolling: touch !important;
    scrollbar-color: #334155 transparent;
  }

  #input {
    flex: 0 0 auto !important;
    background: #0b1324 !important;
    border-top: 1px solid #1e293b !important;
  }

  #text-input-container {
    background: #020617 !important;
    border: 1px solid #334155 !important;
    box-shadow: none !important;
  }

  #text-input {
    color: #f8fafc !important;
    caret-color: #f59e0b !important;
  }

  #text-input:empty:before {
    color: #64748b !important;
  }

  #messages::-webkit-scrollbar {
    width: 8px;
  }

  #messages::-webkit-scrollbar-track {
    background: transparent;
  }

  #messages::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 999px;
  }
`;

const formatList = (items?: string[], emptyLabel = 'All') =>
  items && items.length > 0 ? items.join(', ') : emptyLabel;

const deepChatRoleToOpenAiRole = (role?: string): OpenAiMessage['role'] => {
  if (role === 'ai' || role === 'assistant') return 'assistant';
  if (role === 'system' || role === 'tool') return role;
  return 'user';
};

const stringifyContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const extractMessages = (body: unknown): OpenAiMessage[] => {
  if (!body || typeof body !== 'object' || !('messages' in body)) return [];
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message): OpenAiMessage | null => {
      if (!message || typeof message !== 'object') return null;
      const record = message as { role?: string; text?: unknown; content?: unknown };
      const content = stringifyContent(record.content ?? record.text);
      if (!content.trim()) return null;
      return {
        role: deepChatRoleToOpenAiRole(record.role),
        content,
      };
    })
    .filter((message): message is OpenAiMessage => message !== null);
};

const extractResponseText = (content: unknown): string => {
  const directText = stringifyContent(content);
  if (directText) return directText;

  if (content && typeof content === 'object' && 'message' in content) {
    const message = (content as { message?: { content?: unknown } }).message;
    return stringifyContent(message?.content);
  }

  return '';
};

const responseToMessage = (response: unknown) => {
  if (response && typeof response === 'object' && 'error' in response) {
    const error = (response as { error?: string | { message?: string } }).error;
    return { error: typeof error === 'string' ? error : error?.message || 'Request failed' };
  }

  const choices =
    response && typeof response === 'object' && 'choices' in response
      ? (response as { choices?: unknown[] }).choices
      : undefined;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  if (firstChoice && typeof firstChoice === 'object') {
    const choice = firstChoice as {
      message?: { content?: unknown };
      delta?: { content?: unknown };
      text?: unknown;
    };
    const text =
      extractResponseText(choice.message?.content) ||
      extractResponseText(choice.delta?.content) ||
      extractResponseText(choice.text);
    if (text) return { text };
  }

  if (response && typeof response === 'object' && 'text' in response) {
    const text = extractResponseText((response as { text?: unknown }).text);
    if (text) return { text };
  }

  return { error: 'Plexus returned an unsupported response shape.' };
};

export const Playground = () => {
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [selectedKeyName, setSelectedKeyName] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedKey = useMemo(
    () => keys.find((key) => key.key === selectedKeyName) ?? null,
    [keys, selectedKeyName]
  );

  const keyAllowsSelectedModel =
    !selectedKey?.allowedModels?.length || selectedKey.allowedModels.includes(selectedModel);
  const keyExcludesSelectedModel = selectedKey?.excludedModels?.includes(selectedModel) ?? false;

  const loadData = async () => {
    setError(null);
    try {
      const [loadedKeys, modelResponse] = await Promise.all([
        api.getKeys(),
        fetch('/v1/models').then(async (response) => {
          if (!response.ok) throw new Error('Failed to fetch models');
          return (await response.json()) as ModelListResponse;
        }),
      ]);

      const sortedKeys = [...loadedKeys].sort((a, b) => a.key.localeCompare(b.key));
      const modelIds = Array.from(
        new Set(
          (modelResponse.data ?? [])
            .map((model) => model.id)
            .filter((modelId): modelId is string => Boolean(modelId))
        )
      ).sort();

      setKeys(sortedKeys);
      setModels(modelIds);
      setSelectedKeyName((current) =>
        current && sortedKeys.some((key) => key.key === current)
          ? current
          : sortedKeys[0]?.key || ''
      );
      setSelectedModel((current) =>
        current && modelIds.includes(current) ? current : modelIds[0] || ''
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize playground data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const requestInterceptor = (details: DeepChatRequestDetails) => {
    const body = details.body && typeof details.body === 'object' ? details.body : {};
    return {
      ...details,
      body: {
        ...body,
        model: selectedModel,
        stream: false,
        messages: extractMessages(body),
      },
    };
  };

  if (loading) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader
          title="Playground"
          subtitle="Simulate client keys to test quotas, routing, and access policies."
        />
        <PageContainer>
          <Card className="min-h-[16rem]">
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-text-secondary">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading playground data...
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Playground"
        subtitle="Simulate client keys to test quotas, IP filters, routing, and model access policies."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            Refresh
          </Button>
        }
      />

      <PageContainer className="space-y-4 sm:space-y-6">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Card
          title="Test Configuration"
          extra={
            <div className="flex items-center gap-2 text-primary">
              <FlaskConical className="h-4 w-4" />
              <LockKeyhole className="h-4 w-4" />
            </div>
          }
          dense
        >
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Select
              label="Simulate Key"
              value={selectedKeyName}
              onChange={setSelectedKeyName}
              options={keys.map((key) => ({ value: key.key, label: key.key }))}
              placeholder="Select a key"
              disabled={keys.length === 0}
              className="h-9 truncate text-xs sm:text-sm"
            />

            <Select
              label="Target Model"
              value={selectedModel}
              onChange={setSelectedModel}
              options={models.map((model) => ({ value: model, label: model }))}
              placeholder="Select a model"
              disabled={models.length === 0}
              className="h-9 truncate text-xs sm:text-sm"
            />

            <div className="min-w-0 rounded-md border border-border bg-bg-subtle/60 p-2">
              <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                <Key className="h-3 w-3" />
                Key Status
              </div>
              {selectedKey ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedKey.quotas?.length ? (
                    <Badge status="info">{selectedKey.quotas.length} quota(s)</Badge>
                  ) : (
                    <Badge status="neutral">Default quotas</Badge>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-text-secondary sm:text-xs">
                  No client key configured
                </span>
              )}
            </div>

            <div className="min-w-0 rounded-md border border-border bg-bg-subtle/60 p-2 text-[11px] sm:text-xs">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                Policy Check
              </div>
              {selectedKey &&
              selectedModel &&
              (!keyAllowsSelectedModel || keyExcludesSelectedModel) ? (
                <div className="flex items-start gap-2 text-amber-200">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="line-clamp-2">Expected rejection by model policy.</span>
                </div>
              ) : (
                <span className="line-clamp-2 text-text-secondary">
                  Selection is allowed by key model scope.
                </span>
              )}
            </div>
          </div>

          {selectedKey ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-[11px] text-text-secondary lg:grid-cols-4 xl:text-xs">
              <div className="min-w-0 rounded-md bg-slate-950/30 p-2">
                <dt className="mb-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                  Comment
                </dt>
                <dd className="truncate text-text" title={selectedKey.comment || 'None'}>
                  {selectedKey.comment || 'None'}
                </dd>
              </div>
              <div className="min-w-0 rounded-md bg-slate-950/30 p-2">
                <dt className="mb-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                  Models
                </dt>
                <dd
                  className="truncate"
                  title={formatList(selectedKey.allowedModels, 'All models')}
                >
                  Allow: {formatList(selectedKey.allowedModels, 'All')}
                </dd>
                <dd className="truncate" title={formatList(selectedKey.excludedModels, 'None')}>
                  Exclude: {formatList(selectedKey.excludedModels, 'None')}
                </dd>
              </div>
              <div className="min-w-0 rounded-md bg-slate-950/30 p-2">
                <dt className="mb-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                  Providers
                </dt>
                <dd
                  className="truncate"
                  title={formatList(selectedKey.allowedProviders, 'All providers')}
                >
                  Allow: {formatList(selectedKey.allowedProviders, 'All')}
                </dd>
                <dd className="truncate" title={formatList(selectedKey.excludedProviders, 'None')}>
                  Exclude: {formatList(selectedKey.excludedProviders, 'None')}
                </dd>
              </div>
              <div className="min-w-0 rounded-md bg-slate-950/30 p-2">
                <dt className="mb-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-text-muted sm:text-[10px]">
                  IPs / Quotas
                </dt>
                <dd
                  className="truncate"
                  title={formatList(selectedKey.allowedIps, 'Any source IP')}
                >
                  IPs: {formatList(selectedKey.allowedIps, 'Any')}
                </dd>
                <dd
                  className="truncate"
                  title={formatList(selectedKey.quotas, 'None — uses defaults')}
                >
                  Quotas: {formatList(selectedKey.quotas, 'Defaults')}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-text-secondary">
              <ShieldAlert className="h-4 w-4 text-text-muted" />
              Create a client key before using the playground.
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <Card
            className="min-h-0"
            title="Chat Simulation"
            extra={
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {selectedModel || 'No model selected'}
              </div>
            }
            flush
          >
            {selectedKey && selectedModel ? (
              <div className="h-[calc(100dvh-15rem)] min-h-[20rem] overflow-hidden p-3 sm:h-[calc(100dvh-13rem)] sm:min-h-[32rem] sm:p-4 xl:h-[42.5rem]">
                <DeepChat
                  key={`${selectedKey.key}:${selectedModel}`}
                  connect={{
                    url: CHAT_COMPLETIONS_ENDPOINT,
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${selectedKey.secret}`,
                    },
                    additionalBodyProps: {
                      model: selectedModel,
                      stream: false,
                    },
                  }}
                  requestInterceptor={requestInterceptor}
                  responseInterceptor={responseToMessage}
                  introMessage={{
                    text: `Simulation active using key "${selectedKey.key}" and model "${selectedModel}".`,
                  }}
                  textInput={{
                    placeholder: {
                      text: 'Send a test prompt through Plexus...',
                      style: { color: '#64748b' },
                    },
                    styles: {
                      container: {
                        backgroundColor: '#020617',
                        border: '1px solid #334155',
                        borderRadius: '0.625rem',
                        boxShadow: 'none',
                      },
                      text: {
                        color: '#f8fafc',
                      },
                      focus: {
                        border: '1px solid #f59e0b',
                        boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.18)',
                      },
                    },
                  }}
                  errorMessages={{ displayServiceErrorMessages: true }}
                  auxiliaryStyle={deepChatAuxiliaryStyle}
                  style={{
                    border: '1px solid rgb(30 41 59)',
                    borderRadius: '0.625rem',
                    height: '100%',
                    width: '100%',
                    background: 'rgb(15 23 42)',
                    boxShadow: 'none',
                    color: '#f8fafc',
                    fontFamily: 'var(--font-body)',
                    overflow: 'hidden',
                  }}
                  chatStyle={{
                    backgroundColor: 'transparent',
                    paddingTop: '0.75rem',
                    paddingBottom: '0.75rem',
                  }}
                  inputAreaStyle={{
                    backgroundColor: '#0b1324',
                    borderTop: '1px solid #1e293b',
                  }}
                  messageStyles={{
                    default: {
                      shared: {
                        bubble: {
                          borderRadius: '0.625rem',
                          fontSize: '0.8125rem',
                          lineHeight: '1.35',
                          boxShadow: 'none',
                        },
                      },
                      user: {
                        bubble: {
                          backgroundColor: '#f59e0b',
                          color: '#1a1006',
                        },
                      },
                      ai: {
                        bubble: {
                          backgroundColor: '#1e293b',
                          color: '#f8fafc',
                          border: '1px solid #334155',
                        },
                      },
                    },
                    intro: {
                      bubble: {
                        backgroundColor: '#111a30',
                        color: '#e2e8f0',
                        border: '1px solid #334155',
                      },
                    },
                    error: {
                      bubble: {
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        color: '#fecaca',
                        border: '1px solid rgba(239, 68, 68, 0.28)',
                      },
                    },
                  }}
                  submitButtonStyles={{
                    submit: {
                      container: {
                        default: {
                          backgroundColor: '#f59e0b',
                          borderRadius: '0.5rem',
                        },
                        hover: {
                          backgroundColor: '#fbbf24',
                        },
                      },
                      svg: {
                        styles: {
                          default: {
                            filter: 'brightness(0) saturate(100%)',
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="flex min-h-[28rem] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-text-secondary xl:min-h-[42.5rem]">
                <ShieldAlert className="h-8 w-8 text-text-muted" />
                <span>
                  Create a client key and configure at least one model alias to begin testing.
                </span>
              </div>
            )}
          </Card>
        </div>
      </PageContainer>
    </div>
  );
};
