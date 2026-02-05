import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { UsageData } from '../../lib/api';
import { formatNumber, formatTokens } from '../../lib/format';

interface RecentActivityChartProps {
  data: UsageData[];
}

export const RecentActivityChart: React.FC<RecentActivityChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted italic p-8">
        No activity data available
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '300px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{
            top: 20,
            right: 20,
            bottom: 20,
            left: 20,
          }}
        >
          <CartesianGrid stroke="#f5f5f5" vertical={false} strokeOpacity={0.1} />
          <XAxis 
            dataKey="timestamp" 
            scale="point" 
            padding={{ left: 10, right: 10 }} 
            tick={{ fill: '#888', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis 
            yAxisId="left"
            tick={{ fill: '#888', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => formatNumber(value as number, 0)}
          />
          <YAxis 
            yAxisId="right" 
            orientation="right"
            tick={{ fill: '#888', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => formatTokens(value as number)}
          />
          <Tooltip 
            contentStyle={{ 
                backgroundColor: 'var(--color-bg-card)', 
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
            }}
            itemStyle={{ color: 'var(--color-text)' }}
          />
          <Legend />
          <Bar 
            yAxisId="left" 
            dataKey="requests" 
            barSize={20} 
            fill="#413ea0" 
            name="Requests" 
            radius={[4, 4, 0, 0]}
          />
          <Line 
            yAxisId="right" 
            type="monotone" 
            dataKey="tokens" 
            stroke="#ff7300" 
            name="Tokens" 
            dot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
