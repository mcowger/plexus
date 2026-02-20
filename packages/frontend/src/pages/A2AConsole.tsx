import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type A2AAgentCard,
  type A2APushConfig,
  type A2AStreamConnectionStatus,
  type A2ATask,
  type A2ATaskEvent,
  type A2ATaskState,
} from '../lib/api';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatTimeAgo } from '../lib/format';
import { Bot, CircleDot, ListChecks, Play, RefreshCcw, Square, Trash2, Waves } from 'lucide-react';

const TERMINAL_STATES = new Set<A2ATaskState>(['completed', 'failed', 'canceled', 'rejected']);

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const stateTone = (state?: A2ATaskState): 'connected' | 'warning' | 'error' => {
  if (state === 'completed') return 'connected';
  if (state === 'failed' || state === 'rejected' || state === 'canceled') return 'error';
  return 'warning';
};

export const A2AConsole: React.FC = () => {
  const [agentCard, setAgentCard] = useState<A2AAgentCard | null>(null);
  const [extendedCard, setExtendedCard] = useState<A2AAgentCard | null>(null);
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [events, setEvents] = useState<A2ATaskEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<A2AStreamConnectionStatus>('closed');
  const [pushConfigs, setPushConfigs] = useState<A2APushConfig[]>([]);
  const [contextId, setContextId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [message, setMessage] = useState('');
  const [pushEndpoint, setPushEndpoint] = useState('');
  const [pushBearerToken, setPushBearerToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isPushLoading, setIsPushLoading] = useState(false);
  const [isPushSaving, setIsPushSaving] = useState(false);
  const [deletingPushConfigId, setDeletingPushConfigId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find((task) => task.id === selectedTaskId) || null;
  }, [selectedTaskId, tasks]);

  const refreshData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [publicCard, extCard, taskList] = await Promise.all([
        api.getA2APublicAgentCard(),
        api.getA2AExtendedAgentCard(),
        api.listA2ATasks({ limit: 100, offset: 0 }),
      ]);
      setAgentCard(publicCard);
      setExtendedCard(extCard);
      setTasks(taskList.tasks || []);
      setTotalTasks(taskList.total || 0);
      const hasCurrent = selectedTaskId ? taskList.tasks.some((task) => task.id === selectedTaskId) : false;
      if (taskList.tasks.length === 0) {
        setSelectedTaskId(null);
      } else if (!selectedTaskId || !hasCurrent) {
        const preferredTask = taskList.tasks.find((task) => !TERMINAL_STATES.has(task.status.state)) || taskList.tasks[0];
        setSelectedTaskId(preferredTask.id);
      }
      setHasLoaded(true);
    } catch (e) {
      setError((e as Error).message || 'Failed to load A2A console data');
      setHasLoaded(true);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPushConfigs = async (taskId: string) => {
    setIsPushLoading(true);
    try {
      const response = await api.listA2APushConfigs(taskId);
      setPushConfigs(response.configs || []);
    } catch (e) {
      setError((e as Error).message || 'Failed to load push configs');
    } finally {
      setIsPushLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
    const timer = setInterval(() => {
      void refreshData();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setEvents([]);
      setPushConfigs([]);
      setStreamStatus('closed');
      return;
    }

    setEvents([]);

    let isMounted = true;
    const existingMaxSequence = 0;

    void loadPushConfigs(selectedTaskId);

    const unsubscribe = api.subscribeA2ATask(
      selectedTaskId,
      {
        onEvent: (event) => {
          if (!isMounted) return;
          setEvents((prev) => {
            if (prev.some((item) => item.sequence === event.sequence && item.eventType === event.eventType)) {
              return prev;
            }
            return [...prev, event].sort((a, b) => a.sequence - b.sequence);
          });

          const maybeState = event.payload?.state;
          if (typeof maybeState === 'string') {
            setTasks((prev) =>
              prev.map((task) =>
                task.id === selectedTaskId
                  ? {
                      ...task,
                      status: {
                        ...task.status,
                        state: maybeState as A2ATaskState,
                        timestamp: event.createdAt || task.status.timestamp,
                      },
                    }
                  : task
              )
            );
          }
        },
        onError: () => {
          if (!isMounted) return;
          void api
            .getA2ATask(selectedTaskId)
            .then((res) => {
              setTasks((prev) => prev.map((task) => (task.id === selectedTaskId ? res.task : task)));
            })
            .catch(() => undefined);
        },
        onStatusChange: (status) => {
          if (!isMounted) return;
          setStreamStatus(status);
        },
      },
      { afterSequence: existingMaxSequence }
    );

    return () => {
      isMounted = false;
      unsubscribe();
      setStreamStatus('closed');
    };
  }, [selectedTaskId]);

  const handleSend = async () => {
    const text = message.trim();
    if (!text) {
      setError('Message text is required');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      const response = await api.sendA2AMessage({
        contextId: contextId.trim() || undefined,
        configuration: idempotencyKey.trim() ? { idempotencyKey: idempotencyKey.trim() } : undefined,
        message: {
          role: 'user',
          parts: [{ type: 'text', text }],
        },
      });
      const created = response.task;
      setSelectedTaskId(created.id);
      setTasks((prev) => {
        const withoutExisting = prev.filter((task) => task.id !== created.id);
        return [created, ...withoutExisting];
      });
      setMessage('');
      await refreshData();
    } catch (e) {
      setError((e as Error).message || 'Failed to submit A2A message');
    } finally {
      setIsSending(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedTask || TERMINAL_STATES.has(selectedTask.status.state)) {
      return;
    }

    setIsCanceling(true);
    setError(null);
    try {
      const response = await api.cancelA2ATask(selectedTask.id, 'Cancelled from A2A Console');
      setTasks((prev) => prev.map((task) => (task.id === response.task.id ? response.task : task)));
    } catch (e) {
      setError((e as Error).message || 'Failed to cancel task');
    } finally {
      setIsCanceling(false);
    }
  };

  const handleCreatePushConfig = async () => {
    if (!selectedTask) {
      setError('Select a task before adding push config');
      return;
    }

    const endpoint = pushEndpoint.trim();
    if (!endpoint) {
      setError('Push endpoint is required');
      return;
    }
    if (!isValidHttpUrl(endpoint)) {
      setError('Push endpoint must be a valid http(s) URL');
      return;
    }
    if (pushBearerToken.trim().length > 0 && pushBearerToken.trim().length < 8) {
      setError('Bearer token must be at least 8 characters when provided');
      return;
    }

    setIsPushSaving(true);
    setError(null);
    try {
      await api.createA2APushConfig(selectedTask.id, {
        config: {
          endpoint,
          authentication: pushBearerToken.trim()
            ? {
                type: 'bearer',
                token: pushBearerToken.trim(),
              }
            : undefined,
        },
      });
      setPushEndpoint('');
      setPushBearerToken('');
      await loadPushConfigs(selectedTask.id);
    } catch (e) {
      setError((e as Error).message || 'Failed to create push config');
    } finally {
      setIsPushSaving(false);
    }
  };

  const handleDeletePushConfig = async (configId: string) => {
    if (!selectedTask) {
      return;
    }

    setDeletingPushConfigId(configId);
    setError(null);
    try {
      await api.deleteA2APushConfig(selectedTask.id, configId);
      await loadPushConfigs(selectedTask.id);
    } catch (e) {
      setError((e as Error).message || 'Failed to delete push config');
    } finally {
      setDeletingPushConfigId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-deep to-bg-surface p-6 transition-all duration-300">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 mb-2 flex items-center gap-3 font-heading text-3xl font-bold text-text">
            <Bot size={32} className="text-primary" />
            A2A Console
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge status="connected" secondaryText={agentCard?.version ? `Protocol ${agentCard.version}` : 'Protocol loading'}>
              Agent-to-Agent
            </Badge>
            <Badge status="neutral" secondaryText={`${totalTasks} tasks`}>
              Task Lifecycle
            </Badge>
          </div>
        </div>
        <Button leftIcon={<RefreshCcw size={16} />} onClick={() => void refreshData()} isLoading={isLoading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Agent Card" extra={<CircleDot size={16} className="text-primary" />}>
          {agentCard ? (
            <div className="space-y-3 text-sm text-text-secondary">
              <div>
                <div className="text-xs uppercase tracking-wider text-text-muted">Name</div>
                <div className="text-base font-semibold text-text">{agentCard.name}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-text-muted">URL</div>
                <div className="break-all text-text">{agentCard.url}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Badge status={agentCard.capabilities.streaming ? 'connected' : 'warning'} secondaryText="streaming">
                  Stream
                </Badge>
                <Badge status={agentCard.capabilities.pushNotifications ? 'connected' : 'warning'} secondaryText="push notifications">
                  Push
                </Badge>
                <Badge status={agentCard.capabilities.stateTransitionHistory ? 'connected' : 'warning'} secondaryText="state history">
                  History
                </Badge>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-text-muted">Skills</div>
                <div className="mt-1 text-text">{agentCard.skills.map((skill) => skill.name).join(', ') || 'No skills declared'}</div>
              </div>
              {extendedCard?.metadata && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-text-muted">Extended Metadata</div>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-bg-hover p-2 text-xs text-text-secondary">{JSON.stringify(extendedCard.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          ) : hasLoaded ? (
            <div className="text-sm text-text-secondary">Unable to load A2A agent card.</div>
          ) : (
            <div className="text-sm text-text-secondary">Loading agent card...</div>
          )}
        </Card>

        <Card title="Create Task" extra={<Play size={16} className="text-primary" />}>
          <div className="space-y-3">
            <Input
              label="Context ID (optional)"
              value={contextId}
              onChange={(event) => setContextId(event.target.value)}
              placeholder="ctx-..."
            />
            <Input
              label="Idempotency Key (optional)"
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              placeholder="same key returns same task"
            />
            <div className="flex flex-col gap-2">
              <label className="font-body text-[13px] font-medium text-text-secondary">Message</label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                placeholder="Describe the task for the A2A agent"
                className="w-full resize-y rounded-sm border border-border-glass bg-bg-glass px-3.5 py-2.5 font-body text-sm text-text outline-none transition-all duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
              />
            </div>
            <div className="flex justify-end">
              <Button leftIcon={<Play size={16} />} isLoading={isSending} onClick={() => void handleSend()}>
                Send Message
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Tasks" extra={<ListChecks size={16} className="text-primary" />}>
          {tasks.length === 0 ? (
            <div className="text-sm text-text-secondary">No tasks yet. Submit a message to create one.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border-glass text-xs uppercase tracking-wider text-text-muted">
                    <th className="py-2">Task</th>
                    <th className="py-2">State</th>
                    <th className="py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const isActive = selectedTaskId === task.id;
                    return (
                      <tr
                        key={task.id}
                        className={`cursor-pointer border-b border-border-glass/50 ${isActive ? 'bg-bg-hover' : 'hover:bg-bg-hover/60'}`}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <td className="py-2 font-mono text-xs text-text">{task.id}</td>
                        <td className="py-2">
                          <Badge status={stateTone(task.status.state)}>
                            {task.status.state}
                          </Badge>
                        </td>
                        <td className="py-2 text-text-secondary">
                          {(() => {
                            if (!task.status.timestamp) {
                              return '-';
                            }
                            const parsed = Date.parse(task.status.timestamp);
                            if (!Number.isFinite(parsed)) {
                              return '-';
                            }
                            return formatTimeAgo(Math.max(0, Math.floor((Date.now() - parsed) / 1000)));
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={selectedTask ? `Task ${selectedTask.id}` : 'Task Details'}
          extra={
            selectedTask ? (
              <Button
                size="sm"
                variant="danger"
                leftIcon={<Square size={14} />}
                disabled={TERMINAL_STATES.has(selectedTask.status.state)}
                isLoading={isCanceling}
                onClick={() => void handleCancel()}
              >
                Cancel
              </Button>
            ) : null
          }
        >
          {!selectedTask ? (
            <div className="text-sm text-text-secondary">Select a task to view state, stream updates, and controls.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={stateTone(selectedTask.status.state)} secondaryText={selectedTask.status.state}>
                  Current State
                </Badge>
                <Badge status="neutral" secondaryText={selectedTask.contextId}>
                  Context
                </Badge>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm text-text">
                  <Waves size={15} className="text-primary" />
                  Live Event Stream
                  <Badge status={streamStatus === 'connected' ? 'connected' : streamStatus === 'reconnecting' ? 'warning' : 'error'}>
                    {streamStatus}
                  </Badge>
                </div>
                <div className="max-h-[280px] overflow-y-auto rounded-md border border-border-glass bg-bg-hover/40 p-2">
                  {events.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-text-secondary">No streamed events yet for this task.</div>
                  ) : (
                    <div className="space-y-2">
                      {events.map((event) => (
                        <div key={`${event.sequence}-${event.eventType}`} className="rounded border border-border-glass bg-bg-glass px-3 py-2 text-xs">
                          <div className="mb-1 flex items-center justify-between text-text-secondary">
                            <span className="font-semibold text-text">{event.eventType}</span>
                            <span>seq #{event.sequence}</span>
                          </div>
                          <pre className="m-0 overflow-x-auto whitespace-pre-wrap text-text-secondary">{JSON.stringify(event.payload, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm text-text">Push Notification Configs</div>
                <div className="space-y-2 rounded-md border border-border-glass bg-bg-hover/30 p-3">
                  <Input
                    label="Webhook Endpoint"
                    value={pushEndpoint}
                    onChange={(event) => setPushEndpoint(event.target.value)}
                    placeholder="https://example.com/a2a-webhook"
                  />
                  <Input
                    label="Bearer Token (optional)"
                    value={pushBearerToken}
                    onChange={(event) => setPushBearerToken(event.target.value)}
                    placeholder="token used for Authorization header"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" isLoading={isPushSaving} onClick={() => void handleCreatePushConfig()}>
                      Add Push Config
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {isPushLoading ? (
                      <div className="text-xs text-text-secondary">Loading push configs...</div>
                    ) : pushConfigs.length === 0 ? (
                      <div className="text-xs text-text-secondary">No push configs configured for this task.</div>
                    ) : (
                      pushConfigs.map((config) => (
                        <div key={config.configId} className="flex items-center justify-between gap-3 rounded border border-border-glass bg-bg-glass px-3 py-2">
                          <div>
                            <div className="text-xs font-semibold text-text">{config.configId}</div>
                            <div className="text-xs text-text-secondary break-all">{config.endpoint}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Trash2 size={13} />}
                            isLoading={deletingPushConfigId === config.configId}
                            onClick={() => void handleDeletePushConfig(config.configId)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
