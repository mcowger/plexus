import { useEffect, useRef, useState } from 'react';

interface SSEOptions<T> {
  /** URL to stream from. Set to null to disable. */
  url: string | null;
  /** Fetch headers (e.g. Authorization: 'Bearer ...'). */
  headers?: Record<string, string>;
  /** Called when an `event:` of the given name arrives, payload already JSON.parsed. */
  onEvent?: (event: string, data: T) => void;
  /** Called when the stream disconnects (for any reason). */
  onDisconnect?: () => void;
  /** Reconnect on error (default true). */
  reconnect?: boolean;
  /** Base reconnect delay in ms (default 2000; doubles up to 30s). */
  reconnectDelayMs?: number;
}

export type SSEStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * Subscribes to a POST-based SSE endpoint using fetch + ReadableStream.
 * Handles event parsing, reconnection with backoff, and cleanup.
 */
export function useSSEStream<T = unknown>(options: SSEOptions<T>): { status: SSEStatus } {
  const {
    url,
    headers,
    onEvent,
    onDisconnect,
    reconnect = true,
    reconnectDelayMs = 2000,
  } = options;
  const [status, setStatus] = useState<SSEStatus>('idle');

  // Stable refs so effect doesn't restart when callbacks/headers change identity.
  const onEventRef = useRef(onEvent);
  const onDisconnectRef = useRef(onDisconnect);
  const headersRef = useRef(headers);
  onEventRef.current = onEvent;
  onDisconnectRef.current = onDisconnect;
  headersRef.current = headers;

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const controller = new AbortController();

    const connect = async () => {
      if (cancelled) return;
      setStatus('connecting');
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(headersRef.current ?? {}),
          },
        });
        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }
        setStatus('connected');
        attempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const raw = dataLines.join('\n');
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as T;
                onEventRef.current?.(eventName, parsed);
              } catch {
                // fall through — emit as string if caller wants raw
                onEventRef.current?.(eventName, raw as unknown as T);
              }
            }
          }
        }
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return;
        setStatus('error');
      } finally {
        if (!cancelled) {
          onDisconnectRef.current?.();
          if (reconnect) {
            attempts += 1;
            const delay = Math.min(30000, reconnectDelayMs * 2 ** Math.min(attempts - 1, 4));
            setTimeout(connect, delay);
          }
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, reconnect, reconnectDelayMs]);

  return { status };
}
