import React from 'react';
import { clsx } from 'clsx';
import { DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

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

  const statusColors: Record<QuotaStatus, string> = {
    ok: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-danger',
    exhausted: 'bg-danger',
  };

  const barColorForStatus = (status?: QuotaStatus, fallback = 'bg-emerald-400') =>
    status ? statusColors[status] : fallback;

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
      <div className="flex items-center gap-2 min-w-0">
        <DollarSign size={14} className="text-info" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Synthetic</span>
        {result.oauthAccountId && (
          <span className="text-[10px] text-text-muted truncate">({result.oauthAccountId})</span>
        )}
      </div>

      {/* Subscription - Requests per 5-hour window */}
      {subscriptionWindow && subscriptionWindow.limit && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">5h:</span>
            <span className="text-[10px] text-text-muted">
              {subscriptionWindow.resetInSeconds !== undefined && subscriptionWindow.resetInSeconds !== null
                ? formatDuration(subscriptionWindow.resetInSeconds)
                : '?'}
            </span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(subscriptionWindow.status, 'bg-emerald-400')
                )}
                style={{ width: `${Math.min(100, Math.max(0, subscriptionWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-emerald-400">
              {Math.round(subscriptionWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {(dailyWindow || hourlyWindow) && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          {dailyWindow && dailyWindow.limit && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-text-secondary">Tools</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                    barColorForStatus(dailyWindow.status, 'bg-emerald-400')
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, dailyWindow.utilizationPercent))}%` }}
                />
              </div>
              <span className="text-text">{Math.round(dailyWindow.utilizationPercent)}%</span>
            </div>
          )}
          {hourlyWindow && hourlyWindow.limit && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-text-secondary">Search</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                    barColorForStatus(hourlyWindow.status, 'bg-info')
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, hourlyWindow.utilizationPercent))}%` }}
                />
              </div>
              <span className="text-text">{Math.round(hourlyWindow.utilizationPercent)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
