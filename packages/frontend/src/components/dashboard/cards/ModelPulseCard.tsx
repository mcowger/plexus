/**
 * @file ModelPulseCard.tsx
 *
 * Draggable card rendering a BarChart of top models ranked by request count.
 */

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SortableCard } from '../../ui/SortableCard';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { formatNumber } from '../../../lib/format';

export interface ModelPulseCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  modelPulseRows: { label: string; requests: number; successRate: number }[];
}

export const ModelPulseCard: React.FC<ModelPulseCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  modelPulseRows,
}) => {
  return (
    <SortableCard
      key="sortable-model"
      card={{
        id: 'model',
        title: 'Model Pulse (5m)',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-text-secondary">Top 8 models</span>
            <AnalyzeButton cardType="model" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content:
          modelPulseRows.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
              No model traffic in the selected live window.
            </div>
          ) : (
            <div className="h-48 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={modelPulseRows.slice(0, 6)}
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
                  <Bar dataKey="requests" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
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
