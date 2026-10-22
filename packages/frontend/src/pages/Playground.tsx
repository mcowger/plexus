import {
  CheckCircle2,
  Clock,
  RefreshCw,
  Route,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import {
  type PlaygroundApi,
  PlaygroundChat,
  type PlaygroundToolCall,
  type ToolMode,
} from '../components/playground/PlaygroundChat';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { api, KeyConfig } from '../lib/api';

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
  upstreamModel?: string;
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
  upstreamModel?: string;
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
              upstreamModel: record.upstreamModel ?? undefined,
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
  const finalRoute = (() => {
    const provider = routingInfo.routing?.finalAttemptProvider || routingInfo.routing?.provider;
    const routeModel = routingInfo.routing?.finalAttemptModel || routingInfo.routing?.model;
    const upstream = routingInfo.routing?.upstreamModel;
    const base = formatRoute(provider, routeModel);
    return upstream && routeModel && upstream !== routeModel ? `${base} → ${upstream}` : base;
  })();

  if (loading) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader
          title="Playground"
          subtitle="Simulate client keys to test quotas, routing, and access policies."
        />
        <PageContainer>
          <Card className="min-h-[16rem]">
            <div className="text-text-secondary flex h-64 items-center justify-center gap-2 text-sm">
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
          <div className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border p-3 text-sm">
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
                  className="text-text-muted font-mono text-[9px] tracking-wider uppercase"
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
                  className="text-text-muted font-mono text-[9px] tracking-wider uppercase"
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
                  className="text-text-muted font-mono text-[9px] tracking-wider uppercase"
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
                <div className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
                  Tool Mode
                </div>
                <label className="text-text-secondary flex h-8 cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={toolMode === 'sample-tools'}
                    onChange={(event) => setToolMode(event.target.checked ? 'sample-tools' : 'off')}
                    className="accent-primary h-3.5 w-3.5"
                  />
                  Sample browser tools
                </label>
              </div>
            </div>

            {selectedKey ? (
              <dl className="border-border text-text-secondary grid content-start gap-1.5 border-t pt-3 text-[11px] sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
                    Policy
                  </dt>
                  <dd
                    className={
                      selectedModel && (!keyAllowsSelectedModel || keyExcludesSelectedModel)
                        ? 'inline-flex items-center gap-1 font-medium text-amber-200'
                        : 'text-success inline-flex items-center gap-1 font-medium'
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
                  <dt className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
                    Comment
                  </dt>
                  <dd className="text-text truncate" title={selectedKey.comment || 'None'}>
                    {selectedKey.comment || 'None'}
                  </dd>
                </div>

                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2">
                  <dt className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
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
                  <dt className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
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
                  <dt className="text-text-muted font-mono text-[9px] tracking-wider uppercase">
                    Access
                  </dt>
                  <dd className="truncate">
                    IPs {formatList(selectedKey.allowedIps, 'Any')} · quotas{' '}
                    {formatList(selectedKey.quotas, 'Defaults')}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="border-border text-text-secondary flex items-center gap-2 border-t pt-3 text-[11px] sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                <ShieldAlert className="text-text-muted h-3.5 w-3.5" />
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
              <div className="text-text-muted flex items-center gap-2 text-xs">
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
              <div className="text-text-secondary flex min-h-[28rem] flex-col items-center justify-center gap-2 p-6 text-center text-sm xl:min-h-[42.5rem]">
                <ShieldAlert className="text-text-muted h-8 w-8" />
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
              <div className="text-text-muted flex items-center gap-2 text-xs">
                {routingInfo.status === 'pending' ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : routingInfo.status === 'complete' ? (
                  <CheckCircle2 className="text-success h-3.5 w-3.5" />
                ) : routingInfo.status === 'error' ? (
                  <XCircle className="text-danger h-3.5 w-3.5" />
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
            <div className="text-text-secondary space-y-3 text-xs">
              <div className="border-border bg-bg-subtle/60 rounded-md border p-3">
                <div className="text-text-muted mb-1 font-mono text-[10px] tracking-wider uppercase">
                  Final route
                </div>
                <div className="text-text text-sm font-medium break-words">{finalRoute}</div>
                <div className="text-text-muted mt-1 font-mono text-[10px] break-all">
                  {routingInfo.routing?.requestId || 'Send a prompt to inspect routing.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="text-text-muted mb-0.5 font-mono text-[9px] tracking-wider uppercase">
                    Alias
                  </div>
                  <div className="text-text truncate" title={selectedModel}>
                    {selectedModel || '-'}
                  </div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="text-text-muted mb-0.5 font-mono text-[9px] tracking-wider uppercase">
                    Canonical
                  </div>
                  <div
                    className="text-text truncate"
                    title={routingInfo.routing?.canonicalModel || undefined}
                  >
                    {routingInfo.routing?.canonicalModel || '-'}
                  </div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="text-text-muted mb-0.5 font-mono text-[9px] tracking-wider uppercase">
                    Attempts
                  </div>
                  <div className="text-text">{routingInfo.routing?.attemptCount ?? '-'}</div>
                </div>
                <div className="rounded-md bg-slate-950/30 p-2">
                  <div className="text-text-muted mb-0.5 flex items-center gap-1 font-mono text-[9px] tracking-wider uppercase">
                    <Clock className="h-3 w-3" />
                    API
                  </div>
                  <div className="text-text">{routingInfo.routing?.apiType || '-'}</div>
                </div>
              </div>

              {toolCalls.length > 0 && (
                <div className="border-border bg-bg-subtle/40 rounded-md border p-3">
                  <div className="text-text-muted mb-2 font-mono text-[10px] tracking-wider uppercase">
                    Browser tool calls
                  </div>
                  <ol className="space-y-2">
                    {toolCalls.map((toolCall, index) => (
                      <li
                        key={`${toolCall.name}:${toolCall.arguments}:${index}`}
                        className="border-border/70 rounded border bg-slate-950/30 p-2"
                      >
                        <div className="text-text mb-1 font-medium">
                          {index + 1}. {toolCall.name}
                        </div>
                        <div className="text-text-muted font-mono text-[10px]">Arguments</div>
                        <pre className="text-text-secondary mt-0.5 max-h-24 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-[10px] break-words whitespace-pre-wrap">
                          {toolCall.arguments}
                        </pre>
                        <div className="text-text-muted mt-2 font-mono text-[10px]">Result</div>
                        <pre className="text-text-secondary mt-0.5 max-h-24 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-[10px] break-words whitespace-pre-wrap">
                          {toolCall.result}
                        </pre>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {attemptedProviders.length > 0 && (
                <div className="border-border bg-bg-subtle/40 rounded-md border p-3">
                  <div className="text-text-muted mb-2 font-mono text-[10px] tracking-wider uppercase">
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

              <div className="border-border bg-bg-subtle/40 rounded-md border p-3">
                <div className="text-text-muted mb-2 font-mono text-[10px] tracking-wider uppercase">
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
                          <span
                            className="text-text min-w-0 truncate font-medium"
                            title={
                              attempt.upstreamModel &&
                              attempt.model &&
                              attempt.upstreamModel !== attempt.model
                                ? 'Route → upstream; quota uses route'
                                : undefined
                            }
                          >
                            {formatRoute(attempt.provider, attempt.model)}
                            {attempt.upstreamModel &&
                            attempt.model &&
                            attempt.upstreamModel !== attempt.model
                              ? ` → ${attempt.upstreamModel}`
                              : null}
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
                        <div className="text-text-muted mt-1 line-clamp-3 text-[11px]">
                          {attempt.reason || 'No decision reason recorded'}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-text-muted text-[11px]">
                    Routing details appear once the next playground request is routed.
                  </div>
                )}
              </div>

              {routingInfo.error && (
                <div className="border-danger/30 bg-danger/10 text-danger rounded-md border p-3">
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
