import React from 'react';
import { clsx } from 'clsx';
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  const fiveHourWindow = windows.find(w => w.windowType === 'five_hour');
  const toolcallsWindow = windows.find(w => w.windowType === 'toolcalls');
  const searchWindow = windows.find(w => w.windowType === 'search');

  // Get overall status (prioritize five_hour, then toolcalls, then search)
  const overallStatus = fiveHourWindow?.status || toolcallsWindow?.status || searchWindow?.status || 'ok';

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
        <Zap size={14} className="text-info" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Synthetic</span>
        {result.oauthAccountId && (
          <span className="text-[10px] text-text-muted truncate">({result.oauthAccountId})</span>
        )}
      </div>

      {/* 5-hour request quota */}
      {fiveHourWindow && fiveHourWindow.limit && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">5h:</span>
            <span className="text-[10px] text-text-muted">
              {fiveHourWindow.resetInSeconds !== undefined && fiveHourWindow.resetInSeconds !== null
                ? formatDuration(fiveHourWindow.resetInSeconds)
                : '?'}
            </span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(fiveHourWindow.status, 'bg-emerald-400')
                )}
                style={{ width: `${Math.min(100, Math.max(0, fiveHourWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-emerald-400">
              {Math.round(fiveHourWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {(toolcallsWindow || searchWindow) && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          {toolcallsWindow && toolcallsWindow.limit && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-text-secondary">Tool Calls</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                    barColorForStatus(toolcallsWindow.status, 'bg-cyan-400')
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, toolcallsWindow.utilizationPercent))}%` }}
                />
              </div>
              <span className="text-text">{Math.round(toolcallsWindow.utilizationPercent)}%</span>
            </div>
          )}
          {searchWindow && searchWindow.limit && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-text-secondary">Search</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                    barColorForStatus(searchWindow.status, 'bg-violet-400')
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, searchWindow.utilizationPercent))}%` }}
                />
              </div>
              <span className="text-text">{Math.round(searchWindow.utilizationPercent)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
