/**
 * @file VelocityModal.tsx
 *
 * Full-height LineChart view of minute-over-minute request rate deltas.
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

export interface VelocityModalProps {
  velocitySeries: { time: string; velocity: number }[];
}

export const VelocityModal: React.FC<VelocityModalProps> = ({ velocitySeries }) => {
  return (
    <div className="h-[60vh]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={velocitySeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
          <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
          <YAxis stroke="var(--color-text-secondary)" />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
            }}
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
  );
};
