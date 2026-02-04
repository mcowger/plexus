import React from 'react';
import { clsx } from 'clsx';
import { DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QuotaProgressBar } from './QuotaProgressBar';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult } from '../../types/quota';

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
  
  // Find windows by type
  const subscriptionWindow = windows.find(w => w.windowType === 'subscription');
  const dailyWindow = windows.find(w => w.windowType === 'daily');
  const hourlyWindow = windows.find(w => w.windowType === 'hourly');

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
        <DollarSign size={14} className="text-info" />
        <span className="text-xs font-semibold text-text">Synthetic</span>
      </div>

      {/* Subscription - Requests per 5-hour window */}
      {subscriptionWindow && subscriptionWindow.limit && (
        <QuotaProgressBar
          label={`5h: ${subscriptionWindow.resetInSeconds !== undefined ? formatDuration(subscriptionWindow.resetInSeconds) : '?'}`}
          value={subscriptionWindow.used || 0}
          max={subscriptionWindow.limit}
          displayValue={`${Math.round(subscriptionWindow.utilizationPercent)}%`}
          status={subscriptionWindow.status}
          color="green"
          size="sm"
        />
      )}

      {/* Daily Tool Calls */}
      {dailyWindow && dailyWindow.limit && (
        <QuotaProgressBar
          label="Daily Tools"
          value={dailyWindow.used || 0}
          max={dailyWindow.limit}
          displayValue={`${Math.round(dailyWindow.utilizationPercent)}%`}
          status={dailyWindow.status}
          color="amber"
          size="sm"
        />
      )}

      {/* Hourly Search */}
      {hourlyWindow && hourlyWindow.limit && (
        <QuotaProgressBar
          label="Hourly Search"
          value={hourlyWindow.used || 0}
          max={hourlyWindow.limit}
          displayValue={`${Math.round(hourlyWindow.utilizationPercent)}%`}
          status={hourlyWindow.status}
          color="blue"
          size="sm"
        />
      )}
    </div>
  );
};
