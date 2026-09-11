/**
 * @file ModelTimelineModal.tsx
 *
 * Full-height ComposedChart view with stacked bars (model counts)
 * and line overlays (avg TTFT, avg TPS).
 */

import React from 'react';
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
import { formatMs, formatNumber, formatTPS } from '../../../lib/format';
import type { ModelTimelineBucket, ModelTimelineSeries } from '../liveTypes';

export interface ModelTimelineModalProps {
  modelTimeline: {
    series: ModelTimelineSeries[];
    seriesLabelMap: Map<string, string>;
    data: ModelTimelineBucket[];
  };
}

export const ModelTimelineModal: React.FC<ModelTimelineModalProps> = ({ modelTimeline }) => {
  return (
    <div className="h-[70vh]">
      {modelTimeline.series.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-secondary">
          No model stack data in the selected live window.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={modelTimeline.data}
            margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
            <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
            <YAxis yAxisId="left" stroke="var(--color-text-secondary)" />
            <YAxis yAxisId="right" orientation="right" stroke="var(--color-text-secondary)" />
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
      )}
    </div>
  );
};
