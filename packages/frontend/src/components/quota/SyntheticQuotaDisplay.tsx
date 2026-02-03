import React from 'react';
import { clsx } from 'clsx';
import { CircleDollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QuotaProgressBar } from './QuotaProgressBar';
import type { QuotaCheckResult } from '../../types/quota';
import { formatCost } from '../../lib/format';

interface SyntheticQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const SyntheticQuotaDisplay: React.FC<SyntheticQuotaDisplayProps> = ({
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

  if (isCollapsed) {
    const overallStatus = subscriptionWindow?.status || 'ok';
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
    <div className="px-2 py-2 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDollarSign size={14} className="text-info" />
          <span className="text-xs font-semibold text-text">Synthetic</span>
        </div>
        {subscriptionWindow && (
          <span className={clsx(
            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            subscriptionWindow.status === 'ok' ? 'bg-success/20 text-success' :
            subscriptionWindow.status === 'warning' ? 'bg-warning/20 text-warning' :
            'bg-danger/20 text-danger'
          )}>
            {subscriptionWindow.status === 'ok' ? 'Healthy' :
             subscriptionWindow.status === 'warning' ? 'Warning' :
             subscriptionWindow.status === 'critical' ? 'Critical' : 'Exhausted'}
          </span>
        )}
      </div>

      {/* Subscription Budget */}
      {subscriptionWindow && subscriptionWindow.limit && (
        <QuotaProgressBar
          label="Monthly Budget"
          value={subscriptionWindow.used || 0}
          max={subscriptionWindow.limit}
          displayValue={`${formatCost(subscriptionWindow.used || 0)} / ${formatCost(subscriptionWindow.limit)}`}
          status={subscriptionWindow.status}
          color="green"
          size="sm"
        />
      )}

      {/* Additional windows */}
      {windows.filter(w => w.windowType !== 'subscription').map((window, idx) => (
        <QuotaProgressBar
          key={window.windowType}
          label={window.windowLabel || window.windowType}
          value={window.used || 0}
          max={window.limit || 100}
          displayValue={window.unit === 'dollars' 
            ? `${formatCost(window.used || 0)} / ${formatCost(window.limit || 0)}`
            : `${Math.round(window.utilizationPercent)}%`
          }
          status={window.status}
          color={idx % 2 === 0 ? 'blue' : 'amber'}
          size="sm"
        />
      ))}
    </div>
  );
};
