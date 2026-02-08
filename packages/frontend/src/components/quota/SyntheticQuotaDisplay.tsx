import React from 'react';
import { clsx } from 'clsx';
import { DollarSign, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
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
      {result.oauthAccountId && (
        <div className="text-[10px] text-text-muted pl-5">Account: {result.oauthAccountId}</div>
      )}

      {/* Subscription - Requests per 5-hour window */}
      {subscriptionWindow && subscriptionWindow.limit && (
        <>
          <QuotaProgressBar
            label={`5h: ${subscriptionWindow.resetInSeconds !== undefined && subscriptionWindow.resetInSeconds !== null ? formatDuration(subscriptionWindow.resetInSeconds) : '?'}`}
            value={subscriptionWindow.used || 0}
            max={subscriptionWindow.limit}
            displayValue={`${Math.round(subscriptionWindow.utilizationPercent)}%`}
            status={subscriptionWindow.status}
            color="green"
            size="sm"
          />
          {subscriptionWindow.estimation?.willExceed && (
            <div className="flex items-center gap-1 text-xs text-warning pl-1">
              <TrendingUp size={12} />
              <span>
                Proj. {Math.round(subscriptionWindow.estimation.projectedUtilizationPercent)}% at reset
                {subscriptionWindow.estimation.exceedanceTimestamp && (
                  <span className="text-danger font-semibold"> (will exceed)</span>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {/* Daily Tool Calls */}
      {dailyWindow && dailyWindow.limit && (
        <>
          <QuotaProgressBar
            label="Daily Tools"
            value={dailyWindow.used || 0}
            max={dailyWindow.limit}
            displayValue={`${Math.round(dailyWindow.utilizationPercent)}%`}
            status={dailyWindow.status}
            color="amber"
            size="sm"
          />
          {dailyWindow.estimation?.willExceed && (
            <div className="flex items-center gap-1 text-xs text-warning pl-1">
              <TrendingUp size={12} />
              <span>
                Proj. {Math.round(dailyWindow.estimation.projectedUtilizationPercent)}% at reset
                {dailyWindow.estimation.exceedanceTimestamp && (
                  <span className="text-danger font-semibold"> (will exceed)</span>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {/* Hourly Search */}
      {hourlyWindow && hourlyWindow.limit && (
        <>
          <QuotaProgressBar
            label="Hourly Search"
            value={hourlyWindow.used || 0}
            max={hourlyWindow.limit}
            displayValue={`${Math.round(hourlyWindow.utilizationPercent)}%`}
            status={hourlyWindow.status}
            color="blue"
            size="sm"
          />
          {hourlyWindow.estimation?.willExceed && (
            <div className="flex items-center gap-1 text-xs text-warning pl-1">
              <TrendingUp size={12} />
              <span>
                Proj. {Math.round(hourlyWindow.estimation.projectedUtilizationPercent)}% at reset
                {hourlyWindow.estimation.exceedanceTimestamp && (
                  <span className="text-danger font-semibold"> (will exceed)</span>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
