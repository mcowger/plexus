/**
 * @file MetricsCard.tsx
 *
 * Draggable card showing overview statistics (total requests, total tokens,
 * requests/cost today) and rolling live window stats.
 */

import React from 'react';
import { Signal } from 'lucide-react';
import { SortableCard } from '../../ui/SortableCard';
import { useCurrency } from '../../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../../lib/format';
import type { TodayMetrics } from '../../../lib/api';

export interface MetricsCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  totalRequestsValue: string | number;
  totalTokensValue: string | number;
  todayMetrics: TodayMetrics;
  liveWindowMinutes: number;
  summary: {
    requestCount: number;
  };
  successRate: number;
  tokensPerMinute: number;
  avgLatency: number;
}

export const MetricsCard: React.FC<MetricsCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  totalRequestsValue,
  totalTokensValue,
  todayMetrics,
  liveWindowMinutes,
  summary,
  successRate,
  tokensPerMinute,
  avgLatency,
}) => {
  const { currency, rate, symbol } = useCurrency();

  return (
    <SortableCard
      key="sortable-metrics"
      card={{
        id: 'metrics',
        title: 'Metrics',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Signal size={15} className="text-info" />
            <span className="hidden text-[11px] text-text-muted sm:inline">
              Overview & Live Stats
            </span>
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content: (
          <div className="h-48 sm:h-56 grid grid-cols-2 divide-x divide-border overflow-hidden">
            {/* Overview column */}
            <div className="divide-y divide-border">
              <div className="px-3 py-1.5 bg-bg-subtle/50">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Overview
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Total Requests</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {totalRequestsValue}
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Total Tokens</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {totalTokensValue}
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Requests Today</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {formatNumber(todayMetrics.requests, 0)}
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Cost Today</span>
                <span className="text-sm font-semibold text-info tabular-nums">
                  {formatCostIn(todayMetrics.totalCost, {
                    currency,
                    rate,
                    symbol,
                    decimals: 4,
                  })}
                </span>
              </div>
            </div>
            {/* Live Window column */}
            <div className="divide-y divide-border">
              <div className="px-3 py-1.5 bg-bg-subtle/50">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Live ({liveWindowMinutes}m)
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Requests</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {formatNumber(summary.requestCount, 0)}
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Success Rate</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {successRate.toFixed(1)}%
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Tokens / Min</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {formatTokens(tokensPerMinute)}
                </span>
              </div>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">Avg Latency</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {formatMs(avgLatency)}
                </span>
              </div>
            </div>
          </div>
        ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
