/**
 * @file ProviderPulseModal.tsx
 *
 * Full-height BarChart view of top providers by request count in the live window.
 */

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ProviderPulseModalProps {
  providerPulseRows: { label: string; requests: number; successRate: number }[];
}

export const ProviderPulseModal: React.FC<ProviderPulseModalProps> = ({ providerPulseRows }) => {
  return (
    <div className="h-[60vh]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={providerPulseRows.slice(0, 8)}
          margin={{ top: 10, right: 24, left: 0, bottom: 48 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
          <XAxis
            dataKey="label"
            stroke="var(--color-text-secondary)"
            angle={-20}
            textAnchor="end"
            height={56}
          />
          <YAxis stroke="var(--color-text-secondary)" />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
            }}
          />
          <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
