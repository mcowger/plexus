import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Pause, Play, Trash2, RotateCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { api } from '../lib/api';
import { clsx } from 'clsx';

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

    try {
      const response = await fetch('/v0/system/logs/stream', {
        headers: { 'x-admin-key': adminKey },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Failed to connect: ${response.statusText}`);

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

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
      if (err.name !== 'AbortError') {
        console.error('Log stream error:', err);
      }
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
    <div className="flex flex-col min-h-full">
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
        <div className="flex flex-col gap-3 glass-bg rounded-lg overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border-glass px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <h3 className="font-heading text-h3 font-semibold text-text m-0">Live Output</h3>
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

          <div className="flex flex-col gap-3 border-b border-border-glass px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="text-xs text-text-secondary">
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
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary border border-primary/30"
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
                        className="bg-transparent border-0 p-0 cursor-pointer text-primary/60 hover:text-primary leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-text-muted italic">All modules</span>
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
                className="h-8 w-full rounded-md border border-border-glass bg-bg px-2 text-xs text-text outline-none transition-colors focus:border-primary sm:h-7 sm:w-32"
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
                  className="text-xs text-text-secondary hover:text-danger transition-colors bg-transparent border-0 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="h-[55vh] min-h-[280px] max-h-[700px] overflow-y-auto bg-terminal-bg p-2 font-mono text-xs text-terminal-fg sm:h-[60vh] sm:min-h-[320px] sm:p-3">
            {logs.length === 0 && (
              <div className="text-text-muted italic text-center mt-8">Waiting for logs...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="mb-1 break-all py-0.5 px-1 rounded-sm hover:bg-white/5">
                <span className="text-text-muted mr-2">[{log.timestamp}]</span>
                <span
                  className={clsx(
                    'font-bold mr-2',
                    LEVEL_CLASS[log.level?.toLowerCase()] ?? 'text-text-muted'
                  )}
                >
                  {log.level?.toUpperCase()}:
                </span>
                <span>{log.message}</span>
                {Object.keys(log).filter((k) => !['level', 'message', 'timestamp'].includes(k))
                  .length > 0 && (
                  <pre className="text-text-muted text-[11px] ml-8 mt-1 whitespace-pre-wrap">
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
