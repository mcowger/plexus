import React from 'react';
import { clsx } from 'clsx';
import { Wallet, AlertTriangle } from 'lucide-react';
import { formatCost } from '../../lib/format';
import type { QuotaCheckResult } from '../../types/quota';

interface NagaQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const NagaQuotaDisplay: React.FC<NagaQuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <div className={clsx(
          "flex items-center gap-2 text-danger",
          isCollapsed && "justify-center"
        )}>
          <AlertTriangle size={16} />
          {!isCollapsed && <span className="text-xs">Error</span>}
        </div>
      </div>
    );
  }

  const windows = result.windows || [];
  const subscriptionWindow = windows.find(w => w.windowType === 'subscription');
  const balance = subscriptionWindow?.remaining;

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        <Wallet size={18} className="text-info" />
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <Wallet size={14} className="text-info" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Naga</span>
      </div>
      {result.oauthAccountId && (
        <div className="text-[10px] text-text-muted pl-5">Account: {result.oauthAccountId}</div>
      )}
      {balance !== undefined && (
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-text-secondary">Balance</span>
          <span className="text-xs font-semibold text-info ml-auto">
            {formatCost(balance)}
          </span>
        </div>
      )}
    </div>
  );
};
