/**
 * @file TimelineModal.tsx
 *
 * Full-height dual-axis AreaChart view with requests+errors (left) and tokens (right).
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
import type { MinuteBucket } from '../liveTypes';

export interface TimelineModalProps {
  minuteSeries: MinuteBucket[];
}

export const TimelineModal: React.FC<TimelineModalProps> = ({ minuteSeries }) => {
  return (
    <div className="h-[60vh]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={minuteSeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="liveRequestsModal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="liveTokensModal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
            </linearGradient>
          </defs>
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
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="requests"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#liveRequestsModal)"
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
            fill="url(#liveTokensModal)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
