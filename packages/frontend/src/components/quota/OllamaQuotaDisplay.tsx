import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface OllamaQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const OllamaQuotaDisplay: React.FC<OllamaQuotaDisplayProps> = ({ result, isCollapsed }) => {
  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <div
          className={clsx('flex items-center gap-2 text-danger', isCollapsed && 'justify-center')}
        >
          <AlertTriangle size={16} />
          {!isCollapsed && <span className="text-xs">Error</span>}
        </div>
      </div>
    );
  }

  const windows = result.windows || [];

  const fiveHourWindow = windows.find((w) => w.windowType === 'five_hour');
  const weeklyWindow = windows.find((w) => w.windowType === 'weekly');

  const overallStatus = fiveHourWindow?.status || weeklyWindow?.status || 'ok';

  const statusColors: Record<QuotaStatus, string> = {
    ok: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-danger',
    exhausted: 'bg-danger',
  };

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
      {fiveHourWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">Session:</span>
            <span className="text-[10px] text-text-muted">
              {fiveHourWindow.resetInSeconds !== undefined && fiveHourWindow.resetInSeconds !== null
                ? formatDuration(fiveHourWindow.resetInSeconds)
                : fiveHourWindow.description || 'session'}
            </span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-8">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  statusColors[fiveHourWindow.status || 'ok']
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, fiveHourWindow.utilizationPercent))}%`,
                }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-text">
              {Math.round(fiveHourWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {weeklyWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">Weekly:</span>
            <span className="text-[10px] text-text-muted">
              {weeklyWindow.resetInSeconds !== undefined && weeklyWindow.resetInSeconds !== null
                ? formatDuration(weeklyWindow.resetInSeconds)
                : weeklyWindow.description || 'weekly'}
            </span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-8">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  statusColors[weeklyWindow.status || 'ok']
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, weeklyWindow.utilizationPercent))}%`,
                }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-text">
              {Math.round(weeklyWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
