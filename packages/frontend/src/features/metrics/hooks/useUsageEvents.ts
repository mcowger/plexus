import { useEffect, useRef, useCallback, useState } from 'react';
import { api } from '../../../lib/api';
import type { UsageRecord } from '../../../lib/api';

type EventHandler = (record: UsageRecord) => void;
type ErrorHandler = (event: Event) => void;

export interface UseUsageEventsOptions {
  onLog: EventHandler;
  onError?: ErrorHandler;
  debounceMs?: number;
}

export interface UseUsageEventsReturn {
  isConnected: boolean;
  reconnect: () => void;
}

/**
 * Hook for subscribing to usage events via Server-Sent Events (SSE)
 * Used by: LiveMetrics.tsx
 */
export const useUsageEvents = (options: UseUsageEventsOptions): UseUsageEventsReturn => {
  const { onLog, onError, debounceMs = 900 } = options;

  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced handler to prevent too many updates
  const debouncedOnLog = useCallback((record: UsageRecord) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onLog(record);
    }, debounceMs);
  }, [onLog, debounceMs]);

  const subscribe = useCallback(() => {
    // Clean up any existing subscription
    if (eventSourceRef.current) {
      eventSourceRef.current();
      eventSourceRef.current = null;
    }

    const unsubscribe = api.subscribeToUsageEvents({
      onLog: (record) => {
        setIsConnected(true);
        debouncedOnLog(record);
      },
      onError: (event) => {
        setIsConnected(false);
        onError?.(event);
      },
    });

    eventSourceRef.current = unsubscribe;
  }, [debouncedOnLog, onError]);

  useEffect(() => {
    setIsConnected(true);
    subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current();
        eventSourceRef.current = null;
      }
    };
  }, [subscribe]);

  return {
    isConnected,
    reconnect: subscribe,
  };
};

export default useUsageEvents;
