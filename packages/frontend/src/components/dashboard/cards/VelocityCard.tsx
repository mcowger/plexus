/**
 * @file VelocityCard.tsx
 *
 * Draggable card rendering a LineChart of minute-over-minute request velocity deltas.
 */

import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SortableCard } from '../../ui/SortableCard';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { formatNumber } from '../../../lib/format';

export interface VelocityCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  velocitySeries: { time: string; velocity: number }[];
}

export const VelocityCard: React.FC<VelocityCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  velocitySeries,
}) => {
  return (
    <SortableCard
      key="sortable-velocity"
      card={{
        id: 'velocity',
        title: 'Request Velocity (Last 5 Minutes)',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="hidden text-xs text-text-secondary sm:inline">
              Minute-over-minute delta
            </span>
            <AnalyzeButton cardType="velocity" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content:
          velocitySeries.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
              No velocity data available
            </div>
          ) : (
            <div className="h-48 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={velocitySeries}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
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
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                    formatter={(value) => [formatNumber(Number(value || 0), 0), 'Velocity']}
                  />
                  <Line
                    type="monotone"
                    dataKey="velocity"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
