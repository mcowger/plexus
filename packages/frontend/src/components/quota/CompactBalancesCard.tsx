import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { QuotaCheckerInfo } from '../../types/quota';
import { formatMeterValue } from './MeterValue';
import { getCheckerDisplayName } from './checker-presentation';

interface CompactBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  displayNameMap?: Map<string, string>;
}

export const CompactBalancesCard: React.FC<CompactBalancesCardProps> = ({
  balanceQuotas,
  displayNameMap,
}) => {
  const navigate = useNavigate();

  if (balanceQuotas.length === 0) return null;

  return (
    <div
      className="px-2 py-1 space-y-0.5 cursor-pointer hover:bg-bg-hover transition-colors"
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
          remaining !== undefined ? formatMeterValue(remaining, balanceMeter!.unit) : undefined;

        return (
          <div key={quota.checkerId} className="flex items-center justify-between min-w-0">
            <span className="text-xs text-text-secondary truncate">{displayName}:</span>
            {!quota.success ? (
              <span className="text-xs text-danger flex-shrink-0 ml-2">Error</span>
            ) : formattedBalance !== undefined ? (
              <span className="text-xs font-semibold text-text-secondary tabular-nums flex-shrink-0 ml-2">
                {formattedBalance}
              </span>
            ) : (
              <span className="text-xs text-text-muted flex-shrink-0">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
