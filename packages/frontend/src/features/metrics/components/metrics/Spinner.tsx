import React from 'react';
import { Skeleton } from '../../../../components/ui/shadcn-skeleton';

interface SpinnerProps {
  value: number;
  max?: number;
  size?: number;
}

export const Spinner: React.FC<SpinnerProps> = ({
  value,
  max = 100,
  size = 120
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const circumference = 2 * Math.PI * ((size - 8) / 2);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <Skeleton className="absolute inset-0 rounded-full" />
      <svg className="relative transform -rotate-90 w-full h-full" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - 8) / 2}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - 8) / 2}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{Math.round(percentage)}%</span>
      </div>
    </div>
  );
};
