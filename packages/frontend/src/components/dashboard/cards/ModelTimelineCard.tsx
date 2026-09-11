/**
 * @file ModelTimelineCard.tsx
 *
 * Draggable card rendering a ComposedChart of model-stacked request bars
 * with avg TTFT and avg TPS lines.
 */

import React from 'react';
import { Clock } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SortableCard } from '../../ui/SortableCard';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { formatMs, formatNumber, formatTPS } from '../../../lib/format';
import type { ModelTimelineBucket, ModelTimelineSeries } from '../liveTypes';

export interface ModelTimelineCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  loading: boolean;
  modelTimeline: {
    series: ModelTimelineSeries[];
    seriesLabelMap: Map<string, string>;
    data: ModelTimelineBucket[];
  };
  liveWindowMinutes: number;
}

export const ModelTimelineCard: React.FC<ModelTimelineCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  loading,
  modelTimeline,
  liveWindowMinutes,
}) => {
  return (
    <SortableCard
      key="sortable-modelstack"
      card={{
        id: 'modelstack',
        title: 'Model Stack',
        extra: (
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            <AnalyzeButton cardType="modelstack" size="sm" onClick={onAnalyze} />
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'min-w-0 hover:shadow-lg hover:border-primary/30 transition-all',
        content: loading ? (
          <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
            Loading...
          </div>
        ) : modelTimeline.series.length === 0 ? (
          <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
            No model stack data in the last {liveWindowMinutes} minutes
          </div>
        ) : (
          <div className="h-48 sm:h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={modelTimeline.data}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
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
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--color-text-secondary)"
                  tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  tickFormatter={(value) => formatNumber(Number(value || 0), 1)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'var(--color-text)' }}
                  formatter={(value, name) => {
                    const numeric = Number(value || 0);
                    const label = modelTimeline.seriesLabelMap.get(String(name));
                    if (label) {
                      return [formatNumber(numeric, 0), label];
                    }

                    if (name === 'avgTtftMs') {
                      return [formatMs(numeric), 'Avg TTFT'];
                    }

                    if (name === 'avgTps') {
                      return [formatTPS(numeric), 'Avg TPS'];
                    }

                    return [formatNumber(numeric, 0), String(name)];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => modelTimeline.seriesLabelMap.get(String(value)) || value}
                />
                {modelTimeline.series.map((series) => (
                  <Bar
                    key={series.key}
                    yAxisId="left"
                    stackId="model-stack"
                    dataKey={series.key}
                    fill={series.color}
                  />
                ))}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgTtftMs"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgTps"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
