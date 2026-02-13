# Metrics Feature

This directory contains the metrics feature with custom hooks, types, and utilities for dashboard data management.

## Structure

```
features/metrics/
├── hooks/
│   ├── index.ts                # Barrel export for all hooks
│   ├── useDashboardData.ts     # Hook for dashboard data with polling
│   ├── useLiveSnapshot.ts      # Hook for live metrics snapshot
│   ├── useProviderPerformance.ts    # Hook for provider performance metrics
│   ├── useUsageEvents.ts       # Hook for SSE usage events
│   ├── useMetricsStream.ts     # Unified SSE hook (replaces polling)
│   ├── useLogs.ts              # Hook for logs with aggregation
│   └── useTimeAgo.ts           # Hook for time ago display
├── types/
│   └── metrics.ts              # Shared types for metrics feature
├── __tests__/
│   └── *.test.ts               # Unit tests for hooks
└── README.md                   # Documentation
```

## Hooks

### useDashboardData

Fetches dashboard data with automatic polling.

```typescript
const { data, loading, error, refetch } = useDashboardData({
  timeRange: 'day',      // 'hour' | 'day' | 'week' | 'month'
  pollInterval: 30000    // milliseconds
});
```

### useLiveSnapshot

Fetches live dashboard snapshot with polling.

```typescript
const { snapshot, loading, error, refetch } = useLiveSnapshot({
  windowMinutes: 5,    // Live window in minutes
  limit: 1200,         // Max number of requests
  pollInterval: 10000  // milliseconds
});
```

### useProviderPerformance

Fetches provider performance metrics with computed aggregations.

```typescript
const { performance, byProvider, loading, error } = useProviderPerformance({
  model?: string,       // Filter by model
  provider?: string,    // Filter by provider
  pollInterval: 10000   // milliseconds
});
```

### useUsageEvents

Subscribes to usage events via Server-Sent Events (SSE).

```typescript
const { isConnected, reconnect } = useUsageEvents({
  onLog: (record) => console.log(record),
  onError: (error) => console.error(error),
  debounceMs: 900      // Debounce time for events
});
```

### useLogs

Fetches and aggregates logs data.

```typescript
const { records, stats, aggregatedData, loading } = useLogs({
  timeRange: 'day',
  limit: 2000,
  pollInterval: 30000
});
```

### useTimeAgo

Tracks time ago display with auto-refresh.

```typescript
const { timeAgo, lastUpdated, updateLastUpdated } = useTimeAgo({
  refreshInterval: 10000
});
```

### useMetricsStream (New - SSE Architecture)

Unified SSE hook that replaces multiple polling intervals with a single connection.

```typescript
const {
  dashboardData,
  liveSnapshot,
  providerPerformance,
  cooldowns,
  connectionStatus,
  isStale,
  reconnect,
  disconnect
} = useMetricsStream({
  autoConnect: true,
  reconnectDelay: 3000,
  maxReconnectAttempts: 5,
  staleThreshold: 60000
});
```

**Features:**
- Single SSE connection for all metrics data
- Automatic reconnection with exponential backoff
- Connection status tracking
- Stale data detection
- Type-safe event handling

## Migration Guide

### From inline fetching to useDashboardData

Before:
```typescript
const [stats, setStats] = useState([]);
const [cooldowns, setCooldowns] = useState([]);

useEffect(() => {
  const load = async () => {
    const data = await api.getDashboardData('day');
    setStats(data.stats);
    setCooldowns(data.cooldowns);
  };
  load();
  const interval = setInterval(load, 30000);
  return () => clearInterval(interval);
}, []);
```

After:
```typescript
const { data, loading } = useDashboardData({ timeRange: 'day' });
const stats = data?.stats ?? [];
const cooldowns = data?.cooldowns ?? [];
```

## Testing

Run tests with:

```bash
npm test -- features/metrics/hooks
```

## Benefits

1. **Separation of Concerns**: Data fetching logic is separated from UI
2. **Reusability**: Hooks can be used across multiple components
3. **Testability**: Easy to test in isolation
4. **Maintainability**: Clear, focused units of functionality
5. **Performance**: Optimized with proper memoization and cleanup
