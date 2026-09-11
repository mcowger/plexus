/**
 * @file TimelineCard.tsx
 *
 * Draggable card rendering an AreaChart of requests, errors, and tokens over time.
 */

import React from 'react';
import { Clock } from 'lucide-react';
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
import { formatNumber, formatTokens } from '../../../lib/format';
import type { MinuteBucket } from '../liveTypes';

export interface TimelineCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  loading: boolean;
  minuteSeries: MinuteBucket[];
  liveWindowMinutes: number;
}

export const TimelineCard: React.FC<TimelineCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  loading,
  minuteSeries,
  liveWindowMinutes,
}) => {
  return (
    <SortableCard
      key="sortable-timeline"
      card={{
        id: 'timeline',
        title: 'Live Timeline',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Clock size={16} className="text-primary" />
            <AnalyzeButton cardType="timeline" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'min-w-0 hover:shadow-lg hover:border-primary/30 transition-all',
        content: loading ? (
          <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
            Loading...
          </div>
        ) : minuteSeries.length === 0 ? (
          <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
            No requests in the last {liveWindowMinutes} minutes
          </div>
        ) : (
          <div className="h-48 sm:h-56">
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
        ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
