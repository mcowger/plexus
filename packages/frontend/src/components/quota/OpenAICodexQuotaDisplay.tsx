import React from 'react';
import { clsx } from 'clsx';
import { Bot, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { QuotaProgressBar } from './QuotaProgressBar';
import { formatDuration } from '../../lib/format';
import type { QuotaCheckResult } from '../../types/quota';

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
  const orderedWindows = [...windows].sort((a, b) => {
    const order = (windowType?: string): number => {
      if (windowType === 'five_hour') return 0;
      if (windowType === 'weekly') return 1;
      return 2;
    };
    return order(a.windowType) - order(b.windowType);
  });

  const statusRank: Record<string, number> = {
    ok: 0,
    warning: 1,
    critical: 2,
    exhausted: 3,
  };

  const overallStatus = orderedWindows.reduce((acc, window) => {
    const next = window.status || 'ok';
    return statusRank[next] > statusRank[acc] ? next : acc;
  }, 'ok');

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
      <div className="flex items-center gap-2">
        <Bot size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-text">OpenAI Codex</span>
      </div>

      {orderedWindows.map((window, index) => {
        const labelBase = window.windowType === 'five_hour'
          ? '5h Usage'
          : window.windowType === 'weekly'
            ? 'Weekly Usage'
            : 'Code Review Usage';

        return (
          <QuotaProgressBar
            key={`${window.windowType}-${index}`}
            label={`${labelBase}${window.resetInSeconds !== undefined && window.resetInSeconds !== null ? `: ${formatDuration(window.resetInSeconds)}` : ''}`}
            value={window.used || 0}
            max={window.limit || 100}
            displayValue={`${Math.round(window.utilizationPercent)}%`}
            status={window.status}
            color="purple"
            size="sm"
          />
        );
      })}
    </div>
  );
};
