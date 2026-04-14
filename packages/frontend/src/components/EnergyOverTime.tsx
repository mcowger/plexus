/**
 * EnergyOverTime - Shows energy usage (kWh) over time as an area chart.
 * Similar to the "Requests over Time" and "Concurrency by Provider" charts.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { formatEnergy, formatTimeLabel } from '../lib/format';

/** kWh per hour for PS5 gaming (200W), used as a reference line on the chart. */
const PS5_KWH_PER_HOUR = 0.2;

interface EnergyOverTimeProps {
  /** Time-series data with kwhUsed values */
  data: Array<{
    timestamp: string;
    kwhUsed?: number;
  }>;
  /** Height of the chart container */
  height?: number;
  /** Show a PS5 (200W) reference line on the chart */
  showPs5Reference?: boolean;
}

export function EnergyOverTime({
  data,
  height = 300,
  showPs5Reference = true,
}: EnergyOverTimeProps) {
  // Filter out data points with no kwhUsed or zero values for cleaner display
  const chartData = data
    .filter((point) => point.kwhUsed !== undefined && point.kwhUsed > 0)
    .map((point) => ({
      ...point,
      label: formatTimeLabel(point.timestamp),
      kwh: point.kwhUsed || 0,
    }));

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-text-secondary text-sm"
        style={{ height }}
      >
        No energy data available
      </div>
    );
  }

  // Find max value for y-axis scaling
  const maxKwh = Math.max(...chartData.map((d) => d.kwh));
  const yAxisDomain = [0, maxKwh * 1.1]; // Add 10% padding on top

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
        />
        <YAxis
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          domain={yAxisDomain}
          tickFormatter={(value) =>
            value < 1 ? `${(value * 1000).toFixed(0)} Wh` : `${value.toFixed(2)} kWh`
          }
          width={60}
        />
        <Tooltip
          formatter={(value) => [formatEnergy(value as number), 'Energy']}
          contentStyle={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            color: 'var(--color-text)',
          }}
          labelFormatter={(label) => `Time: ${label}`}
        />
        {showPs5Reference && (
          <ReferenceLine
            y={PS5_KWH_PER_HOUR}
            stroke="#818cf8"
            strokeDasharray="6 4"
            strokeWidth={1}
            label={{
              value: 'PS5 (200W)',
              position: 'right',
              fill: '#818cf8',
              fontSize: 10,
            }}
          />
        )}
        <Area
          type="monotone"
          dataKey="kwh"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#energyGradient)"
          fillOpacity={1}
          name="Energy Usage"
          animationDuration={500}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
