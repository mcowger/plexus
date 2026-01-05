import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Pause, Play, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  [key: string]: any;
}

export const SystemLogs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const { adminKey } = useAuth();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync ref with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [adminKey]);

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
        headers: {
          'x-admin-key': adminKey
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n'); // SSE messages are separated by double newline
        buffer = lines.pop() || '';

        for (const block of lines) {
          const blockLines = block.split('\n');
          let eventData = '';
          let isSyslogEvent = false;

          for (const line of blockLines) {
            if (line.startsWith('event: syslog')) {
              isSyslogEvent = true;
            } else if (line.startsWith('event: ping')) {
                // Ignore ping events
                isSyslogEvent = false;
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            } else if (line.startsWith('data:')) { // Support no space after colon
                eventData = line.slice(5);
            }
          }

          if (isSyslogEvent && eventData) {
            try {
              const data = JSON.parse(eventData);
              if (!isPausedRef.current) {
                setLogs(prev => [...prev.slice(-999), data]); // Keep last 1000 logs
              }
            } catch (e) {
              // Ignore parse errors or keepalives
            }
          }
        }
      }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error('Log stream error:', err);
            // Optional: Auto-reconnect after delay?
        }
    }
  };

  // Auto-scroll
  useEffect(() => {
    if (!isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const clearLogs = () => setLogs([]);

  const getLevelClass = (level: string) => {
    switch (level) {
      case 'error': return 'error';
      case 'warn': return 'warn';
      case 'debug': return 'debug';
      default: return 'info';
    }
  };

  return (
    <div className="dashboard h-[calc(100vh-64px)] flex flex-col overflow-hidden">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={24} />
          System Logs
        </h1>
        <p className="text-[15px] text-text-secondary m-0">Live stream of backend system logs.</p>
      </div>

      <div className="flex flex-col flex-1 min-h-0 mb-3 overflow-hidden glass-bg rounded-lg p-4 transition-all duration-300">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          <h3 className="font-heading text-lg font-semibold text-text m-0">Live Output</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => setIsPaused(!isPaused)}
                leftIcon={isPaused ? <Play size={14} /> : <Pause size={14} />}
            >
                {isPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button 
                variant="secondary" 
                size="sm" 
                onClick={clearLogs}
                leftIcon={<Trash2 size={14} />}
            >
                Clear
            </Button>
          </div>
        </div>
        
        <div className="flex-1 bg-[#0f172a] p-3 overflow-y-auto font-mono text-[13px] text-[#e2e8f0] rounded-sm">
            {logs.length === 0 && (
                <div className="text-text-muted italic text-center mt-5">Waiting for logs...</div>
            )}
            {logs.map((log, i) => (
                <div key={i} className="mb-1 break-all py-0.5 px-1 rounded-sm hover:bg-white/5">
                    <span className="text-text-muted mr-2">[{log.timestamp}]</span>
                    <span className={`font-bold mr-2 ${getLevelClass(log.level)}`}>{log.level.toUpperCase()}:</span>
                    <span>{log.message}</span>
                    {Object.keys(log).filter(k => !['level', 'message', 'timestamp'].includes(k)).length > 0 && (
                        <pre className="text-text-muted text-[11px] ml-8 mt-1">
                            {JSON.stringify(
                                Object.fromEntries(Object.entries(log).filter(([k]) => !['level', 'message', 'timestamp'].includes(k))),
                                null, 2
                            )}
                        </pre>
                    )}
                </div>
            ))}
            <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
