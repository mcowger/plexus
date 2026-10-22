/**
 * @file MetricsCard.tsx
 *
 * Draggable card showing overview statistics (total requests, total tokens,
 * requests/cost today) and rolling live window stats.
 */

import { Signal } from 'lucide-react';
import React from 'react';

import type { TodayMetrics } from '../../../lib/api';
import { useCurrency } from '../../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatNumber, formatTokens } from '../../../lib/format';
import { SortableCard } from '../../ui/SortableCard';

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
            <span className="text-text-muted hidden text-[11px] sm:inline">
              Overview & Live Stats
            </span>
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content: (
          <div className="divide-border grid h-48 grid-cols-2 divide-x overflow-hidden sm:h-56">
            {/* Overview column */}
            <div className="divide-border divide-y">
              <div className="bg-bg-subtle/50 px-3 py-1.5">
                <span className="text-text-muted text-[11px] font-semibold tracking-wider uppercase">
                  Overview
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Total Requests</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {totalRequestsValue}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Total Tokens</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {totalTokensValue}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Requests Today</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {formatNumber(todayMetrics.requests, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Cost Today</span>
                <span className="text-info text-sm font-semibold tabular-nums">
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
            <div className="divide-border divide-y">
              <div className="bg-bg-subtle/50 px-3 py-1.5">
                <span className="text-text-muted text-[11px] font-semibold tracking-wider uppercase">
                  Live ({liveWindowMinutes}m)
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Requests</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {formatNumber(summary.requestCount, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Success Rate</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {successRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Tokens / Min</span>
                <span className="text-text text-sm font-semibold tabular-nums">
                  {formatTokens(tokensPerMinute)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-text-muted text-xs">Avg Latency</span>
                <span className="text-text text-sm font-semibold tabular-nums">
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
