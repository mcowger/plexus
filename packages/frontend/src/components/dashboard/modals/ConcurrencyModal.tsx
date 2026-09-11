/**
 * @file ConcurrencyModal.tsx
 *
 * Full-height view with total in-flight metric and stacked AreaChart of concurrency history.
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
import { formatNumber } from '../../../lib/format';
import { CONCURRENCY_COLORS } from '../liveTypes';

export interface ConcurrencyModalProps {
  concurrencyHistory: Record<string, unknown>[];
  totalConcurrentRequests: number;
  concurrencyProviders: string[];
}

export const ConcurrencyModal: React.FC<ConcurrencyModalProps> = ({
  concurrencyHistory,
  totalConcurrentRequests,
  concurrencyProviders,
}) => {
  return (
    <div className="h-[60vh]">
      {concurrencyHistory.length === 0 ? (
        <div className="flex items-center justify-center h-full text-text-secondary">
          Collecting concurrency data...
        </div>
      ) : (
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between p-4 bg-bg-subtle rounded-lg mb-4">
            <span className="text-sm text-text-muted">Current In-Flight</span>
            <span className="text-2xl font-semibold text-text tabular-nums">
              {formatNumber(totalConcurrentRequests, 0)}
            </span>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
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
        </div>
      )}
    </div>
  );
};
