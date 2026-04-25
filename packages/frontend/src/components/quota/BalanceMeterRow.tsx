import React from 'react';
import { Wallet } from 'lucide-react';
import type { Meter } from '../../types/quota';
import { formatMeterValue } from './MeterValue';

interface BalanceMeterRowProps {
  meter: Meter;
}

export const BalanceMeterRow: React.FC<BalanceMeterRowProps> = ({ meter }) => {
  const displayValue =
    meter.remaining !== undefined
      ? meter.remaining
      : meter.used !== undefined && meter.limit !== undefined
        ? meter.limit - meter.used
        : undefined;

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <Wallet size={12} className="text-info flex-shrink-0" />
        <span className="text-xs text-text-secondary truncate">{meter.label}</span>
      </div>
      {displayValue !== undefined ? (
        <span className="text-xs font-semibold text-info tabular-nums flex-shrink-0">
          {formatMeterValue(displayValue, meter.unit)}
        </span>
      ) : (
        <span className="text-xs text-text-muted flex-shrink-0">—</span>
      )}
    </div>
  );
};
