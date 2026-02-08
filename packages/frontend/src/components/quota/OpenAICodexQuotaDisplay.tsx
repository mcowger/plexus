import React from 'react';
import { clsx } from 'clsx';
import { Bot, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface OpenAICodexQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const OpenAICodexQuotaDisplay: React.FC<OpenAICodexQuotaDisplayProps> = ({
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
  const fiveHourWindow = windows.find((window) => window.windowType === 'five_hour');
  const weeklyWindow = windows.find((window) => window.windowType === 'weekly');
  const codeReviewWindow = windows.find(
    (window) => window.windowType !== 'five_hour' && window.windowType !== 'weekly'
  );

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

  const barColorForStatus = (status?: QuotaStatus, fallback = 'bg-purple-500') =>
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
        <Bot size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Codex</span>
        {result.oauthAccountId && (
          <span className="text-[10px] text-text-muted truncate">({result.oauthAccountId})</span>
        )}
      </div>

      {fiveHourWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">5h Usage</span>
            {fiveHourWindow.resetInSeconds !== undefined && fiveHourWindow.resetInSeconds !== null && (
              <span className="text-[10px] text-text-muted">
                {formatDuration(fiveHourWindow.resetInSeconds)}
              </span>
            )}
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(fiveHourWindow.status)
                )}
                style={{ width: `${Math.min(100, Math.max(0, fiveHourWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-purple-400">
              {Math.round(fiveHourWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {(weeklyWindow || codeReviewWindow) && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          {weeklyWindow && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-text-secondary">Weekly:</span>
              <span className="text-text-muted">
                {weeklyWindow.resetInSeconds !== undefined && weeklyWindow.resetInSeconds !== null
                  ? formatDuration(weeklyWindow.resetInSeconds)
                  : '?'}
              </span>
              <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                    barColorForStatus(weeklyWindow.status, 'bg-emerald-400')
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, weeklyWindow.utilizationPercent))}%` }}
                />
              </div>
            </div>
          )}
          {codeReviewWindow && (
            <span className="text-text-secondary">
              CR: <span className="text-text">{Math.round(codeReviewWindow.utilizationPercent)}%</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
