import React from 'react';
import { Progress } from '../../../../components/ui/shadcn-progress';

interface RPMGaugeProps {
  value: number;
  label?: string;
}

export const RPMGauge: React.FC<RPMGaugeProps> = ({
  value,
  label = 'RPM'
}) => {
  const maxRPM = 8000;
  const percentage = Math.min(100, Math.max(0, (value / maxRPM) * 100));

  const getColor = (pct: number) => {
    if (pct < 60) return '#10b981';
    if (pct < 80) return '#f59e0b';
    return '#ef4444';
  };

  const activeColor = getColor(percentage);

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full mb-4">
        <Progress
          value={value}
          max={maxRPM}
          className="h-4"
        />
      </div>
      <div className="text-5xl font-black text-foreground">{Math.round(value)}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">x100 tokens/min</div>
      <div
        className="mt-4 w-4 h-4 rounded-full animate-pulse"
        style={{
          backgroundColor: activeColor,
          boxShadow: `0 0 20px ${activeColor}`
        }}
      />
    </div>
  );
};
