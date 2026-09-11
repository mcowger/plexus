/**
 * @file ConcurrencyCard.tsx
 *
 * Draggable card rendering active in-flight request counts per provider,
 * with an AreaChart of concurrency history.
 */

import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SortableCard } from '../../ui/SortableCard';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { formatNumber } from '../../../lib/format';
import { CONCURRENCY_COLORS } from '../liveTypes';

export interface ConcurrencyCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  concurrencyLoading: boolean;
  concurrencyHistory: Record<string, unknown>[];
  totalConcurrentRequests: number;
  concurrencyProviders: string[];
}

export const ConcurrencyCard: React.FC<ConcurrencyCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  concurrencyLoading,
  concurrencyHistory,
  totalConcurrentRequests,
  concurrencyProviders,
}) => {
  return (
    <SortableCard
      key="sortable-concurrency"
      card={{
        id: 'concurrency',
        title: 'Concurrency',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-text-muted">
              <span className="sm:hidden">10s</span>
              <span className="hidden sm:inline">Auto-refresh: 10s</span>
            </span>
            <AnalyzeButton cardType="concurrency" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content:
          concurrencyLoading && concurrencyHistory.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary text-sm">
              Loading concurrency data...
            </div>
          ) : concurrencyHistory.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary text-sm">
              Collecting concurrency data...
            </div>
          ) : (
            <div className="h-48 sm:h-56">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">In-Flight by Provider</span>
                <span className="text-sm font-semibold text-text tabular-nums">
                  {formatNumber(totalConcurrentRequests, 0)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height="85%">
                <AreaChart
                  data={concurrencyHistory}
                  margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                  <YAxis stroke="var(--color-text-secondary)" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  />
                  {concurrencyProviders.map((provider, idx) => (
                    <Area
                      key={provider}
                      type="monotone"
                      dataKey={provider}
                      stackId="1"
                      stroke={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                      fill={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
