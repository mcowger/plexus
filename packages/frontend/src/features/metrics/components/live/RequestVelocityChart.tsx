import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import type { LiveRequestSnapshot } from '../../../../lib/api';

interface VelocityDataPoint {
  time: string;
  velocity: number;
  errors: number;
}

interface RequestVelocityChartProps {
  recentRequests: LiveRequestSnapshot[];
  windowMinutes?: number;
}

export const RequestVelocityChart: React.FC<RequestVelocityChartProps> = ({
  recentRequests,
  windowMinutes = 5
}) => {
  const data: VelocityDataPoint[] = React.useMemo(() => {
    const buckets = new Map<string, { time: string; count: number; errors: number }>();
    const now = Date.now();

    // Initialize buckets
    for (let i = windowMinutes - 1; i >= 0; i--) {
      const bucketTime = new Date(now - i * 60000);
      const timeKey = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets.set(timeKey, { time: timeKey, count: 0, errors: 0 });
    }

    // Fill buckets
    recentRequests.forEach((req) => {
      const reqTime = new Date(req.date);
      const timeKey = reqTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const bucket = buckets.get(timeKey);
      if (bucket) {
        bucket.count += 1;
        if (req.responseStatus !== 'success') {
          bucket.errors += 1;
        }
      }
    });

    // Calculate velocity (requests per minute)
    let prevCount = 0;
    return Array.from(buckets.values()).map((b, i) => {
      const velocity = i === 0 ? b.count : b.count - prevCount;
      prevCount = b.count;
      return { time: b.time, velocity: Math.max(0, velocity), errors: b.errors };
    });
  }, [recentRequests, windowMinutes]);

  if (recentRequests.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-text-secondary">
        No velocity data available
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
              borderRadius: '8px'
            }}
            labelStyle={{ color: 'var(--color-text)' }}
          />
          <Line
            type="monotone"
            dataKey="velocity"
            name="Requests/min"
            stroke="#8b5cf6"
            strokeWidth={3}
            dot={{ r: 4, fill: '#8b5cf6' }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="errors"
            name="Errors"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ r: 3, fill: '#ef4444' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
