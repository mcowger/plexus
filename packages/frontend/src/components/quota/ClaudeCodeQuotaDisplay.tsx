import React from 'react';
import { clsx } from 'clsx';
import { Cpu, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';
import { formatDuration } from '../../lib/format';
import { Tooltip } from '../ui/Tooltip';

interface ClaudeCodeQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const ClaudeCodeQuotaDisplay: React.FC<ClaudeCodeQuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
  const getErrorTooltipContent = () => {
    const fallback = result.oauthProvider
      ? `Claude quota check failed. Re-authenticate the '${result.oauthProvider}' OAuth provider and retry.`
      : 'Claude quota check failed. Retry the check or verify your provider authentication.';

    const message = result.error?.trim() || fallback;
    const isOAuthError = /oauth|not authenticated|login/i.test(message);

    return (
      <div className="max-w-[320px] whitespace-normal leading-snug">
        <div className="font-semibold text-text">Quota check failed</div>
        <div className="mt-1 text-text-muted">{message}</div>
        {isOAuthError && result.oauthProvider && (
          <div className="mt-1 text-text-secondary">
            Next step: run OAuth login for provider '{result.oauthProvider}'.
          </div>
        )}
      </div>
    );
  };

  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <Tooltip content={getErrorTooltipContent()} position="right">
          <div
            className={clsx(
              'flex items-center gap-2 text-danger cursor-help',
              isCollapsed && 'justify-center'
            )}
          >
            <AlertTriangle size={16} />
            {!isCollapsed && <span className="text-xs">Error</span>}
          </div>
        </Tooltip>
      </div>
    );
  }

  const windows = result.windows || [];
  const fiveHourWindow = windows.find((w) => w.windowType === 'five_hour');
  const weeklyWindow = windows.find((w) => w.windowType === 'weekly');

  // Determine overall status
  const overallStatus =
    fiveHourWindow?.status === 'exhausted' || fiveHourWindow?.status === 'critical'
      ? 'critical'
      : weeklyWindow?.status === 'exhausted' || weeklyWindow?.status === 'critical'
        ? 'critical'
        : fiveHourWindow?.status === 'warning' || weeklyWindow?.status === 'warning'
          ? 'warning'
          : 'ok';

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
      {/* Header */}
      <div className="flex items-center gap-2 min-w-0">
        <Cpu size={14} className="text-purple-400" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Claude</span>
        {result.oauthAccountId && (
          <span className="text-[10px] text-text-muted truncate">({result.oauthAccountId})</span>
        )}
      </div>

      {/* 5-Hour Window */}
      {fiveHourWindow && (
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
                  barColorForStatus(fiveHourWindow.status, 'bg-info')
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, fiveHourWindow.utilizationPercent))}%`,
                }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-info">
              {Math.round(fiveHourWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {/* Weekly Window */}
      {weeklyWindow && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-text-secondary">1w:</span>
            <span className="text-text-muted">
              {weeklyWindow.resetInSeconds !== undefined && weeklyWindow.resetInSeconds !== null
                ? formatDuration(weeklyWindow.resetInSeconds)
                : '?'}
            </span>
            <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                className={clsx(
                  'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                  barColorForStatus(weeklyWindow.status, 'bg-purple-400')
                )}
                style={{ width: `${Math.min(100, Math.max(0, weeklyWindow.utilizationPercent))}%` }}
              />
            </div>
          </div>
          <span className="text-text">{Math.round(weeklyWindow.utilizationPercent)}%</span>
        </div>
      )}
    </div>
  );
};
