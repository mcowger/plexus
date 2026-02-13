/**
 * Types for SSE-driven metrics architecture
 */

import type {
  Stat,
  UsageData,
  TodayMetrics,
  Cooldown,
  LiveDashboardSnapshot,
  ProviderPerformanceData,
  UsageRecord
} from '../../../lib/api';

// Re-export types from api.ts for convenience
export type {
  Stat,
  UsageData,
  TodayMetrics,
  DashboardData,
  LiveRequestSnapshot,
  LiveProviderSnapshot,
  LiveDashboardSnapshot,
  PieChartDataPoint,
  ProviderPerformanceData,
  Cooldown,
  UsageRecord,
} from '../../../lib/api';

/**
 * Time range for dashboard data
 */
export type TimeRange = 'hour' | 'day' | 'week' | 'month';

/**
 * Chart type for visualizations
 */
export type ChartType = 'line' | 'bar' | 'area' | 'pie';

/**
 * Group by options for data aggregation
 */
export type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';

/**
 * Metric configuration for charts
 */
export interface MetricConfig {
  key: string;
  label: string;
  color: string;
  format: (value: number) => string;
}

/**
 * Event types for the unified metrics SSE stream
 */
export type MetricsEventType =
  | 'dashboard'
  | 'live_snapshot'
  | 'provider_performance'
  | 'usage_update'
  | 'cooldowns_update'
  | 'ping'
  | 'connected'
  | 'error';

/**
 * Base event structure
 */
export interface MetricsEventBase {
  type: MetricsEventType;
  timestamp: number;
}

/**
 * Dashboard data event - replaces polling for dashboard stats
 */
export interface DashboardEvent extends MetricsEventBase {
  type: 'dashboard';
  data: {
    stats: Stat[];
    usageData: UsageData[];
    cooldowns: Cooldown[];
    todayMetrics: TodayMetrics;
    timeRange: TimeRange;
  };
}

/**
 * Live snapshot event - replaces polling for live metrics
 */
export interface LiveSnapshotEvent extends MetricsEventBase {
  type: 'live_snapshot';
  data: LiveDashboardSnapshot;
}

/**
 * Provider performance event - replaces polling for performance data
 */
export interface ProviderPerformanceEvent extends MetricsEventBase {
  type: 'provider_performance';
  data: ProviderPerformanceData[];
}

/**
 * Usage update event - incremental usage record
 */
export interface UsageUpdateEvent extends MetricsEventBase {
  type: 'usage_update';
  data: UsageRecord;
}

/**
 * Cooldowns update event
 */
export interface CooldownsUpdateEvent extends MetricsEventBase {
  type: 'cooldowns_update';
  data: Cooldown[];
}

/**
 * Ping event for connection keep-alive
 */
export interface PingEvent extends MetricsEventBase {
  type: 'ping';
}

/**
 * Connected event - sent when client connects
 */
export interface ConnectedEvent extends MetricsEventBase {
  type: 'connected';
  data: {
    message: string;
    timestamp: number;
  };
}

/**
 * Error event
 */
export interface ErrorEvent extends MetricsEventBase {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

/**
 * Union type for all metrics events
 */
export type MetricsEvent =
  | DashboardEvent
  | LiveSnapshotEvent
  | ProviderPerformanceEvent
  | UsageUpdateEvent
  | CooldownsUpdateEvent
  | PingEvent
  | ConnectedEvent
  | ErrorEvent;

/**
 * Connection status for SSE
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

/**
 * Hook return type for useMetricsStream
 */
export interface UseMetricsStreamReturn {
  /** Current dashboard data */
  dashboardData: DashboardEvent['data'] | null;
  /** Current live snapshot */
  liveSnapshot: LiveDashboardSnapshot | null;
  /** Current provider performance data */
  providerPerformance: ProviderPerformanceData[];
  /** Current cooldowns */
  cooldowns: Cooldown[];
  /** Current SSE connection status */
  connectionStatus: ConnectionStatus;
  /** Time since last event received */
  lastEventTime: number | null;
  /** Error message if connection failed */
  error: string | null;
  /** Manually reconnect to the stream */
  reconnect: () => void;
  /** Disconnect from the stream */
  disconnect: () => void;
  /** Whether data is stale (no events received recently) */
  isStale: boolean;
}

/**
 * Options for useMetricsStream hook
 */
export interface UseMetricsStreamOptions {
  /** Whether to auto-connect on mount */
  autoConnect?: boolean;
  /** Reconnection delay in ms */
  reconnectDelay?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Time in ms after which data is considered stale */
  staleThreshold?: number;
  /** Live window minutes for snapshot */
  liveWindowMinutes?: number;
  /** Live request limit for snapshot */
  liveRequestLimit?: number;
}

/**
 * Configuration for aggregated data requests
 */
export interface AggregatedDataConfig {
  timeRange: TimeRange;
  groupBy?: 'time' | 'provider' | 'model';
  metrics?: string[];
}

/**
 * Pre-aggregated chart data from server
 */
export interface ChartDataResponse {
  timeRange: TimeRange;
  granularity: 'minute' | 'hour' | 'day';
  series: Array<{
    name: string;
    data: Array<{ timestamp: string; value: number }>;
  }>;
  total: number;
}

/**
 * Hook return type for dashboard data
 */
export interface UseDashboardDataReturn {
  data: {
    stats: Stat[];
    usageData: UsageData[];
    cooldowns: Cooldown[];
    todayMetrics: TodayMetrics;
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook return type for live snapshot
 */
export interface UseLiveSnapshotReturn {
  snapshot: LiveDashboardSnapshot | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook return type for provider performance
 */
export interface UseProviderPerformanceReturn {
  performance: ProviderPerformanceData[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook return type for logs
 */
export interface UseLogsReturn {
  records: UsageRecord[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Aggregated data point for charts
 */
export interface AggregatedDataPoint {
  name: string;
  requests: number;
  tokens: number;
  cost: number;
  duration: number;
  ttft: number;
  count: number;
  fill?: string;
}

/**
 * Hook return type for time ago updates
 */
export interface UseTimeAgoReturn {
  timeAgo: string;
  lastUpdated: Date;
}
