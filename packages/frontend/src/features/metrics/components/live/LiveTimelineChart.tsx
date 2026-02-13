import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import type { LiveRequestSnapshot } from '../../../../lib/api';

interface TimelineDataPoint {
  time: string;
  requests: number;
  tokens: number;
  errors: number;
}

interface LiveTimelineChartProps {
  recentRequests: LiveRequestSnapshot[];
  windowMinutes?: number;
}

export const LiveTimelineChart: React.FC<LiveTimelineChartProps> = ({
  recentRequests,
  windowMinutes = 5
}) => {
  const data: TimelineDataPoint[] = React.useMemo(() => {
    const buckets = new Map<string, TimelineDataPoint>();
    const now = Date.now();

    // Initialize buckets for the last windowMinutes
    for (let i = windowMinutes - 1; i >= 0; i--) {
      const bucketTime = new Date(now - i * 60000);
      const timeKey = bucketTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      buckets.set(timeKey, { time: timeKey, requests: 0, tokens: 0, errors: 0 });
    }

    // Fill buckets with actual data
    recentRequests.forEach((req) => {
      const reqTime = new Date(req.date);
      const timeKey = reqTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const bucket = buckets.get(timeKey);
      if (bucket) {
        bucket.requests += 1;
        bucket.tokens += req.totalTokens;
        if (req.responseStatus !== 'success') {
          bucket.errors += 1;
        }
      }
    });

    return Array.from(buckets.values());
  }, [recentRequests, windowMinutes]);

  if (recentRequests.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-text-secondary">
        No requests in the last {windowMinutes} minutes
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2}/>
            </linearGradient>
            <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.2}/>
            </linearGradient>
          </defs>
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
          />
          <YAxis
            yAxisId="right"
            orientation="right"
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
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#colorRequests)"
            strokeWidth={2}
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="tokens"
            name="Tokens"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#colorTokens)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
