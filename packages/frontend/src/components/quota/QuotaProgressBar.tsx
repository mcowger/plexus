import React from 'react';
import { clsx } from 'clsx';
import type { QuotaStatus } from '../../types/quota';

interface QuotaProgressBarProps {
  label: string;
  value: number;
  max: number;
  displayValue?: string;
  status?: QuotaStatus;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  size?: 'sm' | 'md';
}

const statusColors: Record<QuotaStatus, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-danger',
  exhausted: 'bg-danger',
};

const customColors: Record<string, string> = {
  blue: 'bg-info',
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-danger',
  purple: 'bg-purple-500',
};

export const QuotaProgressBar: React.FC<QuotaProgressBarProps> = ({
  label,
  value,
  max,
  displayValue,
  status,
  color = 'blue',
  size = 'sm',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = status ? statusColors[status] : customColors[color];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className={clsx(
          "text-text-secondary font-medium",
          size === 'sm' ? 'text-xs' : 'text-sm'
        )}>
          {label}
        </span>
        <span className={clsx(
          "font-semibold",
          size === 'sm' ? 'text-xs' : 'text-sm',
          status === 'exhausted' || status === 'critical' ? 'text-danger' :
          status === 'warning' ? 'text-warning' :
          color === 'blue' ? 'text-info' :
          color === 'green' ? 'text-success' :
          color === 'amber' ? 'text-warning' :
          color === 'red' ? 'text-danger' : 'text-purple-400'
        )}>
          {displayValue || `${Math.round(percentage)}%`}
        </span>
      </div>
      <div className={clsx(
        "w-full bg-bg-hover rounded-full overflow-hidden",
        size === 'sm' ? 'h-1.5' : 'h-2'
      )}>
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-500 ease-out",
            barColor
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
