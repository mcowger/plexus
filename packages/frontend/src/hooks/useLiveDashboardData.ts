/**
 * @file useLiveDashboardData.ts
 *
 * Custom hook managing polling, concurrency polling, time-series bucketing,
 * rolling window filtering, and aggregation math for the Live Metrics dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  STAT_LABELS,
  type Cooldown,
  type Stat,
  type TodayMetrics,
  type UsageRecord,
  type ConcurrencyData,
} from '../lib/api';
import { formatNumber, formatTokens } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  MODEL_TIMELINE_COLORS,
  MODEL_TIMELINE_MAX_SERIES,
  type EntityStats,
  type MinuteBucket,
  type ModelTimelineBucket,
  type ModelTimelineSeries,
  type StreamFilter,
} from '../components/dashboard/liveTypes';
import {
  aggregateByEntity,
  EXCLUDED_PROVIDER_LABELS,
  getModelLabel,
  getProviderLabel,
} from '../components/dashboard/liveUtils';

export interface UseLiveDashboardDataOptions {
  /** Initial or controlled poll interval in milliseconds */
  pollInterval: number;
  /** Initial or controlled live window period in minutes */
  liveWindowPeriod?: number;
  /** Optional callback when poll interval changes */
  onPollIntervalChange?: (interval: number) => void;
  /** Optional callback when live window period changes */
  onLiveWindowPeriodChange?: (period: number) => void;
}
export interface LiveDashboardData {
  stats: Stat[];
  cooldowns: Cooldown[];
  todayMetrics: TodayMetrics;
  logs: UsageRecord[];
  lastUpdated: Date;
  secondsSinceUpdate: number;
  isConnected: boolean;
  isRefreshing: boolean;
  loading: boolean;
  streamFilter: StreamFilter;
  setStreamFilter: (filter: StreamFilter) => void;
  pollIntervalMs: number;
  setPollIntervalMs: (interval: number) => void;
  liveWindowMinutes: number;
  setLiveWindowMinutes: (minutes: number) => void;
  isVisible: boolean;
  loadData: (silent?: boolean) => Promise<void>;

  concurrencyData: ConcurrencyData[];
  concurrencyHistory: Record<string, unknown>[];
  concurrencyLoading: boolean;
  concurrencyProviders: string[];
  totalConcurrentRequests: number;

  liveRequests: UsageRecord[];
  filteredLiveRequests: UsageRecord[];
  providerRequests: UsageRecord[];
  summary: {
    requestCount: number;
    successCount: number;
    errorCount: number;
    totalTokens: number;
    totalCost: number;
    totalLatency: number;
    totalTtft: number;
  };
  minuteSeries: MinuteBucket[];
  modelTimeline: {
    series: ModelTimelineSeries[];
    seriesLabelMap: Map<string, string>;
    data: ModelTimelineBucket[];
  };
  velocitySeries: { time: string; velocity: number }[];
  providerPulseRows: { label: string; requests: number; successRate: number }[];
  modelPulseRows: { label: string; requests: number; successRate: number }[];
  groupedCooldowns: Record<string, Cooldown[]>;
  providerRows: {
    provider: string;
    requests: number;
    successRate: number;
    avgLatency: number;
    totalCost: number;
  }[];
  providerStats: EntityStats[];
  modelStats: EntityStats[];
  activeProviderCount: number;
  activeModelCount: number;
  successRate: number;
  isStale: boolean;
  tokensPerMinute: number;
  avgLatency: number;
  totalRequestsValue: string | number;
  totalTokensValue: string | number;

  handleClearCooldowns: () => Promise<void>;
  handleClearSingleCooldown: (provider: string, model?: string) => Promise<void>;
}

export function useLiveDashboardData({
  pollInterval,
  liveWindowPeriod = 5,
  onPollIntervalChange,
  onLiveWindowPeriodChange,
}: UseLiveDashboardDataOptions): LiveDashboardData {
  const { principal } = useAuth();
  const toast = useToast();
  const limitedAllowedProviders =
    principal?.role === 'limited' ? (principal.allowedProviders ?? []) : null;

  // ---------------------------------------------------------------------------
  // STATE -- API data from polling
  // ---------------------------------------------------------------------------
  const [stats, setStats] = useState<Stat[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [todayMetrics, setTodayMetrics] = useState<TodayMetrics>({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  });
  const [logs, setLogs] = useState<UsageRecord[]>([]);

  // ---------------------------------------------------------------------------
  // STATE -- UI / polling bookkeeping
  // ---------------------------------------------------------------------------
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all');
  const [pollIntervalMs, setPollIntervalMsState] = useState(pollInterval);
  const [liveWindowMinutes, setLiveWindowMinutesState] = useState(liveWindowPeriod);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPollIntervalMsState(pollInterval);
  }, [pollInterval]);

  useEffect(() => {
    setLiveWindowMinutesState(liveWindowPeriod);
  }, [liveWindowPeriod]);

  const setPollIntervalMs = useCallback(
    (interval: number) => {
      setPollIntervalMsState(interval);
      onPollIntervalChange?.(interval);
    },
    [onPollIntervalChange]
  );

  const setLiveWindowMinutes = useCallback(
    (minutes: number) => {
      setLiveWindowMinutesState(minutes);
      onLiveWindowPeriodChange?.(minutes);
    },
    [onLiveWindowPeriodChange]
  );

  const liveWindowMs = useMemo(() => liveWindowMinutes * 60 * 1000, [liveWindowMinutes]);

  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  // ---------------------------------------------------------------------------
  // STATE -- Concurrency data
  // ---------------------------------------------------------------------------
  const [concurrencyData, setConcurrencyData] = useState<ConcurrencyData[]>([]);
  const [concurrencyHistory, setConcurrencyHistory] = useState<Record<string, unknown>[]>([]);
  const [concurrencyLoading, setConcurrencyLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // DATA FETCHING
  // ---------------------------------------------------------------------------
  const fetchLimit = useMemo(() => {
    if (liveWindowMinutes <= 30) {
      return 500;
    } else if (liveWindowMinutes <= 24 * 60) {
      return 200;
    } else if (liveWindowMinutes <= 7 * 24 * 60) {
      return 100;
    } else {
      return 50;
    }
  }, [liveWindowMinutes]);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsRefreshing(true);
      }

      try {
        const [dashboardData, logData] = await Promise.all([
          api.getDashboardData('day', false),
          api.getLogs(fetchLimit, 0),
        ]);
        setStats(dashboardData.stats);
        setCooldowns(dashboardData.cooldowns);
        setTodayMetrics(dashboardData.todayMetrics);
        setLogs(logData.data || []);
        setLastUpdated(new Date());
        setIsConnected(true);
      } catch (e) {
        setIsConnected(false);
        console.error('Failed to load live metrics data', e);
      } finally {
        if (!silent) {
          setIsRefreshing(false);
        }
        setLoading(false);
      }
    },
    [fetchLimit]
  );

  const fetchConcurrencyData = useCallback(async (silent = false) => {
    if (!silent) {
      setConcurrencyLoading(true);
    }
    try {
      const data = await api.getConcurrencyData('hour', 'live');
      setConcurrencyData(data);
      const point: Record<string, unknown> = { time: new Date().toLocaleTimeString() };
      for (const item of data) {
        const label = item.provider || 'unknown';
        point[label] = Number(item.count || 0);
      }
      setConcurrencyHistory((prev) => {
        const next = [...prev, point];
        return next.length > 30 ? next.slice(-30) : next;
      });
    } catch (e) {
      console.error('Failed to fetch concurrency data', e);
    } finally {
      if (!silent) {
        setConcurrencyLoading(false);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // POLLING EFFECTS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    void loadData();
    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      void loadData(true);
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [isVisible, pollIntervalMs, loadData]);

  useEffect(() => {
    void fetchConcurrencyData();

    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      void fetchConcurrencyData(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [isVisible, fetchConcurrencyData]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      if (visible) {
        void loadData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadData]);

  useEffect(() => {
    const updateTime = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      setSecondsSinceUpdate(seconds);
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // ---------------------------------------------------------------------------
  // DERIVED DATA (useMemo) -- all chart/card data flows from liveRequests
  // ---------------------------------------------------------------------------
  const liveRequests = useMemo(() => {
    const cutoff = Date.now() - liveWindowMs;
    return logs
      .filter((request) => {
        const requestTime = new Date(request.date).getTime();
        return Number.isFinite(requestTime) && requestTime >= cutoff;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [logs, liveWindowMs]);

  const filteredLiveRequests = useMemo(() => {
    if (streamFilter === 'all') {
      return liveRequests;
    }

    if (streamFilter === 'success') {
      return liveRequests.filter(
        (request) => (request.responseStatus || '').toLowerCase() === 'success'
      );
    }

    return liveRequests.filter(
      (request) => (request.responseStatus || '').toLowerCase() !== 'success'
    );
  }, [liveRequests, streamFilter]);

  const providerRequests = useMemo(
    () => liveRequests.filter((r) => !EXCLUDED_PROVIDER_LABELS.includes(getProviderLabel(r))),
    [liveRequests]
  );

  const summary = useMemo(() => {
    return liveRequests.reduce(
      (acc, request) => {
        const isSuccess = (request.responseStatus || '').toLowerCase() === 'success';
        acc.requestCount += 1;
        if (isSuccess) {
          acc.successCount += 1;
        } else {
          acc.errorCount += 1;
        }

        acc.totalTokens +=
          Number(request.tokensInput || 0) +
          Number(request.tokensOutput || 0) +
          Number(request.tokensCached || 0) +
          Number(request.tokensCacheWrite || 0);
        acc.totalCost += Number(request.costTotal || 0);
        acc.totalLatency += Number(request.durationMs || 0);
        acc.totalTtft += Number(request.ttftMs || 0);
        return acc;
      },
      {
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalLatency: 0,
        totalTtft: 0,
      }
    );
  }, [liveRequests]);

  const minuteSeries = useMemo(() => {
    const buckets = new Map<string, MinuteBucket>();
    const now = Date.now();

    const useMinuteBuckets = liveWindowMinutes <= 30;
    const use5MinuteBuckets = liveWindowMinutes <= 24 * 60;
    const useHourlyBuckets = liveWindowMinutes <= 7 * 24 * 60;

    let bucketCount: number;
    let bucketSizeMs: number;

    if (useMinuteBuckets) {
      bucketCount = liveWindowMinutes;
      bucketSizeMs = 60000;
    } else if (use5MinuteBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 5);
      bucketSizeMs = 300000;
    } else if (useHourlyBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 60);
      bucketSizeMs = 3600000;
    } else {
      bucketCount = Math.ceil(liveWindowMinutes / (60 * 6));
      bucketSizeMs = 21600000;
    }

    const MAX_BUCKETS = 100;
    if (bucketCount > MAX_BUCKETS) {
      bucketCount = MAX_BUCKETS;
      bucketSizeMs = Math.ceil(liveWindowMs / MAX_BUCKETS);
    }

    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      buckets.set(key, { time: key, requests: 0, errors: 0, tokens: 0 });
    }

    for (const request of liveRequests) {
      const requestTime = new Date(request.date).getTime();
      const bucketIndex = Math.floor((now - requestTime) / bucketSizeMs);
      const bucketDate = new Date(now - bucketIndex * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }

      bucket.requests += 1;
      if ((request.responseStatus || '').toLowerCase() !== 'success') {
        bucket.errors += 1;
      }
      bucket.tokens +=
        Number(request.tokensInput || 0) +
        Number(request.tokensOutput || 0) +
        Number(request.tokensCached || 0) +
        Number(request.tokensCacheWrite || 0);
    }

    return Array.from(buckets.values());
  }, [liveRequests, liveWindowMinutes, liveWindowMs]);

  const modelTimeline = useMemo(() => {
    const modelCounts = new Map<string, number>();
    for (const request of liveRequests) {
      const model = getModelLabel(request);
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }

    const topModels = Array.from(modelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MODEL_TIMELINE_MAX_SERIES)
      .map(([label]) => label);

    const series: ModelTimelineSeries[] = topModels.map((label, index) => ({
      key: 'model_' + index,
      label,
      color: MODEL_TIMELINE_COLORS[index % MODEL_TIMELINE_COLORS.length],
    }));
    const seriesKeyByLabel = new Map(series.map((entry) => [entry.label, entry.key]));

    const buckets = new Map<string, ModelTimelineBucket>();
    const now = Date.now();

    const useMinuteBuckets = liveWindowMinutes <= 30;
    const use5MinuteBuckets = liveWindowMinutes <= 24 * 60;
    const useHourlyBuckets = liveWindowMinutes <= 7 * 24 * 60;

    let bucketCount: number;
    let bucketSizeMs: number;

    if (useMinuteBuckets) {
      bucketCount = liveWindowMinutes;
      bucketSizeMs = 60000;
    } else if (use5MinuteBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 5);
      bucketSizeMs = 300000;
    } else if (useHourlyBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 60);
      bucketSizeMs = 3600000;
    } else {
      bucketCount = Math.ceil(liveWindowMinutes / (60 * 6));
      bucketSizeMs = 21600000;
    }

    const MAX_BUCKETS = 100;
    if (bucketCount > MAX_BUCKETS) {
      bucketCount = MAX_BUCKETS;
      bucketSizeMs = Math.ceil(liveWindowMs / MAX_BUCKETS);
    }

    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket: ModelTimelineBucket = {
        time: key,
        requests: 0,
        errors: 0,
        tokens: 0,
        avgTtftMs: 0,
        avgTps: 0,
        ttftTotal: 0,
        ttftCount: 0,
        tpsTotal: 0,
        tpsCount: 0,
      };

      for (const item of series) {
        bucket[item.key] = 0;
      }
      buckets.set(key, bucket);
    }

    for (const request of liveRequests) {
      const requestTime = new Date(request.date).getTime();
      const bucketIndex = Math.floor((now - requestTime) / bucketSizeMs);
      const bucketDate = new Date(now - bucketIndex * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }

      bucket.requests += 1;
      if ((request.responseStatus || '').toLowerCase() !== 'success') {
        bucket.errors += 1;
      }
      bucket.tokens +=
        Number(request.tokensInput || 0) +
        Number(request.tokensOutput || 0) +
        Number(request.tokensCached || 0) +
        Number(request.tokensCacheWrite || 0);

      const modelLabel = getModelLabel(request);
      const seriesKey = seriesKeyByLabel.get(modelLabel);
      if (seriesKey) {
        bucket[seriesKey] = Number(bucket[seriesKey] || 0) + 1;
      }

      const ttft = Number(request.ttftMs || 0);
      if (Number.isFinite(ttft) && ttft > 0) {
        bucket.ttftTotal += ttft;
        bucket.ttftCount += 1;
      }

      const tps = Number(request.tokensPerSec || 0);
      if (Number.isFinite(tps) && tps > 0) {
        bucket.tpsTotal += tps;
        bucket.tpsCount += 1;
      }
    }

    const data = Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      avgTtftMs: bucket.ttftCount > 0 ? bucket.ttftTotal / bucket.ttftCount : 0,
      avgTps: bucket.tpsCount > 0 ? bucket.tpsTotal / bucket.tpsCount : 0,
    }));

    return {
      series,
      seriesLabelMap: new Map(series.map((entry) => [entry.key, entry.label])),
      data,
    };
  }, [liveRequests, liveWindowMinutes, liveWindowMs]);

  // Scalar values
  const successRate =
    summary.requestCount > 0 ? (summary.successCount / summary.requestCount) * 100 : 0;
  const isStale = secondsSinceUpdate > Math.ceil((pollIntervalMs * 3) / 1000);
  const tokensPerMinute = summary.totalTokens / liveWindowMinutes;
  const avgLatency = summary.requestCount > 0 ? summary.totalLatency / summary.requestCount : 0;

  const totalRequestsValue =
    stats.find((stat) => stat.label === STAT_LABELS.REQUESTS)?.value || formatNumber(0, 0);
  const totalTokensValue =
    stats.find((stat) => stat.label === STAT_LABELS.TOKENS)?.value || formatTokens(0);

  const totalConcurrentRequests = useMemo(() => {
    return concurrencyData.reduce((acc, item) => acc + Number(item.count || 0), 0);
  }, [concurrencyData]);

  const concurrencyProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const point of concurrencyHistory) {
      for (const key of Object.keys(point)) {
        if (key !== 'time') providers.add(key);
      }
    }
    return Array.from(providers).sort();
  }, [concurrencyHistory]);

  const providerRows = useMemo(() => {
    const providers = new Map<
      string,
      { requests: number; success: number; totalLatency: number; totalCost: number }
    >();

    for (const request of providerRequests) {
      const provider = getProviderLabel(request);
      const row = providers.get(provider) || {
        requests: 0,
        success: 0,
        totalLatency: 0,
        totalCost: 0,
      };

      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      row.totalLatency += Number(request.durationMs || 0);
      row.totalCost += Number(request.costTotal || 0);
      providers.set(provider, row);
    }

    return Array.from(providers.entries())
      .map(([provider, row]) => ({
        provider,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
        avgLatency: row.requests > 0 ? row.totalLatency / row.requests : 0,
        totalCost: row.totalCost,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 6);
  }, [providerRequests]);

  const velocitySeries = useMemo(() => {
    return minuteSeries.map((bucket, index, arr) => {
      if (index === 0) {
        return { time: bucket.time, velocity: bucket.requests };
      }

      const prev = arr[index - 1];
      return {
        time: bucket.time,
        velocity: bucket.requests - prev.requests,
      };
    });
  }, [minuteSeries]);

  const providerPulseRows = useMemo(() => {
    const rows = new Map<string, { requests: number; success: number }>();
    for (const request of providerRequests) {
      const provider = getProviderLabel(request);
      const row = rows.get(provider) || { requests: 0, success: 0 };
      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      rows.set(provider, row);
    }

    return Array.from(rows.entries())
      .map(([label, row]) => ({
        label,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [providerRequests]);

  const modelPulseRows = useMemo(() => {
    const rows = new Map<string, { requests: number; success: number }>();
    for (const request of liveRequests) {
      const model = getModelLabel(request);
      const row = rows.get(model) || { requests: 0, success: 0 };
      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      rows.set(model, row);
    }

    return Array.from(rows.entries())
      .map(([label, row]) => ({
        label,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [liveRequests]);

  const groupedCooldowns = useMemo(() => {
    return cooldowns.reduce(
      (acc, cooldown) => {
        const key = String(cooldown.provider) + ':' + String(cooldown.model);
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(cooldown);
        return acc;
      },
      {} as Record<string, Cooldown[]>
    );
  }, [cooldowns]);

  const providerStats = useMemo(
    () => aggregateByEntity(providerRequests, 'provider'),
    [providerRequests]
  );

  const modelStats = useMemo(() => aggregateByEntity(liveRequests, 'model'), [liveRequests]);

  const activeProviderCount = providerStats.filter((p) => p.requests > 0).length;
  const activeModelCount = modelStats.filter((m) => m.requests > 0).length;

  const handleClearCooldowns = useCallback(async () => {
    const ok = await toast.confirm({
      title: 'Clear ALL provider cooldowns?',
      message:
        "Cooldowns are shared across all API keys. Clearing them affects traffic for every key using those providers. If the underlying problem hasn't been resolved, cooldowns will simply re-establish on the next failure.",
      confirmLabel: 'Clear all',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await api.clearCooldown();
      await loadData();
    } catch (e) {
      toast.error('Failed to clear cooldowns');
      console.error('Failed to clear cooldowns', e);
    }
  }, [loadData, toast]);

  const handleClearSingleCooldown = useCallback(
    async (provider: string, model?: string) => {
      if (
        limitedAllowedProviders &&
        limitedAllowedProviders.length > 0 &&
        !limitedAllowedProviders.includes(provider)
      ) {
        toast.error(`Your API key is not permitted to clear cooldowns for provider '${provider}'.`);
        return;
      }
      const ok = await toast.confirm({
        title: `Clear cooldown for ${provider}${model ? ':' + model : ''}?`,
        message:
          "This affects traffic for every API key using that provider. The cooldown will re-establish on the next failure if the issue isn't resolved.",
        confirmLabel: 'Clear',
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await api.clearCooldown(provider, model);
        await loadData();
      } catch (e) {
        toast.error('Failed to clear cooldown');
        console.error('Failed to clear cooldown', e);
      }
    },
    [limitedAllowedProviders, loadData, toast]
  );

  return {
    // Polling state
    stats,
    cooldowns,
    todayMetrics,
    logs,
    lastUpdated,
    secondsSinceUpdate,
    isConnected,
    isRefreshing,
    loading,
    streamFilter,
    setStreamFilter,
    pollIntervalMs,
    setPollIntervalMs,
    liveWindowMinutes,
    setLiveWindowMinutes,
    isVisible,
    loadData,

    // Concurrency state
    concurrencyData,
    concurrencyHistory,
    concurrencyLoading,
    concurrencyProviders,
    totalConcurrentRequests,

    // Derived memos
    liveRequests,
    filteredLiveRequests,
    providerRequests,
    summary,
    minuteSeries,
    modelTimeline,
    velocitySeries,
    providerPulseRows,
    modelPulseRows,
    groupedCooldowns,
    providerRows,
    providerStats,
    modelStats,
    activeProviderCount,
    activeModelCount,
    successRate,
    isStale,
    tokensPerMinute,
    avgLatency,
    totalRequestsValue,
    totalTokensValue,

    // Actions
    handleClearCooldowns,
    handleClearSingleCooldown,
  };
}

export type UseLiveDashboardDataReturn = LiveDashboardData;
