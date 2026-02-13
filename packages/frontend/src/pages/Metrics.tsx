import { useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import {
  AnimatedGauge,
  RPMGauge,
  DigitalCounter,
  Spinner,
  ProviderHealthCard
} from '../features/metrics/components/metrics';
import { useMetricsStream } from '../features/metrics/hooks/useMetricsStream';
import { formatCost, formatMs, formatTokens, formatTimeAgo } from '../lib/format';
import { AlertTriangle, Gauge, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/shadcn-button';

const LIVE_WINDOW_MINUTES = 5;
const LIVE_REQUEST_LIMIT = 1200;

// Empty live snapshot for initial state
const EMPTY_LIVE_SNAPSHOT = {
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

export const Metrics = () => {
  // Use unified SSE hook instead of individual polling hooks
  const {
    liveSnapshot,
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

  // Use live snapshot or empty state
  const snapshot = liveSnapshot ?? EMPTY_LIVE_SNAPSHOT;

  // Compute time ago from last event
  const timeAgo = useMemo(() => {
    if (!lastEventTime) return 'Never';
    const diff = Math.floor((Date.now() - lastEventTime) / 1000);
    return formatTimeAgo(diff);
  }, [lastEventTime]);

  const topProviders = useMemo(() => {
    return [...(snapshot.providers || [])]
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 6);
  }, [snapshot.providers]);

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2 flex items-center gap-3">
            <Gauge size={32} className="text-primary" />
            Metrics Dashboard
          </h1>
          <div className="flex flex-col gap-2">
            <Badge status="connected" secondaryText={`Last updated: ${timeAgo}`}>
              Live Data
            </Badge>
            <ConnectionIndicator
              status={connectionStatus}
              isStale={isStale}
              onReconnect={reconnect}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2 p-6">
          <div className="flex flex-wrap items-center justify-around gap-8">
            <AnimatedGauge
              value={snapshot.tokensPerMinute}
              max={1000}
              label="Tokens / Minute"
              unit=""
            />
            <AnimatedGauge
              value={snapshot.requestCount / LIVE_WINDOW_MINUTES}
              max={100}
              label="Requests / Minute"
              unit=""
            />
            <div className="flex flex-col items-center">
              <Spinner
                value={snapshot.successRate * 100}
                max={100}
                size={140}
              />
              <div className="text-center mt-4">
                <div className="text-2xl font-bold">{(snapshot.successRate * 100).toFixed(1)}%</div>
                <div className="text-sm text-text-muted">Success Rate</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <RPMGauge
            value={snapshot.tokensPerMinute}
            label="RPM"
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <Card className="p-6 flex flex-col items-center justify-center">
          <DigitalCounter
            value={snapshot.requestCount}
            label="Total Requests"
            color="#3b82f6"
          />
        </Card>

        <Card className="p-6 flex flex-col items-center justify-center">
          <DigitalCounter
            value={snapshot.totalTokens}
            label="Total Tokens"
            color="#10b981"
          />
        </Card>

        <Card className="p-6 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="text-4xl font-bold text-text mb-2">
              {formatCost(snapshot.totalCost, 4)}
            </div>
            <div className="text-sm text-text-muted uppercase tracking-wider">Total Cost</div>
          </div>
        </Card>

        <Card className="p-6 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="text-4xl font-bold text-text mb-2">
              {formatMs(snapshot.avgDurationMs)}
            </div>
            <div className="text-sm text-text-muted uppercase tracking-wider">Avg Latency</div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card title="Provider Performance">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {topProviders.map((provider) => {
              const perf = providerPerformance.find(p => p.provider === provider.provider);
              return (
                <ProviderHealthCard
                  key={provider.provider}
                  provider={provider.provider}
                  requests={provider.requests}
                  errors={provider.errors}
                  avgTokensPerSec={perf?.avg_tokens_per_sec || 0}
                />
              );
            })}
            {topProviders.length === 0 && (
              <div className="col-span-full text-text-secondary text-center py-8">
                No provider data available
              </div>
            )}
          </div>
        </Card>

        <Card title="Live Request Stream">
          {snapshot.recentRequests.length === 0 ? (
            <div className="py-8 text-sm text-text-secondary text-center">
              No requests observed yet
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {snapshot.recentRequests.slice(0, 10).map((request) => (
                <div key={request.requestId} className="flex items-center gap-4 p-3 rounded-lg bg-bg-glass border border-border-glass">
                  <div className={`w-2 h-2 rounded-full ${request.responseStatus === 'success' ? 'bg-success' : 'bg-danger'}`} />
                  <span className="font-medium text-text">{request.provider}</span>
                  <span className="text-text-secondary text-sm">{request.model}</span>
                  <span className="text-text-muted text-sm ml-auto">{formatTokens(request.totalTokens)}</span>
                  <span className="text-text-muted text-sm">{formatMs(request.durationMs)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {cooldowns.length > 0 && (
        <Card
          title="Active Alerts"
          className="border-warning"
        >
          <div className="space-y-2">
            {cooldowns.slice(0, 5).map((cooldown, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-3 rounded-lg bg-warning/10"
              >
                <AlertTriangle size={16} className="text-warning" />
                <span className="font-medium">{cooldown.provider}</span>
                <span className="text-text-secondary">
                  {cooldown.model || 'all models'} on cooldown
                </span>
                <span className="text-text-muted ml-auto">
                  {formatTimeAgo(Math.floor(cooldown.timeRemainingMs / 1000))}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
