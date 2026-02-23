import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock, Database, RefreshCw, Signal, X, Zap } from 'lucide-react';
import {
  AreaChart,
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  api,
  STAT_LABELS,
  type Cooldown,
  type Stat,
  type TodayMetrics,
  type UsageRecord,
} from '../lib/api';
import {
  formatCost,
  formatMs,
  formatNumber,
  formatTimeAgo,
  formatTokens,
  formatTPS,
} from '../lib/format';

type MinuteBucket = {
  time: string;
  requests: number;
  errors: number;
  tokens: number;
};

type PulseRow = {
  label: string;
  requests: number;
  successRate: number;
};

type ModelTimelineSeries = {
  key: string;
  label: string;
  color: string;
};

type ModelTimelineBucket = Record<string, string | number> & {
  time: string;
  requests: number;
  errors: number;
  tokens: number;
  avgTtftMs: number;
  avgTps: number;
  ttftTotal: number;
  ttftCount: number;
  tpsTotal: number;
  tpsCount: number;
};

type StreamFilter = 'all' | 'success' | 'error';

const LIVE_WINDOW_MINUTES = 5;
const LIVE_WINDOW_MS = LIVE_WINDOW_MINUTES * 60 * 1000;
const POLL_INTERVAL_MS = 10000;
const RECENT_REQUEST_LIMIT = 200;
const POLL_INTERVAL_OPTIONS = [5000, 10000, 30000] as const;
const MODEL_TIMELINE_MAX_SERIES = 5;
const MODEL_TIMELINE_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444'] as const;

const PLACEHOLDER_LABELS = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'undefined']);

const normalizeTelemetryLabel = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }

  if (PLACEHOLDER_LABELS.has(normalized.toLowerCase())) {
    return '';
  }

  return normalized;
};

const getProviderLabel = (request: UsageRecord): string => {
  const provider = normalizeTelemetryLabel(request.provider);
  if (provider) {
    return provider;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Request';
  }

  return 'Unresolved Provider';
};

const getModelLabel = (request: UsageRecord): string => {
  const model =
    normalizeTelemetryLabel(request.selectedModelName) ||
    normalizeTelemetryLabel(request.incomingModelAlias);
  if (model) {
    return model;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Before Model Selection';
  }

  return 'Unresolved Model';
};

export const LiveMetrics = () => {
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
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState('Just now');
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all');
  const [pollIntervalMs, setPollIntervalMs] = useState(POLL_INTERVAL_MS);
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCard, setModalCard] = useState<
    'velocity' | 'provider' | 'model' | 'timeline' | 'requests' | null
  >(null);

  const openModal = (card: typeof modalCard) => {
    setModalCard(card);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalCard(null);
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    if (modalOpen) {
      window.addEventListener('keydown', handleEscape);
    }
    return () => window.removeEventListener('keydown', handleEscape);
  }, [modalOpen]);

  const loadData = async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
    }

    try {
      const [dashboardData, logData] = await Promise.all([
        api.getDashboardData('day'),
        api.getLogs(RECENT_REQUEST_LIMIT, 0),
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
  };

  useEffect(() => {
    void loadData();
    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      void loadData(true);
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [isVisible, pollIntervalMs]);

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
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      setSecondsSinceUpdate(seconds);
      if (seconds < 5) {
        setTimeAgo('Just now');
        return;
      }
      setTimeAgo(formatTimeAgo(seconds));
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const liveRequests = useMemo(() => {
    const cutoff = Date.now() - LIVE_WINDOW_MS;
    return logs
      .filter((request) => {
        const requestTime = new Date(request.date).getTime();
        return Number.isFinite(requestTime) && requestTime >= cutoff;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [logs]);

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

    for (let i = LIVE_WINDOW_MINUTES - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * 60000);
      const key = bucketDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets.set(key, { time: key, requests: 0, errors: 0, tokens: 0 });
    }

    for (const request of liveRequests) {
      const key = new Date(request.date).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
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
  }, [liveRequests]);

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
      key: `model_${index}`,
      label,
      color: MODEL_TIMELINE_COLORS[index % MODEL_TIMELINE_COLORS.length],
    }));
    const seriesKeyByLabel = new Map(series.map((entry) => [entry.label, entry.key]));

    const buckets = new Map<string, ModelTimelineBucket>();
    const now = Date.now();

    for (let i = LIVE_WINDOW_MINUTES - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * 60000);
      const key = bucketDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      const key = new Date(request.date).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
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
  }, [liveRequests]);

  const successRate =
    summary.requestCount > 0 ? (summary.successCount / summary.requestCount) * 100 : 0;
  const isStale = secondsSinceUpdate > Math.ceil((pollIntervalMs * 3) / 1000);
  const tokensPerMinute = summary.totalTokens / LIVE_WINDOW_MINUTES;
  const costPerMinute = summary.totalCost / LIVE_WINDOW_MINUTES;
  const avgLatency = summary.requestCount > 0 ? summary.totalLatency / summary.requestCount : 0;
  const avgTtft = summary.requestCount > 0 ? summary.totalTtft / summary.requestCount : 0;
  const throughputSamples = liveRequests
    .map((request) => Number(request.tokensPerSec || 0))
    .filter((tps) => Number.isFinite(tps) && tps > 0);
  const avgThroughput =
    throughputSamples.length > 0
      ? throughputSamples.reduce((acc, tps) => acc + tps, 0) / throughputSamples.length
      : 0;
  const totalRequestsValue =
    stats.find((stat) => stat.label === STAT_LABELS.REQUESTS)?.value || formatNumber(0, 0);
  const totalTokensValue =
    stats.find((stat) => stat.label === STAT_LABELS.TOKENS)?.value || formatTokens(0);
  const todayTokenTotal =
    todayMetrics.inputTokens +
    todayMetrics.outputTokens +
    todayMetrics.reasoningTokens +
    todayMetrics.cachedTokens +
    todayMetrics.cacheWriteTokens;

  const providerRows = useMemo(() => {
    const providers = new Map<
      string,
      { requests: number; success: number; totalLatency: number; totalCost: number }
    >();

    for (const request of liveRequests) {
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
  }, [liveRequests]);

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
    for (const request of liveRequests) {
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
  }, [liveRequests]);

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

  const renderPulseList = (rows: PulseRow[], emptyText: string) => {
    if (rows.length === 0) {
      return <div className="text-text-secondary text-sm py-2">{emptyText}</div>;
    }

    return (
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-md border border-border-glass bg-bg-glass px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="text-sm text-text font-medium truncate max-w-[240px]"
                title={row.label}
              >
                {row.label}
              </span>
              <span className="text-xs text-text-secondary">
                {formatNumber(row.requests, 0)} requests
              </span>
            </div>
            <div className="mt-1 text-xs text-text-secondary">
              Success: {row.successRate.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    );
  };

  const groupedCooldowns = useMemo(() => {
    return cooldowns.reduce(
      (acc, cooldown) => {
        const key = `${cooldown.provider}:${cooldown.model}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(cooldown);
        return acc;
      },
      {} as Record<string, Cooldown[]>
    );
  }, [cooldowns]);

  const handleClearCooldowns = async () => {
    if (!confirm('Are you sure you want to clear all provider cooldowns?')) {
      return;
    }

    try {
      await api.clearCooldown();
      await loadData();
    } catch (e) {
      alert('Failed to clear cooldowns');
      console.error('Failed to clear cooldowns', e);
    }
  };

  const Modal = ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) => {
    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-6xl max-h-[90vh] overflow-auto rounded-lg border border-border-glass bg-bg-card p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-text">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
              aria-label="Close modal"
            >
              <X size={24} className="text-text-secondary" />
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  };

  const getModalTitle = () => {
    switch (modalCard) {
      case 'velocity':
        return 'Request Velocity (Last 5 Minutes)';
      case 'provider':
        return 'Provider Pulse (5m)';
      case 'model':
        return 'Model Pulse (5m)';
      case 'timeline':
        return 'Live Timeline';
      case 'requests':
        return 'Latest Requests';
      default:
        return '';
    }
  };

  const renderModalContent = () => {
    switch (modalCard) {
      case 'velocity':
        return (
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={velocitySeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="velocity"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      case 'provider':
        return (
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={providerPulseRows.slice(0, 8)}
                margin={{ top: 10, right: 24, left: 0, bottom: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-text-secondary)"
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      case 'model':
        return (
          <div className="h-[60vh]">
            {modelPulseRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary">
                No model traffic in the selected live window.
              </div>
            ) : (
              <div className="space-y-3">
                {modelPulseRows.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-md border border-border-glass bg-bg-glass px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-base text-text font-medium">{row.label}</span>
                      <span className="text-sm text-text-secondary">
                        {formatNumber(row.requests, 0)} requests
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      Success: {row.successRate.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'timeline':
        return (
          <div className="space-y-6">
            <div className="h-[40vh]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={minuteSeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="liveRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
                    </linearGradient>
                    <linearGradient id="liveTokens" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                  <YAxis yAxisId="left" stroke="var(--color-text-secondary)" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--color-text-secondary)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="requests"
                    stroke="#3b82f6"
                    fillOpacity={1}
                    fill="url(#liveRequests)"
                    strokeWidth={2}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="errors"
                    stroke="#ef4444"
                    fillOpacity={0.15}
                    fill="#ef4444"
                    strokeWidth={1.5}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="tokens"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#liveTokens)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {modelTimeline.series.length > 0 && (
              <div className="h-[30vh]">
                <div className="text-sm text-text-secondary mb-2">Model Stack + Runtime</div>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={modelTimeline.data}
                    margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                    <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                    <YAxis yAxisId="left" stroke="var(--color-text-secondary)" />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="var(--color-text-secondary)"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {modelTimeline.series.map((series) => (
                      <Bar
                        key={series.key}
                        yAxisId="left"
                        stackId="model-stack"
                        dataKey={series.key}
                        fill={series.color}
                      />
                    ))}
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgTtftMs"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgTps"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      case 'requests':
        return (
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {filteredLiveRequests.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary">
                {liveRequests.length === 0
                  ? 'No requests observed yet.'
                  : 'No requests match the current filter.'}
              </div>
            ) : (
              filteredLiveRequests.map((request) => {
                const requestTimeSeconds = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)
                );
                const status = (request.responseStatus || 'errored').toLowerCase();
                const isSuccess = status.toLowerCase() === 'success';
                const providerLabel = getProviderLabel(request);
                const modelLabel = getModelLabel(request);
                return (
                  <div
                    key={request.requestId}
                    className="rounded-md border border-border-glass bg-bg-glass p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base text-text font-medium">{providerLabel}</span>
                        <span className="text-sm text-text-secondary">{modelLabel}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md ${
                            isSuccess
                              ? 'text-success bg-emerald-500/15 border border-success/25'
                              : 'text-danger bg-red-500/15 border border-danger/30'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <span className="text-sm text-text-muted">
                        {formatTimeAgo(requestTimeSeconds)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
                      <span>ID: {request.requestId.slice(0, 8)}...</span>
                      <span>
                        Tokens:{' '}
                        {formatTokens(
                          Number(request.tokensInput || 0) +
                            Number(request.tokensOutput || 0) +
                            Number(request.tokensCached || 0) +
                            Number(request.tokensCacheWrite || 0)
                        )}
                      </span>
                      <span>Cost: {formatCost(Number(request.costTotal || 0), 6)}</span>
                      <span>Latency: {formatMs(Number(request.durationMs || 0))}</span>
                      <span>TTFT: {formatMs(Number(request.ttftMs || 0))}</span>
                      <span>TPS: {formatTPS(Number(request.tokensPerSec || 0))}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="header-left">
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Live Metrics</h1>
          {cooldowns.length > 0 ? (
            <Badge
              status="warning"
              secondaryText={`Last updated: ${timeAgo}`}
              style={{ minWidth: '190px' }}
            >
              System Degraded
            </Badge>
          ) : (
            <Badge
              status="connected"
              secondaryText={`Last updated: ${timeAgo}`}
              style={{ minWidth: '190px' }}
            >
              System Online
            </Badge>
          )}
        </div>

        <Badge
          status={isConnected && !isStale ? 'connected' : 'warning'}
          secondaryText={`Window: last ${LIVE_WINDOW_MINUTES}m`}
          style={{ minWidth: '210px' }}
        >
          {isConnected
            ? isStale
              ? 'Live Polling Delayed'
              : 'Live Polling Active'
            : 'Live Polling Reconnecting'}
        </Badge>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void loadData()}
          isLoading={isRefreshing}
        >
          <RefreshCw size={14} />
          Refresh Now
        </Button>
        {POLL_INTERVAL_OPTIONS.map((option) => {
          const label = `${Math.floor(option / 1000)}s`;
          return (
            <Button
              key={option}
              size="sm"
              variant={pollIntervalMs === option ? 'primary' : 'secondary'}
              onClick={() => setPollIntervalMs(option)}
            >
              Poll {label}
            </Button>
          );
        })}
        <span className="text-xs text-text-muted">
          {isVisible ? 'Tab active' : 'Tab hidden'} - data refresh resumes on focus.
        </span>
      </div>

      <div
        className="mb-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
        }}
      >
        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Total Requests
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Activity size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{totalRequestsValue}</div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Total Tokens
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{totalTokensValue}</div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Requests Today
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Activity size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatNumber(todayMetrics.requests, 0)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Tokens Today
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatTokens(todayTokenTotal)}
          </div>
          <div className="text-xs text-text-muted space-y-0.5">
            <div>In: {formatTokens(todayMetrics.inputTokens)}</div>
            <div>Out: {formatTokens(todayMetrics.outputTokens)}</div>
            {todayMetrics.reasoningTokens > 0 && (
              <div>Reasoning: {formatTokens(todayMetrics.reasoningTokens)}</div>
            )}
            {todayMetrics.cachedTokens > 0 && (
              <div>Cached: {formatTokens(todayMetrics.cachedTokens)}</div>
            )}
            {todayMetrics.cacheWriteTokens > 0 && (
              <div>Cache Write: {formatTokens(todayMetrics.cacheWriteTokens)}</div>
            )}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Cost Today
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Zap size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatCost(todayMetrics.totalCost, 4)}
          </div>
        </div>
      </div>

      <div
        className="mb-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
        }}
      >
        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Requests ({LIVE_WINDOW_MINUTES}m)
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Activity size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatNumber(summary.requestCount, 0)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Success Rate
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Signal size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {successRate.toFixed(1)}%
          </div>
          <div className="text-xs text-text-muted mt-1">
            {summary.successCount} success / {summary.errorCount} errors
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Tokens / Min
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatTokens(tokensPerMinute)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Cost / Min
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Zap size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatCost(costPerMinute, 6)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Avg Latency
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Clock size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatMs(avgLatency)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Avg TTFT / Throughput
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Signal size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatMs(avgTtft)}</div>
          <div className="text-xs text-text-muted mt-1">{formatTPS(avgThroughput)} tok/s</div>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <Card
          title="Service Alerts"
          className="alert-card"
          style={{ borderColor: 'var(--color-warning)' }}
          extra={
            cooldowns.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={handleClearCooldowns}>
                Clear All
              </Button>
            ) : undefined
          }
        >
          {cooldowns.length === 0 ? (
            <div className="text-text-secondary text-sm py-2">
              No service alerts in the active cooldown window.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
                const [provider, model] = key.split(':');
                const hasAccountId = modelCooldowns.some((cooldown) => cooldown.accountId);
                const maxTime = Math.max(
                  ...modelCooldowns.map((cooldown) => cooldown.timeRemainingMs)
                );
                const minutes = Math.ceil(maxTime / 60000);
                const modelDisplay = model || 'all models';

                let statusText: string;
                if (hasAccountId && modelCooldowns.length > 1) {
                  statusText = `${modelDisplay} has ${modelCooldowns.length} accounts on cooldown for up to ${minutes} minutes`;
                } else if (hasAccountId && modelCooldowns.length === 1) {
                  statusText = `${modelDisplay} has 1 account on cooldown for ${minutes} minutes`;
                } else {
                  statusText = `${modelDisplay} is on cooldown for ${minutes} minutes`;
                }

                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px',
                      backgroundColor: 'rgba(255, 171, 0, 0.1)',
                      borderRadius: '4px',
                    }}
                  >
                    <AlertTriangle size={16} color="var(--color-warning)" />
                    <span style={{ fontWeight: 500 }}>
                      {normalizeTelemetryLabel(provider) || 'Unknown Provider'}
                    </span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{statusText}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4">
        <Card
          title="Top Providers (Live Window)"
          extra={<span className="text-xs text-text-secondary">Top 6 by requests</span>}
        >
          {providerRows.length === 0 ? (
            <div className="text-text-secondary text-sm py-2">
              No provider activity in the last {LIVE_WINDOW_MINUTES} minutes.
            </div>
          ) : (
            <div className="space-y-2">
              {providerRows.map((row) => (
                <div
                  key={row.provider}
                  className="rounded-md border border-border-glass bg-bg-glass px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-text font-medium">{row.provider}</span>
                    <span className="text-xs text-text-secondary">
                      {formatNumber(row.requests, 0)} requests
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                    <span>Success: {row.successRate.toFixed(1)}%</span>
                    <span>Avg latency: {formatMs(row.avgLatency)}</span>
                    <span>Cost: {formatCost(row.totalCost, 6)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div
        className="grid gap-4 mb-4 flex-col lg:flex-row"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        <Card
          title="Request Velocity (Last 5 Minutes)"
          extra={<span className="text-xs text-text-secondary">Minute-over-minute delta</span>}
          onClick={() => openModal('velocity')}
          style={{ cursor: 'pointer' }}
          className="hover:shadow-lg hover:border-primary/30 transition-all"
        >
          {velocitySeries.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-text-secondary">
              No velocity data available
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={velocitySeries}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis
                    dataKey="time"
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                    formatter={(value) => [formatNumber(Number(value || 0), 0), 'Velocity']}
                  />
                  <Line
                    type="monotone"
                    dataKey="velocity"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Provider Pulse (5m)"
          extra={<span className="text-xs text-text-secondary">Top 8 providers</span>}
          onClick={() => openModal('provider')}
          style={{ cursor: 'pointer' }}
          className="hover:shadow-lg hover:border-primary/30 transition-all"
        >
          {providerPulseRows.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-text-secondary">
              No provider traffic in the selected live window.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={providerPulseRows.slice(0, 6)}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                    formatter={(value) => [formatNumber(Number(value || 0), 0), 'Requests']}
                  />
                  <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div
        className="grid gap-4 mb-4 flex-col lg:flex-row"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        <Card
          title="Provider Pulse Details (5m)"
          extra={<span className="text-xs text-text-secondary">Requests + success rate</span>}
        >
          {renderPulseList(providerPulseRows, 'No provider traffic in the selected live window.')}
        </Card>

        <Card
          title="Model Pulse (5m)"
          extra={<span className="text-xs text-text-secondary">Top 8 models</span>}
          onClick={() => openModal('model')}
          style={{ cursor: 'pointer' }}
          className="hover:shadow-lg hover:border-primary/30 transition-all"
        >
          {renderPulseList(modelPulseRows, 'No model traffic in the selected live window.')}
        </Card>
      </div>

      <div
        className="grid gap-4 mb-4 flex-col lg:flex-row"
        style={{ gridTemplateColumns: '1.2fr 1fr' }}
      >
        <Card
          className="min-w-0 hover:shadow-lg hover:border-primary/30 transition-all"
          title="Live Timeline"
          extra={<Clock size={16} className="text-primary" />}
          onClick={() => openModal('timeline')}
          style={{ cursor: 'pointer' }}
        >
          {loading ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              Loading...
            </div>
          ) : minuteSeries.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              No requests in the last {LIVE_WINDOW_MINUTES} minutes
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={minuteSeries}
                    margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="liveRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
                      </linearGradient>
                      <linearGradient id="liveTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                    <XAxis
                      dataKey="time"
                      stroke="var(--color-text-secondary)"
                      tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="var(--color-text-secondary)"
                      tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="var(--color-text-secondary)"
                      tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: 'var(--color-text)' }}
                      formatter={(value, name) => {
                        if (name === 'tokens') {
                          return [formatTokens(Number(value || 0)), 'Tokens'];
                        }
                        return [
                          formatNumber(Number(value || 0), 0),
                          name === 'requests' ? 'Requests' : 'Errors',
                        ];
                      }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="requests"
                      stroke="#3b82f6"
                      fillOpacity={1}
                      fill="url(#liveRequests)"
                      strokeWidth={2}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="errors"
                      stroke="#ef4444"
                      fillOpacity={0.15}
                      fill="#ef4444"
                      strokeWidth={1.5}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="tokens"
                      stroke="#10b981"
                      fillOpacity={1}
                      fill="url(#liveTokens)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-md border border-border-glass bg-bg-glass px-3 pt-3 pb-1">
                <div className="mb-2 text-xs text-text-secondary">
                  Model stack + runtime (TTFT and TPS) in the last {LIVE_WINDOW_MINUTES} minutes
                </div>
                {modelTimeline.series.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-text-secondary text-sm">
                    No model stack data in the selected live window.
                  </div>
                ) : (
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={modelTimeline.data}
                        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                        <XAxis
                          dataKey="time"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        />
                        <YAxis
                          yAxisId="left"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                          tickFormatter={(value) => formatNumber(Number(value || 0), 1)}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                          }}
                          labelStyle={{ color: 'var(--color-text)' }}
                          formatter={(value, name) => {
                            const numeric = Number(value || 0);
                            const label = modelTimeline.seriesLabelMap.get(String(name));
                            if (label) {
                              return [formatNumber(numeric, 0), label];
                            }
                            if (name === 'avgTtftMs') {
                              return [formatMs(numeric), 'Avg TTFT'];
                            }
                            if (name === 'avgTps') {
                              return [formatTPS(numeric), 'Avg TPS'];
                            }
                            return [formatNumber(numeric, 0), String(name)];
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 11 }}
                          formatter={(value) =>
                            modelTimeline.seriesLabelMap.get(String(value)) || value
                          }
                        />
                        {modelTimeline.series.map((series) => (
                          <Bar
                            key={series.key}
                            yAxisId="left"
                            stackId="model-stack"
                            dataKey={series.key}
                            fill={series.color}
                          />
                        ))}
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="avgTtftMs"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="avgTps"
                          stroke="#22c55e"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Latest Requests"
          onClick={() => openModal('requests')}
          style={{ cursor: 'pointer' }}
          className="hover:shadow-lg hover:border-primary/30 transition-all"
          extra={
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-secondary mr-1">Latest 20</span>
              <Button
                size="sm"
                variant={streamFilter === 'all' ? 'primary' : 'secondary'}
                onClick={() => setStreamFilter('all')}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={streamFilter === 'success' ? 'primary' : 'secondary'}
                onClick={() => setStreamFilter('success')}
              >
                Success
              </Button>
              <Button
                size="sm"
                variant={streamFilter === 'error' ? 'primary' : 'secondary'}
                onClick={() => setStreamFilter('error')}
              >
                Errors
              </Button>
            </div>
          }
        >
          {filteredLiveRequests.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              {liveRequests.length === 0
                ? 'No requests observed yet.'
                : 'No requests match the current filter.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredLiveRequests.slice(0, 20).map((request) => {
                const requestTimeSeconds = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)
                );
                const status = (request.responseStatus || 'errored').toLowerCase();
                const isSuccess = status.toLowerCase() === 'success';
                const providerLabel = getProviderLabel(request);
                const modelLabel = getModelLabel(request);
                return (
                  <div
                    key={request.requestId}
                    className="rounded-md border border-border-glass bg-bg-glass p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text font-medium">{providerLabel}</span>
                        <span className="text-xs text-text-secondary">{modelLabel}</span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-md ${
                            isSuccess
                              ? 'text-success bg-emerald-500/15 border border-success/25'
                              : 'text-danger bg-red-500/15 border border-danger/30'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {formatTimeAgo(requestTimeSeconds)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <span>ID: {request.requestId.slice(0, 8)}...</span>
                      <span>
                        Tokens:{' '}
                        {formatTokens(
                          Number(request.tokensInput || 0) +
                            Number(request.tokensOutput || 0) +
                            Number(request.tokensCached || 0) +
                            Number(request.tokensCacheWrite || 0)
                        )}
                      </span>
                      <span>Cost: {formatCost(Number(request.costTotal || 0), 6)}</span>
                      <span>Latency: {formatMs(Number(request.durationMs || 0))}</span>
                      <span>TTFT: {formatMs(Number(request.ttftMs || 0))}</span>
                      <span>TPS: {formatTPS(Number(request.tokensPerSec || 0))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Modal isOpen={modalOpen} onClose={closeModal} title={getModalTitle()}>
          {renderModalContent()}
        </Modal>
      </div>
    </div>
  );
};
