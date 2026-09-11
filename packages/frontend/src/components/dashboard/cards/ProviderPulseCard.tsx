/**
 * @file ProviderPulseCard.tsx
 *
 * Draggable card rendering a BarChart of top providers ranked by request count.
 */

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SortableCard } from '../../ui/SortableCard';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { formatNumber } from '../../../lib/format';

export interface ProviderPulseCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  providerPulseRows: { label: string; requests: number; successRate: number }[];
}

export const ProviderPulseCard: React.FC<ProviderPulseCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  providerPulseRows,
}) => {
  return (
    <SortableCard
      key="sortable-provider"
      card={{
        id: 'provider',
        title: 'Provider Pulse (5m)',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-text-secondary">Top 8 providers</span>
            <AnalyzeButton cardType="provider" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content:
          providerPulseRows.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
              No provider traffic in the selected live window.
            </div>
          ) : (
            <div className="h-48 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={providerPulseRows.slice(0, 6)}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis
                    dataKey="label"
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={56}
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
                    formatter={(value) => [formatNumber(Number(value || 0), 0), 'Requests']}
                  />
                  <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
