import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
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
import {
  PlaygroundChat,
  type PlaygroundApi,
  type PlaygroundToolCall,
  type ToolMode,
} from '../components/playground/PlaygroundChat';

type ModelListResponse = {
  data?: Array<{ id?: string }>;
};

type PlaygroundPreferences = {
  selectedKeyName?: string;
  selectedModel?: string;
  selectedApi?: PlaygroundApi;
  toolMode?: ToolMode;
};

const PLAYGROUND_PREFERENCES_STORAGE_KEY = 'plexus_playground_preferences';

const playgroundApiOptions: Array<{ value: PlaygroundApi; label: string }> = [
  { value: 'openai-completions', label: 'chat' },
  { value: 'anthropic-messages', label: 'messages' },
  { value: 'openai-responses', label: 'responses' },
  { value: 'gemini', label: 'gemini' },
];

const playgroundApiLabel = (apiType: PlaygroundApi) =>
  playgroundApiOptions.find((option) => option.value === apiType)?.label ?? apiType;

const isPlaygroundApi = (value: unknown): value is PlaygroundApi =>
  playgroundApiOptions.some((option) => option.value === value);

const isToolMode = (value: unknown): value is ToolMode =>
  value === 'off' || value === 'sample-tools';

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

        <Card title="Test Configuration" dense>
          <div className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
            <div className="space-y-1.5">
              <div className="space-y-1">
                <label
                  htmlFor="playground-key"
                  className="font-mono text-[9px] uppercase tracking-wider text-text-muted"
                >
                  Key
                </label>
                <Select
                  id="playground-key"
                  value={selectedKeyName}
                  onChange={setSelectedKeyName}
                  options={keys.map((key) => ({ value: key.key, label: key.key }))}
                  placeholder="Select a key"
                  disabled={keys.length === 0}
                  className="h-8 truncate py-1 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="playground-model"
                  className="font-mono text-[9px] uppercase tracking-wider text-text-muted"
                >
                  Model
                </label>
                <Select
                  id="playground-model"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={models.map((model) => ({ value: model, label: model }))}
                  placeholder="Select a model"
                  disabled={models.length === 0}
                  className="h-8 truncate py-1 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="playground-api"
                  className="font-mono text-[9px] uppercase tracking-wider text-text-muted"
                >
                  API
                </label>
                <Select
                  id="playground-api"
                  value={selectedApi}
                  onChange={(value) => setSelectedApi(value as PlaygroundApi)}
                  options={playgroundApiOptions}
                  className="h-8 truncate py-1 text-xs"
                />
              </div>

              <div className="space-y-1">
                <div className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  Tool Mode
                </div>
                <label className="flex h-8 cursor-pointer items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={toolMode === 'sample-tools'}
                    onChange={(event) => setToolMode(event.target.checked ? 'sample-tools' : 'off')}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Sample browser tools
                </label>
              </div>
            </div>

            {selectedKey ? (
              <dl className="grid content-start gap-1.5 border-t border-border pt-3 text-[11px] text-text-secondary sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Policy
                  </dt>
                  <dd
                    className={
                      selectedModel && (!keyAllowsSelectedModel || keyExcludesSelectedModel)
                        ? 'inline-flex items-center gap-1 font-medium text-amber-200'
                        : 'inline-flex items-center gap-1 font-medium text-success'
                    }
                  >
                    {selectedModel && (!keyAllowsSelectedModel || keyExcludesSelectedModel) ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {selectedModel && (!keyAllowsSelectedModel || keyExcludesSelectedModel)
                      ? 'Model blocked by key policy'
                      : 'Model allowed'}
                  </dd>
                </div>

                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Comment
                  </dt>
                  <dd className="truncate text-text" title={selectedKey.comment || 'None'}>
                    {selectedKey.comment || 'None'}
                  </dd>
                </div>

                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Models
                  </dt>
                  <dd
                    className="truncate"
                    title={`Allow: ${formatList(selectedKey.allowedModels, 'All models')} · Exclude: ${formatList(selectedKey.excludedModels, 'None')}`}
                  >
                    Allow {formatList(selectedKey.allowedModels, 'All')} · exclude{' '}
                    {formatList(selectedKey.excludedModels, 'None')}
                  </dd>
                </div>

                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Providers
                  </dt>
                  <dd
                    className="truncate"
                    title={`Allow: ${formatList(selectedKey.allowedProviders, 'All providers')} · Exclude: ${formatList(selectedKey.excludedProviders, 'None')}`}
                  >
                    Allow {formatList(selectedKey.allowedProviders, 'All')} · exclude{' '}
                    {formatList(selectedKey.excludedProviders, 'None')}
                  </dd>
                </div>

                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Access
                  </dt>
                  <dd className="truncate">
                    IPs {formatList(selectedKey.allowedIps, 'Any')} · quotas{' '}
                    {formatList(selectedKey.quotas, 'Defaults')}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="flex items-center gap-2 border-t border-border pt-3 text-[11px] text-text-secondary sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <ShieldAlert className="h-3.5 w-3.5 text-text-muted" />
                Create a client key before using the playground.
              </div>
            )}
          </div>
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
                <PlaygroundChat
                  key={`${selectedKey.key}:${selectedModel}:${selectedApi}:${toolMode}`}
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
