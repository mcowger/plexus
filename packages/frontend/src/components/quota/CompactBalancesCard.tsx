import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCost, toTitleCase } from '../../lib/format';
import type { QuotaCheckerInfo } from '../../types/quota';

interface CompactBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  getQuotaResult: (quota: QuotaCheckerInfo) => any;
}

export const CompactBalancesCard: React.FC<CompactBalancesCardProps> = ({
  balanceQuotas,
  getQuotaResult,
}) => {
  const navigate = useNavigate();

  if (balanceQuotas.length === 0) {
    return null;
  }

  const handleClick = () => {
    navigate('/quotas');
  };

  return (
    <div
      className="px-2 py-1 space-y-0.5 cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {balanceQuotas.map((quota) => {
        const result = getQuotaResult(quota);

        // Use the checkerId as the display name (this is the unique provider identifier)
        const displayName = toTitleCase(quota.checkerId);
        const windows = result.windows || [];
        const subscriptionWindow = windows.find((w: any) => w.windowType === 'subscription');
        const balance = subscriptionWindow?.remaining;

        return (
          <div key={quota.checkerId} className="flex items-center justify-between min-w-0">
            <span className="text-xs text-text-secondary truncate">{displayName}:</span>
            {!result.success ? (
              <span className="text-xs text-danger flex-shrink-0 ml-2">Error</span>
            ) : balance !== undefined ? (
              <span className="text-xs font-semibold text-text-secondary tabular-nums flex-shrink-0 ml-2">
                {formatCost(balance)}
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
