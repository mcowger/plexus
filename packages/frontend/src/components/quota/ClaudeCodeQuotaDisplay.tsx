import React from 'react';
import { clsx } from 'clsx';
import { Cpu, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QuotaProgressBar } from './QuotaProgressBar';
import type { QuotaCheckResult } from '../../types/quota';
import { formatDuration } from '../../lib/format';

interface ClaudeCodeQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const ClaudeCodeQuotaDisplay: React.FC<ClaudeCodeQuotaDisplayProps> = ({
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
  const fiveHourWindow = windows.find(w => w.windowType === 'five_hour');
  const weeklyWindow = windows.find(w => w.windowType === 'weekly');

  // Determine overall status
  const overallStatus = fiveHourWindow?.status === 'exhausted' || fiveHourWindow?.status === 'critical' 
    ? 'critical'
    : weeklyWindow?.status === 'exhausted' || weeklyWindow?.status === 'critical'
    ? 'critical'
    : fiveHourWindow?.status === 'warning' || weeklyWindow?.status === 'warning'
    ? 'warning'
    : 'ok';

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
        <Cpu size={14} className="text-purple-400" />
        <span className="text-xs font-semibold text-text">Claude Code</span>
      </div>

      {/* 5-Hour Window */}
      {fiveHourWindow && (
        <QuotaProgressBar
          label={`5h: ${fiveHourWindow.resetInSeconds !== undefined ? formatDuration(fiveHourWindow.resetInSeconds) : '?'}`}
          value={fiveHourWindow.utilizationPercent}
          max={100}
          displayValue={`${Math.round(fiveHourWindow.utilizationPercent)}%`}
          status={fiveHourWindow.status}
          color="blue"
          size="sm"
        />
      )}

      {/* Weekly Window */}
      {weeklyWindow && (
        <QuotaProgressBar
          label={`1w: ${weeklyWindow.resetInSeconds !== undefined ? formatDuration(weeklyWindow.resetInSeconds) : '?'}`}
          value={weeklyWindow.utilizationPercent}
          max={100}
          displayValue={`${Math.round(weeklyWindow.utilizationPercent)}%`}
          status={weeklyWindow.status}
          color="amber"
          size="sm"
        />
      )}
    </div>
  );
};
