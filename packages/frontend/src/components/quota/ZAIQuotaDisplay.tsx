import React from 'react';
import { clsx } from 'clsx';
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface ZAIQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const ZAIQuotaDisplay: React.FC<ZAIQuotaDisplayProps> = ({
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
  const tokensWindow = windows.find(w => w.windowType === 'five_hour');
  const mcpWindow = windows.find(w => w.windowType === 'monthly');
  const overallStatus = tokensWindow?.status || 'ok';

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
      <div className="flex items-center gap-2 min-w-0">
        <Zap size={14} className="text-warning" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">ZAI</span>
      </div>

      {tokensWindow && tokensWindow.limit && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">5h:</span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  barColorForStatus(tokensWindow.status, 'bg-emerald-400')
                )}
                style={{ width: `${Math.min(100, Math.max(0, tokensWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-emerald-400">
              {Math.round(tokensWindow.utilizationPercent)}%
            </div>
          </div>
        </div>
      )}

      {mcpWindow && mcpWindow.limit && (
        <div className="flex items-center gap-2 text-[10px] text-text-secondary">
          <span className="text-text-secondary">MCP</span>
          <div className="relative flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
            <div
              className={clsx(
                'absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out',
                barColorForStatus(mcpWindow.status, 'bg-info')
              )}
              style={{ width: `${Math.min(100, Math.max(0, mcpWindow.utilizationPercent))}%` }}
            />
          </div>
          <span className="text-text">{Math.round(mcpWindow.utilizationPercent)}%</span>
        </div>
      )}
    </div>
  );
};
