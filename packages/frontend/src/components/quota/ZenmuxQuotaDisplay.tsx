import React from 'react';
import { clsx } from 'clsx';
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration, formatPointsFull } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface ZenmuxQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const ZenmuxQuotaDisplay: React.FC<ZenmuxQuotaDisplayProps> = ({ result, isCollapsed }) => {
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

  // Find windows by type
  const fiveHourWindow = windows.find((w) => w.windowType === 'five_hour');
  const weeklyWindow = windows.find((w) => w.windowType === 'weekly');
  const monthlyWindow = windows.find((w) => w.windowType === 'monthly');

  // Overall status is the worst of all windows
  const statusRank: Record<string, number> = {
    ok: 0,
    warning: 1,
    critical: 2,
    exhausted: 3,
  };

  const overallStatus = windows.reduce((acc, window) => {
    const next = window.status || 'ok';
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
        <Zap size={14} className="text-cyan-400" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Zenmux</span>
      </div>

      {/* 5-hour quota */}
      {fiveHourWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">5-Hour Flows</span>
            {fiveHourWindow.remaining !== undefined && (
              <span className="text-[10px] text-text-muted ml-auto">
                {formatPointsFull(fiveHourWindow.remaining)} left
              </span>
            )}
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-10">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(fiveHourWindow.status)
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, fiveHourWindow.utilizationPercent))}%`,
                }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-text-secondary">
              {Math.round(fiveHourWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {/* Weekly quota */}
      {weeklyWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">7-Day Flows</span>
            {weeklyWindow.remaining !== undefined && (
              <span className="text-[10px] text-text-muted ml-auto">
                {formatPointsFull(weeklyWindow.remaining)} left
              </span>
            )}
          </div>
          <div className="relative h-1.5">
            <div className="h-1.5 rounded-md bg-bg-hover overflow-hidden mr-8">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(weeklyWindow.status)
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, weeklyWindow.utilizingPercent || 0))}%`,
                }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-text-secondary">
              {Math.round(weeklyWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {/* Monthly quota - just show as text */}
      {monthlyWindow && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="text-text-secondary">Monthly:</span>
          {monthlyWindow.limit !== undefined && (
            <span className="text-text-muted ml-auto">
              {formatPointsFull(monthlyWindow.limit)} flows
            </span>
          )}
        </div>
      )}
    </div>
  );
};
