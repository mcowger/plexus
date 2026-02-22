import React from 'react';
import { clsx } from 'clsx';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface KimiCodeQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const KimiCodeQuotaDisplay: React.FC<KimiCodeQuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <div className={clsx(
          'flex items-center gap-2 text-danger',
          isCollapsed && 'justify-center'
        )}>
          <AlertTriangle size={16} />
          {!isCollapsed && <span className="text-xs">Error</span>}
        </div>
      </div>
    );
  }

  const windows = result.windows || [];
  const fiveHourWindow = windows.find(w => w.windowType === 'five_hour');
  const weeklyWindow = windows.find(w => w.windowType === 'weekly');
  const primaryWindow = fiveHourWindow || windows[0];
  const secondaryWindow = weeklyWindow && weeklyWindow !== primaryWindow ? weeklyWindow : undefined;

  const statusRank: Record<string, number> = {
    ok: 0,
    warning: 1,
    critical: 2,
    exhausted: 3,
  };

  const overallStatus = windows.reduce((acc, w) => {
    const next = w.status || 'ok';
    return statusRank[next] > statusRank[acc] ? next : acc;
  }, 'ok');

  const statusColors: Record<QuotaStatus, string> = {
    ok: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-danger',
    exhausted: 'bg-danger',
  };

  const barColorForStatus = (status?: QuotaStatus, fallback = 'bg-cyan-500') =>
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
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={14} className="text-cyan-400" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Kimi</span>
      </div>

      {primaryWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">
              {primaryWindow.windowType === 'five_hour' ? '5h' : primaryWindow.description || 'Usage'}:
            </span>
            <span className="text-[10px] text-text-muted">
              {primaryWindow.resetInSeconds !== undefined && primaryWindow.resetInSeconds !== null
                ? formatDuration(primaryWindow.resetInSeconds)
                : '?'}
            </span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(primaryWindow.status)
                )}
                style={{ width: `${Math.min(100, Math.max(0, primaryWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-cyan-400">
              {Math.round(primaryWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {secondaryWindow && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-text-secondary">
              {secondaryWindow.windowType === 'weekly' ? '1w' : secondaryWindow.description || 'Limit'}:
            </span>
            <span className="text-text-muted">
              {secondaryWindow.resetInSeconds !== undefined && secondaryWindow.resetInSeconds !== null
                ? formatDuration(secondaryWindow.resetInSeconds)
                : '?'}
            </span>
            <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className={clsx(
                  'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                  barColorForStatus(secondaryWindow.status, 'bg-cyan-400')
                )}
                style={{ width: `${Math.min(100, Math.max(0, secondaryWindow.utilizationPercent))}%` }}
              />
            </div>
          </div>
          <span className="text-text">{Math.round(secondaryWindow.utilizationPercent)}%</span>
        </div>
      )}
    </div>
  );
};
