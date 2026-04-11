import React from 'react';
import { clsx } from 'clsx';
import { Zap, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import { formatDuration, formatCost } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus, QuotaWindow } from '../../types/quota';

interface SyntheticQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

const STATUS_BAR_COLOR: Record<QuotaStatus, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-danger',
  exhausted: 'bg-danger',
};

const STATUS_TEXT_COLOR: Record<QuotaStatus, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  critical: 'text-danger',
  exhausted: 'text-danger',
};

interface ProgressBarProps {
  window: QuotaWindow;
  label: string;
  defaultBarColor: string;
  defaultTextColor: string;
  infoText?: string;
  dollarCost?: number;
  dollarLimit?: number;
  showWalletIcon?: boolean;
  showDollarUsedLabel?: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  window,
  label,
  defaultBarColor,
  defaultTextColor,
  infoText,
  dollarCost,
  dollarLimit,
  showWalletIcon,
  showDollarUsedLabel,
}) => {
  const barColor = window.status ? STATUS_BAR_COLOR[window.status] : defaultBarColor;
  const textColor = window.status ? STATUS_TEXT_COLOR[window.status] : defaultTextColor;
  if (!window.limit) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        {showWalletIcon && <Wallet size={12} className={textColor} />}
        <span className="text-xs font-semibold text-text-secondary">{label}</span>
        {dollarCost !== undefined && (
          <>
            <span className={clsx('text-xs font-semibold', textColor)}>
              {formatCost(dollarCost)}
            </span>
            {dollarLimit !== undefined && (
              <span className="text-[10px] text-text-muted">
                / {formatCost(dollarLimit)}
                {showDollarUsedLabel && ' used'}
              </span>
            )}
          </>
        )}
        {infoText && <span className="text-[10px] text-text-muted">{infoText}</span>}
      </div>
      <div className="relative h-2">
        <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
          <div
            className={clsx('h-full rounded-md transition-all duration-500 ease-out', barColor)}
            style={{
              width: `${Math.min(100, Math.max(0, window.utilizationPercent))}%`,
            }}
          />
        </div>
        <div
          className={clsx(
            'absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold',
            textColor
          )}
        >
          {Math.round(window.utilizationPercent)}%
        </div>
      </div>
    </div>
  );
};

export const SyntheticQuotaDisplay: React.FC<SyntheticQuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
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

  const fiveHourWindow =
    windows.find((w) => w.windowType === 'rolling_five_hour') ||
    windows.find((w) => w.windowType === 'five_hour');
  const searchWindow = windows.find((w) => w.windowType === 'search');
  const weeklyWindow =
    windows.find((w) => w.windowType === 'rolling_weekly') ||
    windows.find((w) => w.windowType === 'weekly');

  const overallStatus =
    fiveHourWindow?.status || weeklyWindow?.status || searchWindow?.status || 'ok';

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

  const fiveHourUsed = fiveHourWindow?.used ?? 0;
  const fiveHourLimit = fiveHourWindow?.limit ?? 0;
  const fiveHourInfo = `${fiveHourUsed.toFixed(1)}/${fiveHourLimit.toFixed(1)} used`;

  const searchUsed = searchWindow?.used ?? 0;
  const searchLimit = searchWindow?.limit ?? 0;
  const searchReset = searchWindow?.resetInSeconds
    ? formatDuration(searchWindow.resetInSeconds)
    : '?';
  const searchInfo = `${searchUsed.toFixed(1)}/${searchLimit.toFixed(1)} used, resets in ${searchReset}`;

  return (
    <div className="px-2 py-1 space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <Zap size={14} className="text-info" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Synthetic</span>
        {result.oauthAccountId && (
          <span className="text-[10px] text-text-muted truncate">({result.oauthAccountId})</span>
        )}
      </div>

      {weeklyWindow && (
        <ProgressBar
          window={weeklyWindow}
          label="Weekly"
          defaultBarColor="bg-info"
          defaultTextColor="text-info"
          dollarCost={weeklyWindow.used}
          dollarLimit={weeklyWindow.limit}
          showWalletIcon
          showDollarUsedLabel
        />
      )}

      {fiveHourWindow && (
        <ProgressBar
          window={fiveHourWindow}
          label="5h"
          defaultBarColor="bg-emerald-400"
          defaultTextColor="text-emerald-400"
          infoText={fiveHourInfo}
        />
      )}

      {searchWindow && (
        <ProgressBar
          window={searchWindow}
          label="Search"
          defaultBarColor="bg-violet-400"
          defaultTextColor="text-violet-400"
          infoText={searchInfo}
        />
      )}
    </div>
  );
};
