import { clsx } from 'clsx';
import React from 'react';

import { useNow } from '../../hooks/useNow';
import { useCurrency } from '../../lib/CurrencyContext';
import { countdownTickMs, formatResetCountdown } from '../../lib/format';
import type { Meter, MeterStatus } from '../../types/quota';
import { formatMeterValue } from './MeterValue';

interface AllowanceMeterRowProps {
  meter: Meter;
  compact?: boolean;
  onClick?: () => void;
}

function periodLabel(meter: Meter): string {
  if (!meter.periodValue || !meter.periodUnit) return '';
  const cycle = meter.periodCycle === 'rolling' ? 'rolling' : 'fixed';
  const unit =
    meter.periodUnit === 'hour'
      ? 'h'
      : meter.periodUnit === 'day'
        ? 'd'
        : meter.periodUnit === 'minute'
          ? 'min'
          : meter.periodUnit === 'week'
            ? 'wk'
            : 'mo';
  return `${meter.periodValue}${unit} ${cycle}`;
}

function statusColor(status: MeterStatus): string {
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

export const AllowanceMeterRow: React.FC<AllowanceMeterRowProps> = ({
  meter,
  compact,
  onClick,
}) => {
  const { currency, rate, symbol } = useCurrency();
  const resetsAtMs = meter.resetsAt ? new Date(meter.resetsAt).getTime() : NaN;
  const now = useNow(Number.isFinite(resetsAtMs) ? countdownTickMs(resetsAtMs - Date.now()) : null);
  const reset = formatResetCountdown(meter.resetsAt, now);

  const utilNum = typeof meter.utilizationPercent === 'number' ? meter.utilizationPercent : null;
  const pct = utilNum !== null ? Math.max(0, Math.min(100, utilNum)) : null;
  const period = periodLabel(meter);

  const remaining =
    meter.remaining !== undefined
      ? formatMeterValue(meter.remaining, meter.unit, true, { currency, rate, symbol })
      : undefined;

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-1">
          <span className="text-text-secondary flex-1 truncate text-[11px]">{meter.label}</span>
          {(pct !== null || reset) && (
            <span
              className="text-text-muted flex-shrink-0 text-[10px] tabular-nums"
              title={reset ? `Resets at ${reset.absolute}` : undefined}
            >
              {pct !== null && `${Math.round(pct)}%`}
              {pct !== null && reset && ' · '}
              {reset?.short}
            </span>
          )}
        </div>
        {pct !== null && (
          <div className="bg-bg-subtle border-border/30 h-1.5 overflow-hidden rounded-full border">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-500',
                statusColor(meter.status)
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex flex-col gap-1 py-0.5',
        onClick && 'hover:bg-bg-hover -mx-1 cursor-pointer rounded px-1 transition-colors'
      )}
      onClick={onClick}
      title={onClick ? 'Click to view history' : undefined}
    >
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">{meter.label}</span>
        {meter.scope && (
          <span className="text-text-muted bg-bg-subtle border-border-glass/40 shrink-0 rounded border px-1 font-mono text-[10px] tracking-wider uppercase">
            {meter.scope}
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="bg-bg-subtle border-border/30 h-1.5 overflow-hidden rounded-full border">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-500',
              statusColor(meter.status)
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {remaining !== undefined && (
          <span className="text-text text-xs tabular-nums">{remaining} left</span>
        )}
        {period && <span className="text-text-muted text-[10px]">{period}</span>}
        {pct !== null && (
          <span
            className={clsx(
              'text-xs font-semibold tabular-nums',
              meter.status === 'exhausted' || meter.status === 'critical'
                ? 'text-danger'
                : meter.status === 'warning'
                  ? 'text-warning'
                  : 'text-text-secondary'
            )}
          >
            {Math.round(pct)}%
          </span>
        )}
        {reset && (
          <span
            className={clsx(
              'text-[10px] tabular-nums',
              meter.status === 'exhausted' || meter.status === 'critical'
                ? 'text-text font-medium'
                : 'text-text-muted'
            )}
            title={`Resets at ${reset.absolute}`}
          >
            {reset.long}
          </span>
        )}
      </div>
    </div>
  );
};
