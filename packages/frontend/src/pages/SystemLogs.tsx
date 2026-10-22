import { clsx } from 'clsx';
import { Pause, Play, RotateCcw, Terminal, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  [key: string]: any;
}

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-danger',
  warn: 'text-secondary',
  info: 'text-info',
  debug: 'text-text-muted',
  verbose: 'text-text-muted',
  silly: 'text-text-muted',
};

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export const SystemLogs: React.FC = () => {
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [currentLevel, setCurrentLevel] = useState('info');
  const [startupLevel, setStartupLevel] = useState('info');
  const [supportedLevels, setSupportedLevels] = useState<string[]>([
    'error',
    'warn',
    'info',
    'debug',
    'verbose',
    'silly',
  ]);
  const [selectedLevel, setSelectedLevel] = useState('info');
  const [isUpdatingLevel, setIsUpdatingLevel] = useState(false);
  const [moduleFilter, setModuleFilterState] = useState<string[]>([]);
  const [moduleInput, setModuleInput] = useState('');
  const isPausedRef = useRef(false);
  const { adminKey } = useAuth();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  useEffect(() => {
    api.getLoggingLevel().then((state) => {
      setCurrentLevel(state.level);
      setStartupLevel(state.startupLevel);
      setSupportedLevels(state.supportedLevels);
      setSelectedLevel(state.level);
    });
    api.getModuleFilter().then((state) => {
      setModuleFilterState(state.modules);
    });
  }, []);

  const disconnect = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const connect = async () => {
    disconnect();
    if (!adminKey) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

    while (!controller.signal.aborted) {
      try {
        const response = await fetch('/v0/system/logs/stream', {
          headers: { 'x-admin-key': adminKey },
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) {
            console.error(`Log stream permanent error ${response.status} — stopping reconnect`);
            return;
          }
          throw new Error(`Failed to connect: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Log stream response has no body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          if (lines.length > 0) reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

          for (const block of lines) {
            const blockLines = block.split('\n');
            let eventData = '';
            let isSyslogEvent = false;

            for (const line of blockLines) {
              if (line.startsWith('event: syslog')) {
                isSyslogEvent = true;
              } else if (line.startsWith('event: ping')) {
                isSyslogEvent = false;
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              } else if (line.startsWith('data:')) {
                eventData = line.slice(5);
              }
            }

            if (isSyslogEvent && eventData) {
              try {
                const data = JSON.parse(eventData);
                if (!isPausedRef.current) {
                  setLogs((prev) => [...prev.slice(-999), data]);
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (err: any) {
        if (controller.signal.aborted || err.name === 'AbortError') return;
        console.error('Log stream error:', err);
      }

      if (controller.signal.aborted) return;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, reconnectDelay);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    }
  };

  useEffect(() => {
    if (!isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const clearLogs = () => setLogs([]);

  const applyLoggingLevel = async () => {
    if (selectedLevel === currentLevel) return;
    setIsUpdatingLevel(true);
    try {
      const state = await api.setLoggingLevel(selectedLevel);
      setCurrentLevel(state.level);
      setStartupLevel(state.startupLevel);
      setSupportedLevels(state.supportedLevels);
      setSelectedLevel(state.level);
      toast.success(`Logging level set to ${state.level}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update logging level');
    } finally {
      setIsUpdatingLevel(false);
    }
  };

  const resetLoggingLevel = async () => {
    setIsUpdatingLevel(true);
    try {
      const state = await api.resetLoggingLevel();
      setCurrentLevel(state.level);
      setStartupLevel(state.startupLevel);
      setSupportedLevels(state.supportedLevels);
      setSelectedLevel(state.level);
      toast.success(`Logging level reset to ${state.level}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset logging level');
    } finally {
      setIsUpdatingLevel(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Terminal size={20} className="text-primary" />
            System Logs
          </span>
        }
        subtitle="Live tail · stderr+stdout"
      />
      <PageContainer>
        <div className="glass-bg flex flex-col gap-3 overflow-hidden rounded-lg">
          <div className="border-border-glass flex flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <h3 className="font-heading text-h3 text-text m-0 font-semibold">Live Output</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="w-full sm:min-w-[120px]">
                <Select
                  value={selectedLevel}
                  onChange={setSelectedLevel}
                  options={supportedLevels.map((l) => ({ value: l, label: l }))}
                  disabled={isUpdatingLevel}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={applyLoggingLevel}
                disabled={isUpdatingLevel || selectedLevel === currentLevel}
                className="w-full sm:w-auto"
              >
                Apply
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={resetLoggingLevel}
                disabled={isUpdatingLevel || currentLevel === startupLevel}
                leftIcon={<RotateCcw size={14} />}
                className="w-full sm:w-auto"
              >
                Reset
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsPaused(!isPaused)}
                leftIcon={isPaused ? <Play size={14} /> : <Pause size={14} />}
                className="w-full sm:w-auto"
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={clearLogs}
                leftIcon={<Trash2 size={14} />}
                className="w-full sm:w-auto"
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="border-border-glass flex flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="text-text-secondary text-xs">
              Current level: <span className="text-text font-semibold">{currentLevel}</span> ·
              Startup default: <span className="text-text font-semibold">{startupLevel}</span> ·
              Runtime changes reset on restart.
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex flex-wrap items-center gap-1.5">
                {moduleFilter.length > 0 ? (
                  moduleFilter.map((m) => (
                    <span
                      key={m}
                      className="bg-primary/15 text-primary border-primary/30 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                    >
                      {m}
                      <button
                        type="button"
                        onClick={async () => {
                          const next = moduleFilter.filter((x) => x !== m);
                          setModuleFilterState(next);
                          try {
                            if (next.length === 0) {
                              await api.clearModuleFilter();
                            } else {
                              await api.setModuleFilter(next);
                            }
                          } catch {
                            setModuleFilterState(moduleFilter);
                          }
                        }}
                        className="text-primary/60 hover:text-primary cursor-pointer border-0 bg-transparent p-0 leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-text-muted text-xs italic">All modules</span>
                )}
              </div>
              <input
                type="text"
                value={moduleInput}
                onChange={(e) => setModuleInput(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && moduleInput.trim()) {
                    e.preventDefault();
                    const mod = moduleInput.trim();
                    if (!moduleFilter.includes(mod)) {
                      const next = [...moduleFilter, mod];
                      setModuleFilterState(next);
                      setModuleInput('');
                      try {
                        await api.setModuleFilter(next);
                      } catch {
                        setModuleFilterState(moduleFilter);
                      }
                    } else {
                      setModuleInput('');
                    }
                  }
                }}
                placeholder="Add module..."
                className="border-border-glass bg-bg text-text focus:border-primary h-8 w-full rounded-md border px-2 text-xs transition-colors outline-none sm:h-7 sm:w-32"
                disabled={false}
              />
              {moduleFilter.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    setModuleFilterState([]);
                    try {
                      await api.clearModuleFilter();
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-text-secondary hover:text-danger cursor-pointer border-0 bg-transparent text-xs transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="bg-terminal-bg text-terminal-fg h-[55vh] max-h-[700px] min-h-[280px] overflow-y-auto p-2 font-mono text-xs sm:h-[60vh] sm:min-h-[320px] sm:p-3">
            {logs.length === 0 && (
              <div className="text-text-muted mt-8 text-center italic">Waiting for logs...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="mb-1 rounded-sm px-1 py-0.5 break-all hover:bg-white/5">
                <span className="text-text-muted mr-2">[{log.timestamp}]</span>
                <span
                  className={clsx(
                    'mr-2 font-bold',
                    LEVEL_CLASS[log.level?.toLowerCase()] ?? 'text-text-muted'
                  )}
                >
                  {log.level?.toUpperCase()}:
                </span>
                <span>{log.message}</span>
                {Object.keys(log).filter((k) => !['level', 'message', 'timestamp'].includes(k))
                  .length > 0 && (
                  <pre className="text-text-muted mt-1 ml-8 text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(log).filter(
                          ([k]) => !['level', 'message', 'timestamp'].includes(k)
                        )
                      ),
                      null,
                      2
                    )}
                  </pre>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </PageContainer>
    </div>
  );
};
