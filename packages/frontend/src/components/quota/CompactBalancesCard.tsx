import { AlertTriangle } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrency } from '../../lib/CurrencyContext';
import type { QuotaCheckerInfo } from '../../types/quota';
import { getCheckerDisplayName } from './checker-presentation';
import { formatMeterValue } from './MeterValue';
import { getStaleReadingMessage } from './StaleReadingNotice';

interface CompactBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  displayNameMap?: Map<string, string>;
}

export const CompactBalancesCard: React.FC<CompactBalancesCardProps> = ({
  balanceQuotas,
  displayNameMap,
}) => {
  const navigate = useNavigate();
  const { currency, rate, symbol } = useCurrency();

  if (balanceQuotas.length === 0) return null;

  return (
    <div
      className="hover:bg-bg-hover cursor-pointer space-y-0.5 px-2 py-1 transition-colors"
      onClick={() => navigate('/quotas')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/quotas');
        }
      }}
    >
      {balanceQuotas.map((quota) => {
        const displayName = getCheckerDisplayName(
          quota.checkerType,
          quota.checkerId,
          displayNameMap
        );
        const balanceMeter = quota.meters.find((m) => m.kind === 'balance');
        const remaining = balanceMeter?.remaining;
        const formattedBalance =
          remaining !== undefined
            ? formatMeterValue(remaining, balanceMeter!.unit, false, { currency, rate, symbol })
            : undefined;

        return (
          <div key={quota.checkerId} className="flex min-w-0 items-center justify-between">
            <span className="text-text-secondary truncate text-xs">{displayName}:</span>
            {!quota.success ? (
              <span className="text-danger ml-2 flex-shrink-0 text-xs">Error</span>
            ) : formattedBalance !== undefined ? (
              <span className="text-text-secondary ml-2 flex-shrink-0 text-xs font-semibold tabular-nums">
                {formattedBalance}
                {quota.stale && (
                  <span
                    className="text-warning ml-1 inline-flex"
                    role="img"
                    title={getStaleReadingMessage(quota.error)}
                    aria-label={getStaleReadingMessage(quota.error)}
                  >
                    <AlertTriangle size={12} aria-hidden="true" />
                  </span>
                )}
              </span>
            ) : (
              <span className="text-text-muted flex-shrink-0 text-xs">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
