import React from 'react';
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';

interface AnimatedGaugeProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
}

export const AnimatedGauge: React.FC<AnimatedGaugeProps> = ({
  value,
  max,
  label,
  unit = ''
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const getColor = (pct: number) => {
    if (pct < 60) return '#10b981';
    if (pct < 80) return '#f59e0b';
    return '#ef4444';
  };

  const activeColor = getColor(percentage);

  const data = [{ name: label, value: percentage, fill: activeColor }];

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-40 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="60%"
            outerRadius="100%"
            data={data}
            startAngle={180}
            endAngle={0}
            cx="50%"
            cy="100%"
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background
              dataKey="value"
              cornerRadius={6}
              fill={activeColor}
              className="transition-all duration-500 ease-out"
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center -mt-4">
        <div className="text-3xl font-bold" style={{ color: activeColor }}>
          {value.toFixed(1)}<span className="text-lg">{unit}</span>
        </div>
        <div className="text-sm text-muted-foreground uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
};
