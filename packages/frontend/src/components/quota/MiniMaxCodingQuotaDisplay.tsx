import React from 'react';
import { clsx } from 'clsx';
import { Code2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface MiniMaxCodingQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const MiniMaxCodingQuotaDisplay: React.FC<MiniMaxCodingQuotaDisplayProps> = ({
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

  const barColorForStatus = (status?: QuotaStatus, fallback = 'bg-info') =>
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
        <Code2 size={14} className="text-info" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">MiniMax Coding</span>
      </div>

      {windows.map((window) => (
        <div key={window.windowLabel || window.windowType} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary truncate">
              {window.description || window.windowLabel}
            </span>
            {window.resetInSeconds !== undefined && window.resetInSeconds !== null && (
              <span className="text-[10px] text-text-muted ml-auto">
                {formatDuration(window.resetInSeconds)}
              </span>
            )}
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-10">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(window.status)
                )}
                style={{ width: `${Math.min(100, Math.max(0, window.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-info">
              {Math.round(window.utilizationPercent)}%
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
