import React from 'react';
import { clsx } from 'clsx';
import type { Meter, MeterStatus } from '../../types/quota';
import { formatMeterValue } from './MeterValue';

interface AllowanceMeterRowProps {
  meter: Meter;
  compact?: boolean;
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

export const AllowanceMeterRow: React.FC<AllowanceMeterRowProps> = ({ meter, compact }) => {
  const utilNum =
    typeof meter.utilizationPercent === 'number' ? meter.utilizationPercent : null;
  const pct = utilNum !== null ? Math.max(0, Math.min(100, utilNum)) : null;
  const period = periodLabel(meter);

  const remaining =
    meter.remaining !== undefined
      ? formatMeterValue(meter.remaining, meter.unit, true)
      : undefined;

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-1 min-w-0">
          <span className="text-[11px] text-text-secondary truncate flex-1">{meter.label}</span>
          {pct !== null && (
            <span className="text-[10px] tabular-nums text-text-muted flex-shrink-0">
              {Math.round(pct)}%
            </span>
          )}
        </div>
        {pct !== null && (
          <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden border border-border/30">
            <div
              className={clsx('h-full rounded-full transition-all duration-500', statusColor(meter.status))}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-text-secondary truncate flex-1">{meter.label}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {remaining !== undefined && (
            <span className="text-xs tabular-nums text-text">{remaining} left</span>
          )}
          {period && (
            <span className="text-[10px] text-text-muted">{period}</span>
          )}
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
        </div>
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden border border-border/30">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', statusColor(meter.status))}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};
