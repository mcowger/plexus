import { AlertCircle, AlertTriangle, Check, Info, RefreshCw, Users, Wrench } from 'lucide-react';
import React from 'react';

import type { QuotaStatusEntry } from '../../lib/api';
import { useCurrency } from '../../lib/CurrencyContext';
import { formatResetsIn } from '../../lib/format';
import { formatQuotaValue, quotaUsagePercent, statusForPercent } from '../../lib/quota';
import { Button } from '../ui/Button';
import { hasScope, QuotaChip } from './QuotaChip';
import { QuotaProgressBar } from './QuotaProgressBar';

export interface QuotaStatusCardProps {
  entry: QuotaStatusEntry;
  /** 'inline' (default): plain block for end-user views (MyKey, OverallTab) —
   * no status icon, no scoped chip/suffix, no warnAt line.
   * 'detailed': bordered card for the admin quota-status modal — leading
   * allowed/blocked icon, scoped chip and " (scoped)" label suffix, warnAt
   * line, admin-phrased exhausted banner. */
  variant?: 'inline' | 'detailed';
  /** How the "Resets …" timestamp renders: absolute locale string (MyKey,
   * Keys modal) or relative "in 3h 20m" (OverallTab). */
  resetsAtFormat?: 'absolute' | 'relative';
  /** When provided, renders the reset-usage icon button. */
  onReset?: (quotaName: string) => void;
  /** When provided, renders the recompute-usage icon button. */
  onRecompute?: (quotaName: string) => void;
  /** Rolling requests/tokens defs can't be recomputed from historical data —
   * disables the recompute button and swaps its icon for an explanation. */
  recomputeLeaky?: boolean;
  /** Recompute in flight for this quota — disables the recompute button. */
  recomputing?: boolean;
}

/**
 * Per-quota status block shared by every view that renders a
 * `QuotaStatusEntry`: name + source/shared chips, progress bar,
 * remaining/resets row, and exhausted banner. Introduced so the three
 * previously-duplicated variants (MyKey, OverallTab, Keys admin modal) can't
 * drift apart.
 */
export const QuotaStatusCard: React.FC<QuotaStatusCardProps> = ({
  entry,
  variant = 'inline',
  resetsAtFormat = 'absolute',
  onReset,
  onRecompute,
  recomputeLeaky = false,
  recomputing = false,
}) => {
  const { currency, rate, symbol } = useCurrency();
  const detailed = variant === 'detailed';
  const pct = quotaUsagePercent(entry);
  const resetsLabel =
    resetsAtFormat === 'relative'
      ? formatResetsIn(entry.resetsAt)
      : new Date(entry.resetsAt).toLocaleString();

  const chips = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
      {detailed &&
        (entry.allowed ? (
          <Check className="text-success shrink-0" size={16} />
        ) : (
          <AlertCircle className="text-danger shrink-0" size={16} />
        ))}
      <span className="text-text truncate font-medium">{entry.name}</span>
      {entry.source === 'default' && <QuotaChip tone="muted">default</QuotaChip>}
      {entry.shared && (
        <QuotaChip>
          <Users size={10} /> shared
        </QuotaChip>
      )}
      {detailed && hasScope(entry.scope) && <QuotaChip tone="muted">scoped</QuotaChip>}
    </div>
  );

  const actions = (onReset || onRecompute) && (
    <div className="flex shrink-0 items-center gap-1">
      {onReset && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onReset(entry.name)}
          aria-label={`Reset ${entry.name}`}
          title="Reset usage"
        >
          <RefreshCw size={14} />
        </Button>
      )}
      {onRecompute && (
        <span
          title={
            recomputeLeaky
              ? 'Recompute is unavailable for rolling requests/tokens quotas — their usage cannot be reconstructed from historical data.'
              : 'Recompute usage from historical request logs'
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRecompute(entry.name)}
            disabled={recomputeLeaky || recomputing}
            aria-label={`Recompute ${entry.name}`}
          >
            {recomputeLeaky ? <Info size={14} /> : <Wrench size={14} />}
          </Button>
        </span>
      )}
    </div>
  );

  return (
    <div
      className={
        detailed
          ? 'bg-bg-subtle border-border-glass flex flex-col gap-2 rounded-md border p-3'
          : 'flex flex-col gap-2'
      }
    >
      {actions ? (
        <div className="flex items-start justify-between gap-2">
          {chips}
          {actions}
        </div>
      ) : (
        chips
      )}

      <QuotaProgressBar
        label={detailed && !entry.global ? `${entry.limitType} (scoped)` : entry.limitType}
        value={entry.currentUsage}
        max={entry.limit}
        displayValue={`${formatQuotaValue(entry.currentUsage, entry.limitType, { currency, rate, symbol })} / ${formatQuotaValue(entry.limit, entry.limitType, { currency, rate, symbol })}`}
        status={statusForPercent(pct)}
        size="md"
      />

      <div className="text-text-muted flex items-center justify-between text-xs">
        <span>
          Remaining:{' '}
          <span className="text-text font-medium">
            {formatQuotaValue(entry.remaining, entry.limitType, { currency, rate, symbol })}
          </span>
        </span>
        <span>Resets {resetsLabel}</span>
      </div>

      {detailed && entry.warnAt !== undefined && (
        <p className="text-text-muted text-[11px]">
          Warns at {Math.round(entry.warnAt * 100)}% usage
        </p>
      )}

      {!entry.allowed && (
        <div className="text-danger flex items-center gap-2 text-xs">
          {detailed ? (
            <>
              <AlertCircle size={12} />
              <span>Exhausted — requests using this quota are being rejected.</span>
            </>
          ) : (
            <>
              <AlertTriangle size={14} />
              <span>Quota exhausted — new requests will be rejected until it resets.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
