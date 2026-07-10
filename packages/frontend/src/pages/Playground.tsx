import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeepChat } from 'deep-chat-react';
import {
  CheckCircle2,
  Clock,
  FlaskConical,
  Key,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
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

type PlaygroundApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'gemini';
type ToolMode = 'off' | 'sample-tools';
type BrowserToolCall = { name: string; arguments: string };

type PlaygroundPreferences = {
  selectedKeyName?: string;
  selectedModel?: string;
  selectedApi?: PlaygroundApi;
  toolMode?: ToolMode;
};

const PLAYGROUND_PREFERENCES_STORAGE_KEY = 'plexus_playground_preferences';

const playgroundApiOptions: Array<{ value: PlaygroundApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Gemini Generate Content' },
];

const playgroundApiLabel = (apiType: PlaygroundApi) =>
  playgroundApiOptions.find((option) => option.value === apiType)?.label ?? apiType;

const toolModeOptions: Array<{ value: ToolMode; label: string }> = [
  { value: 'off', label: 'No tools' },
  { value: 'sample-tools', label: 'Sample browser tools' },
];

const isPlaygroundApi = (value: unknown): value is PlaygroundApi =>
  playgroundApiOptions.some((option) => option.value === value);

const isToolMode = (value: unknown): value is ToolMode =>
  toolModeOptions.some((option) => option.value === value);

const loadPlaygroundPreferences = (): PlaygroundPreferences => {
  if (typeof window === 'undefined') return {};

  try {
    const saved = JSON.parse(
      window.localStorage.getItem(PLAYGROUND_PREFERENCES_STORAGE_KEY) ?? '{}'
    );
    if (!saved || typeof saved !== 'object') return {};

    const preferences = saved as Record<string, unknown>;
    return {
      selectedKeyName:
        typeof preferences.selectedKeyName === 'string' ? preferences.selectedKeyName : undefined,
      selectedModel:
        typeof preferences.selectedModel === 'string' ? preferences.selectedModel : undefined,
      selectedApi: isPlaygroundApi(preferences.selectedApi) ? preferences.selectedApi : undefined,
      toolMode: isToolMode(preferences.toolMode) ? preferences.toolMode : undefined,
    };
  } catch {
    return {};
  }
};

const toolParameters = {
  get_date: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Optional IANA timezone, such as America/Los_Angeles',
      },
    },
  },
  add_tasks: {
    type: 'object',
    properties: {
      titles: {
        type: 'array',
        description: 'One or more tasks to add together',
        items: { type: 'string' },
      },
    },
    required: ['titles'],
  },
  list_tasks: {
    type: 'object',
    properties: {},
  },
};

const toolDescriptions = {
  get_date: 'Get the current date and time in an optional timezone.',
  add_tasks:
    'Add one or more tasks to this browser-only test task list. Use one call with every task in titles.',
  list_tasks: 'List tasks added during this current Playground chat session.',
};

const openAiTools = Object.entries(toolParameters).map(([name, parameters]) => ({
  type: 'function',
  function: {
    name,
    description: toolDescriptions[name as keyof typeof toolDescriptions],
    parameters,
  },
}));

const claudeTools = Object.entries(toolParameters).map(([name, input_schema]) => ({
  name,
  description: toolDescriptions[name as keyof typeof toolDescriptions],
  input_schema,
}));

const geminiTools = [
  {
    functionDeclarations: Object.entries(toolParameters).map(([name, parameters]) => ({
      name,
      description: toolDescriptions[name as keyof typeof toolDescriptions],
      parameters,
    })),
  },
];

type PlaygroundToolCall = {
  name: string;
  arguments: string;
  result: string;
};

type RetryAttempt = {
  index?: number;
  provider?: string;
  model?: string;
  apiType?: string;
  status?: 'success' | 'failed' | 'skipped';
  reason?: string;
  statusCode?: number;
  retryable?: boolean;
};

type RoutingInfo = {
  status: 'idle' | 'pending' | 'complete' | 'error';
  error?: string;
  routing?: PlaygroundRouting;
};

type PlaygroundRouting = {
  requestId?: string;
  provider?: string;
  model?: string;
  apiType?: string;
  canonicalModel?: string;
  attemptCount?: number;
  finalAttemptProvider?: string;
  finalAttemptModel?: string;
  allAttemptedProviders?: string;
  retryHistory?: string;
};

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

  #file-attachment-container {
    box-sizing: border-box !important;
    width: calc(100% - 2px) !important;
    height: 3.6em !important;
    top: -3.6em !important;
    left: 1px !important;
    padding: 4px !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    background: #0b1324 !important;
    border: 1px solid #334155 !important;
    border-bottom: 0 !important;
    border-radius: 0.625rem 0.625rem 0 0 !important;
  }

  .file-attachment {
    margin: 0 0.5em 0 0 !important;
    background: #020617 !important;
    border: 1px solid #334155 !important;
    border-radius: 0.375rem !important;
  }

  .border-bound-attachment {
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
    border-radius: 0.3125rem !important;
  }

  .image-attachment {
    border-radius: 0.3125rem !important;
  }

  .remove-file-attachment-button {
    border-color: #64748b !important;
    background: #0f172a !important;
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

const parseRetryHistory = (value?: string | null): RetryAttempt[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseAttemptedProviders = (value?: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const formatRoute = (provider?: string | null, model?: string | null) =>
  provider && model ? `${provider}/${model}` : provider || model || 'Pending';

type ChatSimulationProps = {
  selectedKey: KeyConfig;
  selectedModel: string;
  selectedApi: PlaygroundApi;
  toolMode: ToolMode;
  onRoutingPending: (clientRequestId: string) => void;
  onToolCalls: (calls: PlaygroundToolCall[]) => void;
};

const ChatSimulation = memo(
  ({
    selectedKey,
    selectedModel,
    selectedApi,
    toolMode,
    onRoutingPending,
    onToolCalls,
  }: ChatSimulationProps) => {
    const tasksRef = useRef<string[]>([]);
    const pendingOpenAiToolCallsRef = useRef(false);
    const runBrowserTools = (calls: BrowserToolCall[]) => {
      const results = calls.map((call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          // The adapter validates tool calls; this is a final defensive fallback.
        }

        switch (call.name) {
          case 'get_date': {
            const timezone = typeof args.timezone === 'string' ? args.timezone : undefined;
            try {
              return {
                response: JSON.stringify({
                  datetime: new Date().toLocaleString('en-US', { timeZone: timezone }),
                  timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
              };
            } catch {
              return { response: JSON.stringify({ error: `Invalid timezone: ${timezone}` }) };
            }
          }
          case 'add_tasks': {
            const titles = Array.isArray(args.titles)
              ? args.titles
                  .filter((title): title is string => typeof title === 'string')
                  .map((title) => title.trim())
                  .filter(Boolean)
              : [];
            if (titles.length === 0) {
              return {
                response: JSON.stringify({ error: 'At least one task title is required.' }),
              };
            }
            tasksRef.current.push(...titles);
            return {
              response: JSON.stringify({ added: titles, taskCount: tasksRef.current.length }),
            };
          }
          case 'list_tasks':
            return { response: JSON.stringify({ tasks: tasksRef.current }) };
          default:
            return { response: JSON.stringify({ error: `Unknown browser tool: ${call.name}` }) };
        }
      });
      window.setTimeout(
        () =>
          onToolCalls(
            calls.map((call, index) => ({
              name: call.name,
              arguments: call.arguments,
              result: results[index]?.response ?? '',
            }))
          ),
        0
      );
      return results;
    };

    const requestInterceptor = (details: { body: unknown; headers?: Record<string, string> }) => {
      const clientRequestId = crypto.randomUUID();
      const messages =
        details.body && typeof details.body === 'object' && 'messages' in details.body
          ? (details.body as { messages?: Array<{ role?: string }> }).messages
          : undefined;
      const isToolContinuation =
        messages !== undefined &&
        messages.length > 0 &&
        messages[messages.length - 1]?.role === 'tool';
      if (!isToolContinuation) window.setTimeout(() => onRoutingPending(clientRequestId), 0);
      return {
        ...details,
        headers: {
          ...details.headers,
          'x-client-request-id': clientRequestId,
          ...(selectedApi === 'gemini' ? { 'x-goog-api-key': selectedKey.secret } : {}),
        },
      };
    };

    const responseInterceptor = (response: unknown) => {
      // Deep Chat 2.4.x starts its browser-side tool continuation only when the
      // terminal OpenAI chunk says `tool_calls`. Plexus-compatible streams may
      // validly finish with `stop` after emitting tool deltas, so normalize that
      // one compatibility detail locally without changing the gateway response.
      if (selectedApi !== 'openai-completions' || toolMode !== 'sample-tools') return response;
      if (!response || typeof response !== 'object' || !('choices' in response)) return response;

      const choice = (response as { choices?: Array<Record<string, unknown>> }).choices?.[0];
      if (!choice) return response;
      const delta = choice.delta as { tool_calls?: unknown[] } | undefined;
      if (delta?.tool_calls?.length) {
        pendingOpenAiToolCallsRef.current = true;
        return response;
      }
      if (pendingOpenAiToolCallsRef.current && choice.finish_reason === 'stop') {
        pendingOpenAiToolCallsRef.current = false;
        return {
          ...(response as Record<string, unknown>),
          choices: [{ ...choice, finish_reason: 'tool_calls' }],
        };
      }
      return response;
    };

    const connection = (() => {
      const baseUrl = window.location.origin;
      const enableTools = toolMode === 'sample-tools';
      switch (selectedApi) {
        case 'openai-responses':
          return {
            connect: { url: `${baseUrl}/v1/responses`, stream: true },
            directConnection: {
              openAI: {
                key: selectedKey.secret,
                chat: {
                  model: selectedModel,
                  ...(enableTools
                    ? {
                        tools: openAiTools,
                        function_handler: runBrowserTools,
                        // Keep browser-only sample tools sequential until parallel
                        // Responses-to-Chat-Completions translation is fixed.
                        parallel_tool_calls: false,
                      }
                    : {}),
                },
              },
            },
          };
        case 'anthropic-messages':
          return {
            connect: { url: `${baseUrl}/v1/messages`, stream: true },
            directConnection: {
              claude: {
                key: selectedKey.secret,
                model: selectedModel,
                ...(enableTools ? { tools: claudeTools, function_handler: runBrowserTools } : {}),
              },
            },
          };
        case 'gemini':
          return {
            connect: {
              url: `${baseUrl}/v1beta/models/${encodeURIComponent(selectedModel)}:streamGenerateContent?alt=sse`,
              stream: true,
            },
            directConnection: {
              gemini: {
                key: selectedKey.secret,
                model: selectedModel,
                ...(enableTools ? { tools: geminiTools, function_handler: runBrowserTools } : {}),
              },
            },
          };
        case 'openai-completions':
        default:
          return {
            connect: { url: `${baseUrl}/v1/chat/completions`, stream: true },
            directConnection: {
              openAI: {
                key: selectedKey.secret,
                // Deep Chat 2.4.x selects its Chat Completions service from
                // `completions`, but reads its model configuration from `chat`.
                completions: true as const,
                chat: {
                  model: selectedModel,
                  ...(enableTools
                    ? {
                        tools: openAiTools,
                        function_handler: runBrowserTools,
                        // Keep browser-only sample tools sequential until parallel
                        // Responses-to-Chat-Completions translation is fixed.
                        parallel_tool_calls: false,
                      }
                    : {}),
                },
              },
            },
          };
      }
    })();

    return (
      <DeepChat
        key={`${selectedKey.key}:${selectedModel}:${selectedApi}:${toolMode}`}
        connect={connection.connect}
        directConnection={connection.directConnection}
        requestInterceptor={requestInterceptor}
        responseInterceptor={responseInterceptor}
        images={true}
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
    );
  }
);

ChatSimulation.displayName = 'ChatSimulation';

export const Playground = () => {
  const [preferences] = useState(loadPlaygroundPreferences);
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [selectedKeyName, setSelectedKeyName] = useState(() => preferences.selectedKeyName ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => preferences.selectedModel ?? '');
  const [selectedApi, setSelectedApi] = useState<PlaygroundApi>(
    () => preferences.selectedApi ?? 'openai-completions'
  );
  const [toolMode, setToolMode] = useState<ToolMode>(() => preferences.toolMode ?? 'off');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routingInfo, setRoutingInfo] = useState<RoutingInfo>({ status: 'idle' });
  const [toolCalls, setToolCalls] = useState<PlaygroundToolCall[]>([]);
  const routingRequestRef = useRef(0);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PLAYGROUND_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ selectedKeyName, selectedModel, selectedApi, toolMode })
      );
    } catch {
      // Storage may be unavailable or full; the playground should remain usable.
    }
  }, [selectedKeyName, selectedModel, selectedApi, toolMode]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleRoutingPending = useCallback((clientRequestId: string) => {
    const requestNumber = ++routingRequestRef.current;
    setRoutingInfo({ status: 'pending' });
    setToolCalls([]);

    // Streaming responses do not have a JSON body to carry Playground metadata.
    // The inference route persists its routing decision before it starts SSE,
    // allowing this authenticated management request to retrieve it separately.
    const pollRouting = async (attempt = 0): Promise<void> => {
      try {
        const result = await api.getLogs(1, 0, { clientRequestId });
        const record = result.data[0];
        if (routingRequestRef.current !== requestNumber) return;

        if (record?.provider || record?.selectedModelName) {
          const isComplete = record.responseStatus !== 'pending';
          setRoutingInfo({
            // The initial record contains the selected provider/model, but the
            // API type and retry trail are written when the stream finishes.
            status: isComplete
              ? record.responseStatus === 'error'
                ? 'error'
                : 'complete'
              : 'pending',
            error: record.responseStatus === 'error' ? 'The request failed.' : undefined,
            routing: {
              requestId: record.requestId,
              provider: record.provider ?? undefined,
              model: record.selectedModelName ?? undefined,
              apiType: record.outgoingApiType ?? undefined,
              canonicalModel: record.canonicalModelName ?? undefined,
              attemptCount: record.attemptCount ?? undefined,
              finalAttemptProvider: record.finalAttemptProvider ?? record.provider ?? undefined,
              finalAttemptModel: record.finalAttemptModel ?? record.selectedModelName ?? undefined,
              allAttemptedProviders: record.allAttemptedProviders ?? undefined,
              retryHistory: record.retryHistory ?? undefined,
            },
          });
          if (isComplete) return;
        }
      } catch {
        // The pending record is inserted asynchronously; retry below.
      }

      if (attempt >= 20) {
        if (routingRequestRef.current === requestNumber) {
          setRoutingInfo({
            status: 'error',
            error: 'Routing metadata was not available for this request.',
          });
        }
        return;
      }
      window.setTimeout(() => void pollRouting(attempt + 1), 250);
    };

    void pollRouting();
  }, []);

  const handleToolCalls = useCallback((calls: PlaygroundToolCall[]) => {
    setToolCalls((current) => [...current, ...calls]);
  }, []);

  const retryHistory = parseRetryHistory(routingInfo.routing?.retryHistory);
  const attemptedProviders = parseAttemptedProviders(routingInfo.routing?.allAttemptedProviders);
  const finalRoute = formatRoute(
    routingInfo.routing?.finalAttemptProvider || routingInfo.routing?.provider,
    routingInfo.routing?.finalAttemptModel || routingInfo.routing?.model
  );

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

            <Select
              label="Request API"
              value={selectedApi}
              onChange={(value) => setSelectedApi(value as PlaygroundApi)}
              options={playgroundApiOptions}
              className="h-9 truncate text-xs sm:text-sm"
            />

            <Select
              label="Tool Mode"
              value={toolMode}
              onChange={(value) => setToolMode(value as ToolMode)}
              options={toolModeOptions}
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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card
            className="min-h-0"
            title="Chat Simulation"
            extra={
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {selectedModel
                  ? `${playgroundApiLabel(selectedApi)} · ${toolMode === 'sample-tools' ? 'tools on · ' : ''}${selectedModel}`
                  : 'No model selected'}
              </div>
            }
            flush
          >
            {selectedKey && selectedModel ? (
              <div className="h-[clamp(18rem,calc(100dvh-22rem),42.5rem)] overflow-hidden p-3 sm:p-4">
                <ChatSimulation
                  selectedKey={selectedKey}
                  selectedModel={selectedModel}
                  selectedApi={selectedApi}
                  toolMode={toolMode}
                  onRoutingPending={handleRoutingPending}
                  onToolCalls={handleToolCalls}
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

          <Card
            className="min-h-0"
            title="Routing Decision"
            extra={
              <div className="flex items-center gap-2 text-xs text-text-muted">
                {routingInfo.status === 'pending' ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : routingInfo.status === 'complete' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : routingInfo.status === 'error' ? (
                  <XCircle className="h-3.5 w-3.5 text-danger" />
                ) : (
                  <Route className="h-3.5 w-3.5" />
                )}
                {routingInfo.status === 'idle'
                  ? 'Waiting'
                  : routingInfo.status === 'pending'
                    ? 'Resolving'
                    : routingInfo.status === 'complete'
                      ? 'Routed'
                      : 'Failed'}
              </div>
            }
            dense
          >
            <div className="space-y-3 text-xs text-text-secondary">
              <div className="rounded-md border border-border bg-bg-subtle/60 p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  Final route
                </div>
                <div className="break-words text-sm font-medium text-text">{finalRoute}</div>
                <div className="mt-1 break-all font-mono text-[10px] text-text-muted">
                  {routingInfo.routing?.requestId || 'Send a prompt to inspect routing.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Alias
                  </div>
                  <div className="truncate text-text" title={selectedModel}>
                    {selectedModel || '-'}
                  </div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Canonical
                  </div>
                  <div
                    className="truncate text-text"
                    title={routingInfo.routing?.canonicalModel || undefined}
                  >
                    {routingInfo.routing?.canonicalModel || '-'}
                  </div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Attempts
                  </div>
                  <div className="text-text">{routingInfo.routing?.attemptCount ?? '-'}</div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    <Clock className="h-3 w-3" />
                    API
                  </div>
                  <div className="text-text">{routingInfo.routing?.apiType || '-'}</div>
                </div>
              </div>

              {toolCalls.length > 0 && (
                <div className="rounded-md border border-border bg-bg-subtle/40 p-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Browser tool calls
                  </div>
                  <ol className="space-y-2">
                    {toolCalls.map((toolCall, index) => (
                      <li
                        key={`${toolCall.name}:${toolCall.arguments}:${index}`}
                        className="rounded border border-border/70 bg-slate-950/30 p-2"
                      >
                        <div className="mb-1 font-medium text-text">
                          {index + 1}. {toolCall.name}
                        </div>
                        <div className="font-mono text-[10px] text-text-muted">Arguments</div>
                        <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950/60 p-1.5 font-mono text-[10px] text-text-secondary">
                          {toolCall.arguments}
                        </pre>
                        <div className="mt-2 font-mono text-[10px] text-text-muted">Result</div>
                        <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950/60 p-1.5 font-mono text-[10px] text-text-secondary">
                          {toolCall.result}
                        </pre>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {attemptedProviders.length > 0 && (
                <div className="rounded-md border border-border bg-bg-subtle/40 p-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Candidate path
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {attemptedProviders.map((attempted) => (
                      <Badge key={attempted} status="neutral">
                        {attempted}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-md border border-border bg-bg-subtle/40 p-3">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  Decision trail
                </div>
                {retryHistory.length > 0 ? (
                  <ol className="space-y-2">
                    {retryHistory.map((attempt, index) => (
                      <li
                        key={`${attempt.provider}:${attempt.model}:${index}`}
                        className="rounded-md bg-slate-950/40 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium text-text">
                            {formatRoute(attempt.provider, attempt.model)}
                          </span>
                          <Badge
                            status={
                              attempt.status === 'success'
                                ? 'success'
                                : attempt.status === 'failed'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {attempt.status || 'attempt'}
                          </Badge>
                        </div>
                        <div className="mt-1 line-clamp-3 text-[11px] text-text-muted">
                          {attempt.reason || 'No decision reason recorded'}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-[11px] text-text-muted">
                    Routing details appear once the next playground request is routed.
                  </div>
                )}
              </div>

              {routingInfo.error && (
                <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-danger">
                  {routingInfo.error}
                </div>
              )}
            </div>
          </Card>
        </div>
      </PageContainer>
    </div>
  );
};
