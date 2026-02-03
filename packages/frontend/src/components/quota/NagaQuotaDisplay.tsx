import React from 'react';
import { clsx } from 'clsx';
import { Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QuotaProgressBar } from './QuotaProgressBar';
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

  // Find subscription window (balance-based)
  const subscriptionWindow = windows.find(w => w.windowType === 'subscription');

  // Get overall status
  const overallStatus = subscriptionWindow?.status || 'ok';

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        {overallStatus === 'ok' ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : overallStatus === 'warning' ? (
          <AlertTriangle size={18} className="text-warning" />
        ) : (
          <AlertTriangle size={18} className="text-danger" />
        )}
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wallet size={14} className="text-info" />
        <span className="text-xs font-semibold text-text">Naga</span>
      </div>

      {/* Account Balance */}
      {subscriptionWindow && subscriptionWindow.limit && (
        <QuotaProgressBar
          label="Balance"
          value={subscriptionWindow.used || 0}
          max={subscriptionWindow.limit}
          displayValue={`${Math.round(subscriptionWindow.utilizationPercent)}%`}
          status={subscriptionWindow.status}
          color="green"
          size="sm"
        />
      )}
    </div>
  );
};
