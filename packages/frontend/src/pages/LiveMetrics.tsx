import { useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { api, STAT_LABELS } from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTimeAgo, formatTokens, formatTPS } from '../lib/format';
import { Activity, AlertTriangle, Database, Server, Signal, Zap, Clock, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/shadcn-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/shadcn-table';
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
import { useMetricsStream } from '../features/metrics/hooks/useMetricsStream';
import type { LiveDashboardSnapshot } from '../lib/api';

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

/**
 * Connection status indicator component
 */
const ConnectionIndicator = ({
  status,
  isStale,
  onReconnect
}: {
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  isStale: boolean;
  onReconnect: () => void;
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return isStale
          ? { icon: <Wifi size={14} />, text: 'Stale', color: 'text-warning' }
          : { icon: <Wifi size={14} />, text: 'Live', color: 'text-success' };
      case 'connecting':
        return { icon: <RefreshCw size={14} className="animate-spin" />, text: 'Connecting...', color: 'text-text-muted' };
      case 'reconnecting':
        return { icon: <RefreshCw size={14} className="animate-spin" />, text: 'Reconnecting...', color: 'text-warning' };
      case 'error':
      case 'disconnected':
        return { icon: <WifiOff size={14} />, text: 'Disconnected', color: 'text-danger' };
      default:
        return { icon: <Wifi size={14} />, text: 'Unknown', color: 'text-text-muted' };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1.5 text-xs ${config.color}`}>
        {config.icon}
        {config.text}
      </span>
      {(status === 'error' || status === 'disconnected') && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReconnect}
        >
          Reconnect
        </Button>
      )}
    </div>
  );
};

export const LiveMetrics = () => {
  // Use unified SSE hook instead of individual polling hooks
  const {
    dashboardData,
    liveSnapshot: sseLiveSnapshot,
    providerPerformance,
    cooldowns,
    connectionStatus,
    lastEventTime,
    isStale,
    reconnect
  } = useMetricsStream({
    autoConnect: true,
    reconnectDelay: 3000,
    maxReconnectAttempts: 5,
    staleThreshold: 60000,
    liveWindowMinutes: LIVE_WINDOW_MINUTES,
    liveRequestLimit: LIVE_REQUEST_LIMIT
  });

  // Use live snapshot from SSE or empty state
  const liveSnapshot = sseLiveSnapshot ?? EMPTY_LIVE_SNAPSHOT;

  // Compute time ago from last event
  const timeAgo = useMemo(() => {
    if (!lastEventTime) return 'Just now';
    const diff = Math.floor((Date.now() - lastEventTime) / 1000);
    if (diff < 5) return 'Just now';
    return formatTimeAgo(diff);
  }, [lastEventTime]);

  // Get stats from dashboard data or use defaults
  const stats = useMemo(() => {
    return dashboardData?.stats.filter((stat) =>
      stat.label !== STAT_LABELS.PROVIDERS &&
      stat.label !== STAT_LABELS.DURATION
    ) ?? [];
  }, [dashboardData?.stats]);

  // Get today metrics from dashboard data or use defaults
  const todayMetrics = dashboardData?.todayMetrics ?? {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalCost: 0
  };

  const providerPerformanceByProvider = useMemo(() => {
    const byProvider = new Map<string, { avgTtftMs: number; avgTokensPerSec: number }>();

    for (const row of providerPerformance) {
      const provider = row.provider || 'unknown';
      const existing = byProvider.get(provider);

      if (existing) {
        // Weighted average update
        const samples = Math.max(1, row.sample_count || 1);
        existing.avgTtftMs = (existing.avgTtftMs + (row.avg_ttft_ms || 0) * samples) / (samples + 1);
        existing.avgTokensPerSec = (existing.avgTokensPerSec + (row.avg_tokens_per_sec || 0) * samples) / (samples + 1);
      } else {
        byProvider.set(provider, {
          avgTtftMs: row.avg_ttft_ms || 0,
          avgTokensPerSec: row.avg_tokens_per_sec || 0
        });
      }
    }

    return byProvider;
  }, [providerPerformance]);


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

        <div className="flex flex-col items-end gap-2">
          <Badge
            status={connectionStatus === 'connected' && !isStale ? 'connected' : 'warning'}
            secondaryText={`Window: last ${LIVE_WINDOW_MINUTES}m`}
            style={{ minWidth: '190px' }}
          >
            {connectionStatus === 'connected' && !isStale ? 'Live Stream Active' : 'Stream Reconnecting'}
          </Badge>
          <ConnectionIndicator
            status={connectionStatus}
            isStale={isStale}
            onReconnect={reconnect}
          />
        </div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearCooldowns}
              >
                Clear All
              </Button>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Req</TableHead>
                    <TableHead>Success</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Avg Latency</TableHead>
                    <TableHead>Perf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveSnapshot.providers.slice(0, 8).map((provider) => {
                    const perf = providerPerformanceByProvider.get(provider.provider);
                    return (
                      <TableRow key={provider.provider}>
                        <TableCell className="font-medium">{provider.provider}</TableCell>
                        <TableCell>{formatNumber(provider.requests, 0)}</TableCell>
                        <TableCell>{(provider.successRate * 100).toFixed(1)}%</TableCell>
                        <TableCell>{formatTokens(provider.totalTokens)}</TableCell>
                        <TableCell>{formatCost(provider.totalCost, 6)}</TableCell>
                        <TableCell>{formatMs(provider.avgDurationMs)}</TableCell>
                        <TableCell>
                          {perf
                            ? `${formatTPS(perf.avgTokensPerSec)} tok/s · ${formatMs(perf.avgTtftMs)}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
