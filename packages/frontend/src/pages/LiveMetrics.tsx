import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock, Database, Signal, Zap } from 'lucide-react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { api, type Cooldown, type UsageRecord } from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTimeAgo, formatTokens } from '../lib/format';

type MinuteBucket = {
  time: string;
  requests: number;
  errors: number;
  tokens: number;
};

const LIVE_WINDOW_MINUTES = 5;
const LIVE_WINDOW_MS = LIVE_WINDOW_MINUTES * 60 * 1000;
const POLL_INTERVAL_MS = 10000;
const RECENT_REQUEST_LIMIT = 200;

export const LiveMetrics = () => {
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [logs, setLogs] = useState<UsageRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState('Just now');
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [dashboardData, logData] = await Promise.all([
        api.getDashboardData('day'),
        api.getLogs(RECENT_REQUEST_LIMIT, 0),
      ]);
      setCooldowns(dashboardData.cooldowns);
      setLogs(logData.data || []);
      setLastUpdated(new Date());
      setIsConnected(true);
    } catch (e) {
      setIsConnected(false);
      console.error('Failed to load live metrics data', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
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
    return logs.filter((request) => {
      const requestTime = new Date(request.date).getTime();
      return Number.isFinite(requestTime) && requestTime >= cutoff;
    });
  }, [logs]);

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

  const successRate =
    summary.requestCount > 0 ? (summary.successCount / summary.requestCount) * 100 : 0;

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
          status={isConnected ? 'connected' : 'warning'}
          secondaryText={`Window: last ${LIVE_WINDOW_MINUTES}m`}
          style={{ minWidth: '210px' }}
        >
          {isConnected ? 'Live Polling Active' : 'Live Polling Reconnecting'}
        </Badge>
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
              Tokens ({LIVE_WINDOW_MINUTES}m)
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatTokens(summary.totalTokens)}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
              Cost ({LIVE_WINDOW_MINUTES}m)
            </span>
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <Zap size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">
            {formatCost(summary.totalCost, 6)}
          </div>
        </div>

      </div>

      {cooldowns.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <Card
            title="Service Alerts"
            className="alert-card"
            style={{ borderColor: 'var(--color-warning)' }}
            extra={
              <Button size="sm" variant="secondary" onClick={handleClearCooldowns}>
                Clear All
              </Button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {cooldowns.map((cooldown) => {
                const minutes = Math.ceil(cooldown.timeRemainingMs / 60000);
                const model = cooldown.model || 'all models';
                return (
                  <div
                    key={`${cooldown.provider}:${cooldown.model}:${cooldown.accountId || 'global'}`}
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
                    <span style={{ fontWeight: 500 }}>{cooldown.provider}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {model} is on cooldown for {minutes} minutes
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <div
        className="grid gap-4 mb-4 flex-col lg:flex-row"
        style={{ gridTemplateColumns: '1.2fr 1fr' }}
      >
        <Card
          className="min-w-0"
          title="Live Timeline"
          extra={<Clock size={16} className="text-primary" />}
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
            <div className="h-64">
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
          )}
        </Card>

        <Card
          title="Latest Requests"
          extra={<span className="text-xs text-text-secondary">Latest 20</span>}
        >
          {liveRequests.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-text-secondary">
              No requests in the last {LIVE_WINDOW_MINUTES} minutes
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {liveRequests.slice(0, 20).map((request) => {
                const requestTimeSeconds = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)
                );
                const status = request.responseStatus || 'unknown';
                const isSuccess = status.toLowerCase() === 'success';
                return (
                  <div
                    key={request.requestId}
                    className="rounded-md border border-border-glass bg-bg-glass p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text font-medium">
                          {request.provider || 'unknown'}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {request.selectedModelName || request.incomingModelAlias || 'unknown'}
                        </span>
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
