/**
 * useMetricsStream.ts
 *
 * Unified SSE hook for metrics data.
 * Replaces multiple polling intervals with a single SSE connection.
 *
 * @example
 * ```typescript
 * const {
 *   dashboardData,
 *   liveSnapshot,
 *   providerPerformance,
 *   cooldowns,
 *   connectionStatus,
 *   isStale,
 *   reconnect
 * } = useMetricsStream({
 *   autoConnect: true,
 *   reconnectDelay: 3000,
 *   maxReconnectAttempts: 5
 * });
 * ```
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  MetricsEvent,
  MetricsEventType,
  DashboardEvent,
  LiveSnapshotEvent,
  ProviderPerformanceEvent,
  CooldownsUpdateEvent,
  ConnectionStatus,
  UseMetricsStreamReturn,
  UseMetricsStreamOptions,
  LiveDashboardSnapshot,
  ProviderPerformanceData,
  Cooldown
} from '../types/metrics';

const DEFAULT_OPTIONS: Required<UseMetricsStreamOptions> = {
  autoConnect: true,
  reconnectDelay: 3000,
  maxReconnectAttempts: 5,
  staleThreshold: 60000, // 60 seconds
  liveWindowMinutes: 5,
  liveRequestLimit: 1200
};

const API_BASE = '';
const SSE_ENDPOINT = '/api/v1/metrics/stream';

/**
 * Creates the full SSE URL with query parameters
 */
const createSseUrl = (options: UseMetricsStreamOptions): string => {
  const params = new URLSearchParams();
  params.set('windowMinutes', String(options.liveWindowMinutes ?? DEFAULT_OPTIONS.liveWindowMinutes));
  params.set('limit', String(options.liveRequestLimit ?? DEFAULT_OPTIONS.liveRequestLimit));
  return `${API_BASE}${SSE_ENDPOINT}?${params.toString()}`;
};

/**
 * Hook for subscribing to unified metrics SSE stream
 *
 * Features:
 * - Single SSE connection for all metrics data
 * - Automatic reconnection with exponential backoff
 * - Connection status tracking
 * - Stale data detection
 * - Type-safe event handling
 */
export const useMetricsStream = (
  options: UseMetricsStreamOptions = {}
): UseMetricsStreamReturn => {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Data states
  const [dashboardData, setDashboardData] = useState<DashboardEvent['data'] | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveDashboardSnapshot | null>(null);
  const [providerPerformance, setProviderPerformance] = useState<ProviderPerformanceData[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);

  // Connection states
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Refs for managing connection
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const staleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isManualDisconnectRef = useRef(false);

  /**
   * Check if data is stale
   */
  const checkStale = useCallback(() => {
    if (!lastEventTime) {
      setIsStale(true);
      return;
    }
    const timeSinceLastEvent = Date.now() - lastEventTime;
    setIsStale(timeSinceLastEvent > mergedOptions.staleThreshold);
  }, [lastEventTime, mergedOptions.staleThreshold]);

  /**
   * Handle incoming SSE messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const eventData = JSON.parse(event.data) as MetricsEvent;
      setLastEventTime(Date.now());
      setIsStale(false);

      switch (eventData.type) {
        case 'dashboard':
          setDashboardData((eventData as DashboardEvent).data);
          break;

        case 'live_snapshot':
          setLiveSnapshot((eventData as LiveSnapshotEvent).data);
          break;

        case 'provider_performance':
          setProviderPerformance((eventData as ProviderPerformanceEvent).data);
          break;

        case 'cooldowns_update':
          setCooldowns((eventData as CooldownsUpdateEvent).data);
          break;

        case 'usage_update':
          // Usage updates trigger live snapshot refresh
          // The server will send a live_snapshot event shortly after
          break;

        case 'ping':
          // Keep connection alive
          break;

        case 'connected':
          console.log('[SSE] Connected:', (eventData as { data: { message: string } }).data.message);
          break;

        case 'error':
          console.error('[SSE] Server error:', (eventData as { data: { message: string } }).data.message);
          setError((eventData as { data: { message: string } }).data.message);
          break;

        default:
          console.warn('[SSE] Unknown event type:', (eventData as { type: string }).type);
      }
    } catch (err) {
      console.error('[SSE] Failed to parse event data:', err);
    }
  }, []);

  /**
   * Handle SSE connection open
   */
  const handleOpen = useCallback(() => {
    setConnectionStatus('connected');
    setError(null);
    reconnectAttemptsRef.current = 0;
    isManualDisconnectRef.current = false;
  }, []);

  /**
   * Handle SSE connection errors
   */
  const handleError = useCallback((event: Event) => {
    console.error('[SSE] Connection error:', event);
    setConnectionStatus('error');
    setError('Connection error occurred');

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Attempt reconnection if not manually disconnected
    if (!isManualDisconnectRef.current && reconnectAttemptsRef.current < mergedOptions.maxReconnectAttempts) {
      reconnectAttemptsRef.current += 1;
      setConnectionStatus('reconnecting');

      const delay = Math.min(
        mergedOptions.reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1),
        30000 // Max 30 second delay
      );

      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    } else if (reconnectAttemptsRef.current >= mergedOptions.maxReconnectAttempts) {
      setConnectionStatus('disconnected');
      setError('Max reconnection attempts reached');
    }
  }, [mergedOptions.maxReconnectAttempts, mergedOptions.reconnectDelay]);

  /**
   * Establish SSE connection
   */
  const connect = useCallback(() => {
    // Don't connect if already connected
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus('connecting');
    isManualDisconnectRef.current = false;

    try {
      const url = createSseUrl(mergedOptions);
      const source = new EventSource(url);

      source.onopen = handleOpen;
      source.onmessage = handleMessage;
      source.onerror = handleError;

      eventSourceRef.current = source;
    } catch (err) {
      console.error('[SSE] Failed to create connection:', err);
      setConnectionStatus('error');
      setError('Failed to create SSE connection');
    }
  }, [mergedOptions, handleOpen, handleMessage, handleError]);

  /**
   * Disconnect from SSE
   */
  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionStatus('disconnected');
  }, []);

  /**
   * Reconnect to SSE
   */
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setError(null);
    connect();
  }, [disconnect, connect]);

  /**
   * Auto-connect on mount
   */
  useEffect(() => {
    if (mergedOptions.autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [mergedOptions.autoConnect, connect, disconnect]);

  /**
   * Stale data detection
   */
  useEffect(() => {
    staleCheckIntervalRef.current = setInterval(checkStale, 10000); // Check every 10 seconds

    return () => {
      if (staleCheckIntervalRef.current) {
        clearInterval(staleCheckIntervalRef.current);
      }
    };
  }, [checkStale]);

  return {
    dashboardData,
    liveSnapshot,
    providerPerformance,
    cooldowns,
    connectionStatus,
    lastEventTime,
    error,
    reconnect,
    disconnect,
    isStale
  };
};

export default useMetricsStream;
