import { clsx } from 'clsx';
import React from 'react';

import type { MeterStatus } from '../../types/quota';

interface QuotaProgressBarProps {
  label: string;
  value: number;
  max: number;
  displayValue?: string;
  status?: MeterStatus;
  size?: 'sm' | 'md' | 'lg';
}

function barColor(status?: MeterStatus): string {
  switch (status) {
    case 'exhausted':
    case 'critical':
      return 'bg-danger';
    case 'warning':
      return 'bg-warning';
    default:
      return 'bg-success';
  }
}

export const QuotaProgressBar: React.FC<QuotaProgressBarProps> = ({
  label,
  value,
  max,
  displayValue,
  status,
  size = 'sm',
}) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const barH = size === 'lg' ? 'h-3' : size === 'md' ? 'h-2' : 'h-1.5';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-text-secondary truncate">{label}</span>
        {displayValue && (
          <span className="text-text flex-shrink-0 tabular-nums">{displayValue}</span>
        )}
      </div>
      <div
        className={clsx('bg-bg-subtle border-border/30 overflow-hidden rounded-full border', barH)}
      >
        <div
          className={clsx('h-full rounded-full transition-all duration-500', barColor(status))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
