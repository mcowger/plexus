import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import {
  api,
  type Cooldown,
  type LiveDashboardSnapshot,
  type ProviderPerformanceData,
} from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTimeAgo, formatTokens, formatTPS } from '../lib/format';
import { AlertTriangle, Gauge } from 'lucide-react';

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

const AnimatedGauge = ({ 
  value, 
  max, 
  label, 
  unit = ''
}: { 
  value: number; 
  max: number; 
  label: string; 
  unit?: string;
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const rotation = -135 + (percentage * 2.7);
  
  const getColor = (pct: number) => {
    if (pct < 60) return '#10b981';
    if (pct < 80) return '#f59e0b';
    return '#ef4444';
  };
  
  const activeColor = getColor(percentage);
  
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-40 h-28">
        <svg viewBox="0 0 160 100" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <path
            d="M 20 90 A 60 60 0 0 1 140 90"
            fill="none"
            stroke="#1f2937"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M 20 90 A 60 60 0 0 1 140 90"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${percentage * 1.88} 188`}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div 
          className="absolute bottom-2 left-1/2 w-1 h-16 origin-bottom transition-transform duration-1000 ease-out"
          style={{ 
            transform: `translateX(-50%) rotate(${rotation}deg)`,
            background: `linear-gradient(to top, ${activeColor}, white)`
          }}
        />
        <div className="absolute bottom-1 left-1/2 w-4 h-4 bg-white rounded-full transform -translate-x-1/2 shadow-lg" />
      </div>
      <div className="text-center -mt-4">
        <div className="text-3xl font-bold" style={{ color: activeColor }}>
          {value.toFixed(1)}<span className="text-lg">{unit}</span>
        </div>
        <div className="text-sm text-text-muted uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
};

const RPMGauge = ({ 
  value,
  label = "RPM"
}: { 
  value: number;
  label?: string;
}) => {
  const maxRPM = 8000;
  const percentage = Math.min(100, Math.max(0, (value / maxRPM) * 100));
  
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-48 h-48">
        <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full animate-spin-slow">
          {[...Array(8)].map((_, i) => {
            const rotation = i * 45;
            const color = i < 5 ? '#10b981' : i < 7 ? '#f59e0b' : '#ef4444';
            return (
              <rect
                key={i}
                x="96"
                y="10"
                width="8"
                height="20"
                rx="2"
                fill={color}
                transform={`rotate(${rotation} 100 100)`}
                className={percentage > (i / 8) * 100 ? 'opacity-100' : 'opacity-20'}
              />
            );
          })}
        </svg>
        
        <div className="absolute inset-4 rounded-full bg-bg-card border-4 border-gray-700 flex flex-col items-center justify-center">
          <div className="text-5xl font-black text-text">{Math.round(value)}</div>
          <div className="text-sm text-text-muted">{label}</div>
          <div className="text-xs text-text-muted mt-1">x100 tokens/min</div>
        </div>
        
        <div 
          className="absolute top-2 left-1/2 w-4 h-4 rounded-full transform -translate-x-1/2 animate-pulse"
          style={{ 
            backgroundColor: percentage > 80 ? '#ef4444' : percentage > 60 ? '#f59e0b' : '#10b981',
            boxShadow: `0 0 20px ${percentage > 80 ? '#ef4444' : percentage > 60 ? '#f59e0b' : '#10b981'}`
          }}
        />
      </div>
    </div>
  );
};

const DigitalCounter = ({ 
  value, 
  label,
  color = '#3b82f6'
}: { 
  value: number; 
  label: string;
  color?: string;
}) => {
  const displayValue = value.toString().padStart(6, '0');
  
  return (
    <div className="flex flex-col items-center">
      <div 
        className="font-mono text-5xl font-black tracking-wider p-4 rounded-lg border-2"
        style={{ 
          color,
          borderColor: color,
          backgroundColor: `${color}10`,
          textShadow: `0 0 20px ${color}80`
        }}
      >
        {displayValue}
      </div>
      <div className="text-sm text-text-muted uppercase tracking-widest mt-2">{label}</div>
    </div>
  );
};

const Spinner = ({ value, max = 100, size = 120 }: { value: number; max?: number; size?: number }) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const circumference = 2 * Math.PI * ((size - 8) / 2);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - 8) / 2}
          fill="none"
          stroke="#1f2937"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - 8) / 2}
          fill="none"
          stroke="url(#spinnerGradient)"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient id="spinnerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold">{Math.round(percentage)}%</span>
      </div>
    </div>
  );
};

const ProviderHealthCard = ({ 
  provider, 
  requests, 
  errors,
  avgTokensPerSec
}: { 
  provider: string; 
  requests: number; 
  errors: number;
  avgTokensPerSec: number;
}) => {
  const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
  const isHealthy = errorRate < 5;
  
  return (
    <div className="bg-bg-glass rounded-lg p-4 border border-border-glass hover:border-primary/50 transition-all">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-3 h-3 rounded-full ${isHealthy ? 'bg-success animate-pulse' : 'bg-warning'}`} />
        <span className="font-semibold text-text">{provider}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-2xl font-bold text-text">{formatNumber(requests, 0)}</div>
          <div className="text-xs text-text-muted">requests</div>
        </div>
        <div>
          <div className="text-2xl font-bold" style={{ color: isHealthy ? '#10b981' : '#ef4444' }}>
            {formatTPS(avgTokensPerSec)}
          </div>
          <div className="text-xs text-text-muted">tok/s</div>
        </div>
      </div>
    </div>
  );
};

export const Metrics = () => {
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Just now');
  const [liveSnapshot, setLiveSnapshot] = useState<LiveDashboardSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [providerPerformance, setProviderPerformance] = useState<ProviderPerformanceData[]>([]);

  const loadLiveData = useCallback(async () => {
    const [snapshot, performanceRows] = await Promise.all([
      api.getLiveDashboardSnapshot(LIVE_WINDOW_MINUTES, LIVE_REQUEST_LIMIT),
      api.getProviderPerformance()
    ]);

    setLiveSnapshot(snapshot);
    setProviderPerformance(performanceRows);
    setLastUpdated(new Date());
  }, []);

  const loadData = useCallback(async () => {
    const dashboardData = await api.getDashboardData('day');
    setCooldowns(dashboardData.cooldowns);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    void loadData();
    void loadLiveData();
    
    const interval = window.setInterval(() => {
      void loadData();
      void loadLiveData();
    }, 10000);
    
    return () => window.clearInterval(interval);
  }, [loadData, loadLiveData]);

  useEffect(() => {
    const updateTime = () => {
      const diffSeconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      setTimeAgo(diffSeconds < 5 ? 'Just now' : formatTimeAgo(diffSeconds));
    };

    updateTime();
    const interval = window.setInterval(updateTime, 10000);
    return () => window.clearInterval(interval);
  }, [lastUpdated]);

  const providerPerformanceByProvider = useMemo(() => {
    const totals = new Map<string, { avgTokensPerSec: number }>();
    
    for (const row of providerPerformance) {
      const key = row.provider || 'unknown';
      totals.set(key, { avgTokensPerSec: Number(row.avg_tokens_per_sec || 0) });
    }
    
    return totals;
  }, [providerPerformance]);

  const topProviders = useMemo(() => {
    return [...(liveSnapshot.providers || [])]
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 6);
  }, [liveSnapshot.providers]);

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2 flex items-center gap-3">
            <Gauge size={32} className="text-primary" />
            Metrics Dashboard
          </h1>
          <div className="flex gap-2">
            <Badge status="connected" secondaryText={`Last updated: ${timeAgo}`}>
              Live Data
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2 p-6">
          <div className="flex flex-wrap items-center justify-around gap-8">
            <AnimatedGauge
              value={liveSnapshot.tokensPerMinute}
              max={1000}
              label="Tokens / Minute"
              unit=""
            />
            <AnimatedGauge
              value={liveSnapshot.requestCount / LIVE_WINDOW_MINUTES}
              max={100}
              label="Requests / Minute"
              unit=""
            />
            <div className="flex flex-col items-center">
              <Spinner 
                value={liveSnapshot.successRate * 100} 
                max={100}
                size={140}
              />
              <div className="text-center mt-4">
                <div className="text-2xl font-bold">{(liveSnapshot.successRate * 100).toFixed(1)}%</div>
                <div className="text-sm text-text-muted">Success Rate</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <RPMGauge 
            value={liveSnapshot.tokensPerMinute}
            label="RPM"
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <Card className="p-6 flex flex-col items-center justify-center">
          <DigitalCounter
            value={liveSnapshot.requestCount}
            label="Total Requests"
            color="#3b82f6"
          />
        </Card>
        
        <Card className="p-6 flex flex-col items-center justify-center">
          <DigitalCounter
            value={liveSnapshot.totalTokens}
            label="Total Tokens"
            color="#10b981"
          />
        </Card>
        
        <Card className="p-6 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="text-4xl font-bold text-text mb-2">
              {formatCost(liveSnapshot.totalCost, 4)}
            </div>
            <div className="text-sm text-text-muted uppercase tracking-wider">Total Cost</div>
          </div>
        </Card>
        
        <Card className="p-6 flex flex-col items-center justify-center">
          <div className="text-center">
            <div className="text-4xl font-bold text-text mb-2">
              {formatMs(liveSnapshot.avgDurationMs)}
            </div>
            <div className="text-sm text-text-muted uppercase tracking-wider">Avg Latency</div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card title="Provider Performance">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {topProviders.map((provider) => {
              const perf = providerPerformanceByProvider.get(provider.provider);
              return (
                <ProviderHealthCard
                  key={provider.provider}
                  provider={provider.provider}
                  requests={provider.requests}
                  errors={provider.errors}
                  avgTokensPerSec={perf?.avgTokensPerSec || 0}
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
          {liveSnapshot.recentRequests.length === 0 ? (
            <div className="py-8 text-sm text-text-secondary text-center">
              No requests observed yet
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {liveSnapshot.recentRequests.slice(0, 10).map((request) => (
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
