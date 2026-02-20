import React from 'react';
import { clsx } from 'clsx';
import { CreditCard, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDuration, formatCost } from '../../lib/format';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface WisdomGateQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const WisdomGateQuotaDisplay: React.FC<WisdomGateQuotaDisplayProps> = ({
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
  const monthlyWindow = windows.find((w) => w.windowType === 'monthly');

  const statusColors: Record<QuotaStatus, string> = {
    ok: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-danger',
    exhausted: 'bg-danger',
  };

  const overallStatus = monthlyWindow?.status || 'ok';

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        {overallStatus === 'ok' ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <AlertTriangle size={18} className={clsx(
            overallStatus === 'warning' ? 'text-warning' : 'text-danger'
          )} />
        )}
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <CreditCard size={14} className="text-text" />
        <span className="text-xs font-semibold text-text whitespace-nowrap">Wisdom Gate</span>
      </div>

      {monthlyWindow && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">Monthly</span>
            {monthlyWindow.resetInSeconds !== undefined && monthlyWindow.resetInSeconds !== null && (
              <span className="text-[10px] text-text-muted">
                {formatDuration(monthlyWindow.resetInSeconds)}
              </span>
            )}
          </div>
          
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden mr-7">
              <div
                className={clsx(
                  'h-full rounded-md transition-all duration-500 ease-out',
                  statusColors[monthlyWindow.status || 'ok']
                )}
                style={{ width: `${Math.min(100, Math.max(0, monthlyWindow.utilizationPercent))}%` }}
              />
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center text-[10px] font-semibold text-text">
              {formatCost(monthlyWindow.used ?? 0)} / {formatCost(monthlyWindow.limit ?? 0)}
            </div>
          </div>
          
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-secondary">Remaining:</span>
            <span className="text-xs font-semibold text-success">
              {formatCost(monthlyWindow.remaining ?? 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
