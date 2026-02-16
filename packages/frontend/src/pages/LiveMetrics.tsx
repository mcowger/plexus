import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  api,
  type Cooldown,
  type LiveDashboardSnapshot,
  type ProviderPerformanceData,
  STAT_LABELS,
  type Stat,
  type TodayMetrics,
  type UsageData
} from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTimeAgo, formatTokens, formatTPS } from '../lib/format';
import { Activity, AlertTriangle, Database, Server, Signal, Zap, Clock } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart
} from 'recharts';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

const LIVE_WINDOW_MINUTES = 5;
const LIVE_REQUEST_LIMIT = 1200;

const EMPTY_LIVE_SNAPSHOT: LiveDashboardSnapshot = {
  windowMinutes: LIVE_WINDOW_MINUTES,
  requestCount: 0,
  successCount: 0,
  errorCount: 0,
  successRate: 1,
  totalTokens: 0,
  totalCost: 0,
  tokensPerMinute: 0,
  costPerMinute: 0,
  avgDurationMs: 0,
  avgTtftMs: 0,
  avgTokensPerSec: 0,
  providers: [],
  recentRequests: []
};

const icons: Record<string, React.ReactNode> = {
  [STAT_LABELS.REQUESTS]: <Activity size={20} />,
  [STAT_LABELS.PROVIDERS]: <Server size={20} />,
  [STAT_LABELS.TOKENS]: <Database size={20} />,
  [STAT_LABELS.DURATION]: <Zap size={20} />
};

const getStatusTone = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === 'success') {
    return 'text-success bg-emerald-500/15 border border-success/25';
  }
  if (normalized === 'unknown') {
    return 'text-text-secondary bg-bg-hover border border-border-glass';
  }
  return 'text-danger bg-red-500/15 border border-danger/30';
};

export const LiveMetrics = () => {
  const [stats, setStats] = useState<Stat[]>([]);
  const [usageData, setUsageData] = useState<UsageData[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Just now');
  const [activityRange, setActivityRange] = useState<TimeRange>('day');
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveDashboardSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [providerPerformance, setProviderPerformance] = useState<ProviderPerformanceData[]>([]);
  const [todayMetrics, setTodayMetrics] = useState<TodayMetrics>({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalCost: 0
  });

  const liveRefreshTimerRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    const dashboardData = await api.getDashboardData(activityRange);
    setStats(dashboardData.stats.filter((stat) =>
      stat.label !== STAT_LABELS.PROVIDERS &&
      stat.label !== STAT_LABELS.DURATION
    ));
    setUsageData(dashboardData.usageData);
    setCooldowns(dashboardData.cooldowns);
    setTodayMetrics(dashboardData.todayMetrics);
    setLastUpdated(new Date());
  }, [activityRange]);

  const loadLiveData = useCallback(async () => {
    const [snapshot, performanceRows] = await Promise.all([
      api.getLiveDashboardSnapshot(LIVE_WINDOW_MINUTES, LIVE_REQUEST_LIMIT),
      api.getProviderPerformance(undefined, undefined, { excludeUnknownProvider: true })
    ]);

    setLiveSnapshot(snapshot);
    setProviderPerformance(performanceRows);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => {
      void loadData();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    void loadLiveData();
    const interval = window.setInterval(() => {
      void loadLiveData();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [loadLiveData]);

  useEffect(() => {
    setStreamConnected(true);

    // Create filtered subscription with enabled providers
    let unsubscribe = () => {};

    const setupSubscription = async () => {
      const enabledProviders = await api.getEnabledProviders();
      unsubscribe = api.subscribeToUsageEvents({
        onLog: () => {
          setStreamConnected(true);
          if (liveRefreshTimerRef.current !== null) {
            window.clearTimeout(liveRefreshTimerRef.current);
          }
          liveRefreshTimerRef.current = window.setTimeout(() => {
            void loadLiveData();
          }, 900);
        },
        onError: () => {
          setStreamConnected(false);
        }
      }, {
        excludeUnknownProvider: true,
        enabledProviders
      });
    };

    void setupSubscription();

    return () => {
      unsubscribe();
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
    };
  }, [loadLiveData]);

  useEffect(() => {
    const updateTime = () => {
      const diffSeconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      if (diffSeconds < 5) {
        setTimeAgo('Just now');
        return;
      }
      setTimeAgo(formatTimeAgo(diffSeconds));
    };

    updateTime();
    const interval = window.setInterval(updateTime, 10000);
    return () => window.clearInterval(interval);
  }, [lastUpdated]);

  const providerPerformanceByProvider = useMemo(() => {
    const totals = new Map<string, {
      ttftWeighted: number;
      tpsWeighted: number;
      samples: number;
    }>();

    for (const row of providerPerformance) {
      const key = row.provider || 'unknown';
      const weight = Math.max(1, Number(row.sample_count || 0));
      const current = totals.get(key) ?? { ttftWeighted: 0, tpsWeighted: 0, samples: 0 };

      current.samples += weight;
      current.ttftWeighted += Number(row.avg_ttft_ms || 0) * weight;
      current.tpsWeighted += Number(row.avg_tokens_per_sec || 0) * weight;
      totals.set(key, current);
    }

    const byProvider = new Map<string, { avgTtftMs: number; avgTokensPerSec: number }>();
    for (const [provider, metric] of totals.entries()) {
      const samples = Math.max(1, metric.samples);
      byProvider.set(provider, {
        avgTtftMs: metric.ttftWeighted / samples,
        avgTokensPerSec: metric.tpsWeighted / samples
      });
    }

    return byProvider;
  }, [providerPerformance]);

  const renderActivityTimeControls = () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      {(['hour', 'day', 'week', 'month'] as TimeRange[]).map((range) => (
        <Button
          key={range}
          size="sm"
          variant={activityRange === range ? 'primary' : 'secondary'}
          onClick={() => setActivityRange(range)}
          style={{ textTransform: 'capitalize' }}
        >
          {range}
        </Button>
      ))}
    </div>
  );

  const handleClearCooldowns = async () => {
    if (window.confirm('Are you sure you want to clear all provider cooldowns?')) {
      try {
        await api.clearCooldown();
        await loadData();
      } catch (_error) {
        window.alert('Failed to clear cooldowns');
      }
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="header-left">
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Live Metrics</h1>
          {cooldowns.length > 0 ? (
            <Badge status="warning" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>
              System Degraded
            </Badge>
          ) : (
            <Badge status="connected" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>
              System Online
            </Badge>
          )}
        </div>

        <Badge
          status={streamConnected ? 'connected' : 'warning'}
          secondaryText={`Window: last ${LIVE_WINDOW_MINUTES}m`}
          style={{ minWidth: '190px' }}
        >
          {streamConnected ? 'Live Stream Active' : 'Live Stream Reconnecting'}
        </Badge>
      </div>

      <div className="mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        {stats.map((stat, index) => (
          <div key={`${stat.label}-${index}`} className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">{stat.label}</span>
              <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{ background: 'var(--color-bg-hover)' }}>
                {icons[stat.label] || <Activity size={20} />}
              </div>
            </div>
            <div className="font-heading text-3xl font-bold text-text my-1">{stat.value}</div>
            {stat.change !== undefined && (
              <div className={`text-sm leading-normal ${stat.change > 0 ? 'text-success' : 'text-danger'}`}>
                {stat.change > 0 ? '+' : ''}{stat.change}% from last week
              </div>
            )}
          </div>
        ))}

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Requests Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{ background: 'var(--color-bg-hover)' }}>
              <Activity size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatNumber(todayMetrics.requests, 0)}</div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Tokens Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{ background: 'var(--color-bg-hover)' }}>
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatTokens(todayMetrics.inputTokens + todayMetrics.outputTokens + todayMetrics.reasoningTokens + todayMetrics.cachedTokens)}
          </div>
          <div className="text-xs text-text-muted space-y-0.5">
            <div>In: {formatTokens(todayMetrics.inputTokens)}</div>
            <div>Out: {formatTokens(todayMetrics.outputTokens)}</div>
            {todayMetrics.reasoningTokens > 0 && <div>Reasoning: {formatTokens(todayMetrics.reasoningTokens)}</div>}
            {todayMetrics.cachedTokens > 0 && <div>Cached: {formatTokens(todayMetrics.cachedTokens)}</div>}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Cost Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{ background: 'var(--color-bg-hover)' }}>
              <Zap size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatCost(todayMetrics.totalCost, 4)}</div>
        </div>
      </div>

      <div className="mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Requests ({LIVE_WINDOW_MINUTES}m)</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatNumber(liveSnapshot.requestCount, 0)}</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Success Rate</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{(liveSnapshot.successRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-text-muted mt-1">{liveSnapshot.successCount} success / {liveSnapshot.errorCount} errors</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Tokens / Min</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatTokens(liveSnapshot.tokensPerMinute)}</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Cost / Min</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatCost(liveSnapshot.costPerMinute, 6)}</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Avg Latency</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatMs(liveSnapshot.avgDurationMs)}</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Avg TTFT / Throughput</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatMs(liveSnapshot.avgTtftMs)}</div>
          <div className="text-xs text-text-muted mt-1">{formatTPS(liveSnapshot.avgTokensPerSec)} tok/s</div>
        </div>
      </div>

      {cooldowns.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <Card
            title="Service Alerts"
            className="alert-card"
            style={{ borderColor: 'var(--color-warning)' }}
            extra={
              <button
                className="bg-transparent text-text border-0 hover:bg-amber-500/10 !py-1.5 !px-3.5 !text-xs"
                onClick={handleClearCooldowns}
                style={{ color: 'var(--color-warning)' }}
              >
                Clear All
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(() => {
                const groupedCooldowns = cooldowns.reduce((acc, cooldown) => {
                  const key = `${cooldown.provider}:${cooldown.model}`;
                  if (!acc[key]) {
                    acc[key] = [];
                  }
                  acc[key].push(cooldown);
                  return acc;
                }, {} as Record<string, Cooldown[]>);

                return Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
                  const [provider, model] = key.split(':');
                  const hasAccountId = modelCooldowns.some((cooldown) => cooldown.accountId);
                  const maxTime = Math.max(...modelCooldowns.map((cooldown) => cooldown.timeRemainingMs));
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
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'rgba(255, 171, 0, 0.1)', borderRadius: '4px' }}
                    >
                      <AlertTriangle size={16} color="var(--color-warning)" />
                      <span style={{ fontWeight: 500 }}>{provider}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{statusText}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-4 mb-4 flex-col lg:flex-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))' }}>
        <Card className="min-w-0" title="Live Timeline (Last 5 Minutes)" extra={<Clock size={16} className="text-primary" />}>
          {liveSnapshot.recentRequests.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              No requests in the last 5 minutes
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={(() => {
                    const buckets = new Map<string, { time: string; requests: number; tokens: number; errors: number }>();
                    const now = Date.now();
                    
                    for (let i = 4; i >= 0; i--) {
                      const bucketTime = new Date(now - i * 60000);
                      const timeKey = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      buckets.set(timeKey, { time: timeKey, requests: 0, tokens: 0, errors: 0 });
                    }
                    
                    liveSnapshot.recentRequests.forEach((req) => {
                      const reqTime = new Date(req.date);
                      const timeKey = reqTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const bucket = buckets.get(timeKey);
                      if (bucket) {
                        bucket.requests += 1;
                        bucket.tokens += req.totalTokens;
                        if (req.responseStatus !== 'success') {
                          bucket.errors += 1;
                        }
                      }
                    });
                    
                    return Array.from(buckets.values());
                  })()}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2}/>
                    </linearGradient>
                    <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.2}/>
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
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                  />
                  <Area 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="requests" 
                    name="Requests"
                    stroke="#3b82f6" 
                    fillOpacity={1} 
                    fill="url(#colorRequests)" 
                    strokeWidth={2}
                  />
                  <Area 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="tokens" 
                    name="Tokens"
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorTokens)" 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="min-w-0" title="Request Velocity (Last 5 Minutes)" extra={<Signal size={16} className="text-primary" />}>
          {liveSnapshot.recentRequests.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              No velocity data available
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(() => {
                    const buckets = new Map<string, { time: string; velocity: number; errors: number }>();
                    const now = Date.now();
                    
                    for (let i = 4; i >= 0; i--) {
                      const bucketTime = new Date(now - i * 60000);
                      const timeKey = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      buckets.set(timeKey, { time: timeKey, velocity: 0, errors: 0 });
                    }
                    
                    liveSnapshot.recentRequests.forEach((req) => {
                      const reqTime = new Date(req.date);
                      const timeKey = reqTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const bucket = buckets.get(timeKey);
                      if (bucket) {
                        bucket.velocity += 1;
                        if (req.responseStatus !== 'success') {
                          bucket.errors += 1;
                        }
                      }
                    });
                    
                    let prevCount = 0;
                    return Array.from(buckets.values()).map((b, i) => {
                      const velocity = i === 0 ? b.velocity : b.velocity - prevCount;
                      prevCount = b.velocity;
                      return { ...b, velocity: Math.max(0, velocity) };
                    });
                  })()}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
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
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="velocity" 
                    name="Requests/min"
                    stroke="#8b5cf6" 
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#8b5cf6' }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="errors" 
                    name="Errors"
                    stroke="#ef4444" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 3, fill: '#ef4444' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
        <Card
          title={`Provider Pulse (${LIVE_WINDOW_MINUTES}m)`}
          extra={<Signal size={16} className={streamConnected ? 'text-success' : 'text-warning'} />}
        >
          {liveSnapshot.providers.length === 0 ? (
            <div className="py-8 text-sm text-text-secondary">No provider traffic in the selected live window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-text-secondary border-b border-border-glass">
                    <th className="py-2 pr-2">Provider</th>
                    <th className="py-2 pr-2">Req</th>
                    <th className="py-2 pr-2">Success</th>
                    <th className="py-2 pr-2">Tokens</th>
                    <th className="py-2 pr-2">Cost</th>
                    <th className="py-2 pr-2">Avg Latency</th>
                    <th className="py-2 pr-2">Perf</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSnapshot.providers.slice(0, 8).map((provider) => {
                    const perf = providerPerformanceByProvider.get(provider.provider);
                    return (
                      <tr key={provider.provider} className="border-b border-border-glass/60">
                        <td className="py-2 pr-2 text-text font-medium">{provider.provider}</td>
                        <td className="py-2 pr-2 text-text-secondary">{formatNumber(provider.requests, 0)}</td>
                        <td className="py-2 pr-2 text-text-secondary">{(provider.successRate * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-2 text-text-secondary">{formatTokens(provider.totalTokens)}</td>
                        <td className="py-2 pr-2 text-text-secondary">{formatCost(provider.totalCost, 6)}</td>
                        <td className="py-2 pr-2 text-text-secondary">{formatMs(provider.avgDurationMs)}</td>
                        <td className="py-2 pr-2 text-text-secondary">
                          {perf
                            ? `${formatTPS(perf.avgTokensPerSec)} tok/s · ${formatMs(perf.avgTtftMs)}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Live Request Stream" extra={<span className="text-xs text-text-secondary">Latest 20</span>}>
          {liveSnapshot.recentRequests.length === 0 ? (
            <div className="py-8 text-sm text-text-secondary">No requests observed yet.</div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {liveSnapshot.recentRequests.map((request) => (
                <div key={request.requestId} className="rounded-md border border-border-glass bg-bg-glass p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-text font-medium">{request.provider}</span>
                      <span className="text-xs text-text-secondary">{request.model}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-md ${getStatusTone(request.responseStatus)}`}>
                        {request.responseStatus}
                      </span>
                    </div>
                    <span className="text-xs text-text-muted">{formatTimeAgo(Math.max(0, Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)))}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                    <span>Tokens: {formatTokens(request.totalTokens)}</span>
                    <span>Cost: {formatCost(request.costTotal, 6)}</span>
                    <span>Latency: {formatMs(request.durationMs)}</span>
                    <span>TTFT: {formatMs(request.ttftMs)}</span>
                    <span>TPS: {formatTPS(request.tokensPerSec)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
