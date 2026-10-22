import { Wallet } from 'lucide-react';
import React from 'react';

import { useCurrency } from '../../lib/CurrencyContext';
import type { Meter } from '../../types/quota';
import { formatMeterValue } from './MeterValue';

interface BalanceMeterRowProps {
  meter: Meter;
  onClick?: () => void;
}

export const BalanceMeterRow: React.FC<BalanceMeterRowProps> = ({ meter, onClick }) => {
  const { currency, rate, symbol } = useCurrency();
  const displayValue =
    meter.remaining !== undefined
      ? meter.remaining
      : meter.used !== undefined && meter.limit !== undefined
        ? meter.limit - meter.used
        : undefined;

  return (
    <div
      className={`flex items-center justify-between gap-3 py-0.5 rounded${onClick ? ' hover:bg-bg-hover -mx-1 cursor-pointer px-1 transition-colors' : ''}`}
      onClick={onClick}
      title={onClick ? 'Click to view history' : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Wallet size={12} className="text-info flex-shrink-0" />
        <span className="text-text-secondary truncate text-xs">{meter.label}</span>
      </div>
      {displayValue !== undefined ? (
        <span className="text-info flex-shrink-0 text-xs font-semibold tabular-nums">
          {formatMeterValue(displayValue, meter.unit, false, { currency, rate, symbol })}
        </span>
      ) : (
        <span className="text-text-muted flex-shrink-0 text-xs">—</span>
      )}
    </div>
  );
};
