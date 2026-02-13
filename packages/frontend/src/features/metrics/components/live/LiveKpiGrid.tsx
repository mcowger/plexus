import React from 'react';
import { Activity, Database, Zap } from 'lucide-react';
import type { TodayMetrics, Stat } from '../../../../lib/api';
import { formatNumber, formatTokens, formatCost } from '../../../../lib/format';

interface LiveKpiGridProps {
  stats: Stat[];
  todayMetrics: TodayMetrics;
  liveSnapshot: {
    requestCount: number;
    successRate: number;
    successCount: number;
    errorCount: number;
    tokensPerMinute: number;
    costPerMinute: number;
    avgDurationMs: number;
    avgTtftMs: number;
    avgTokensPerSec: number;
  };
  windowMinutes: number;
}

const STAT_ICENS: Record<string, React.ReactNode> = {
  'Total Requests': <Activity size={20} />,
  'Active Providers': <Database size={20} />,
  'Total Tokens': <Database size={20} />,
  'Avg Duration': <Zap size={20} />,
};

export const LiveKpiGrid: React.FC<LiveKpiGridProps> = ({
  stats,
  todayMetrics,
  liveSnapshot,
  windowMinutes
}) => {
  return (
    <div className="space-y-6">
      {/* Today Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        {stats.map((stat, index) => (
          <div key={`${stat.label}-${index}`} className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">{stat.label}</span>
              <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{ background: 'var(--color-bg-hover)' }}>
                {STAT_ICENS[stat.label] || <Activity size={20} />}
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

      {/* Live Window Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Requests ({windowMinutes}m)</div>
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
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatNumber(liveSnapshot.avgDurationMs, 0)}ms</div>
        </div>
        <div className="glass-bg rounded-lg p-4 transition-all duration-300">
          <div className="text-xs text-text-muted uppercase tracking-wider">Avg TTFT / Throughput</div>
          <div className="text-2xl font-heading font-bold text-text mt-1">{formatNumber(liveSnapshot.avgTtftMs, 0)}ms</div>
          <div className="text-xs text-text-muted mt-1">{formatNumber(liveSnapshot.avgTokensPerSec, 1)} tok/s</div>
        </div>
      </div>
    </div>
  );
};
