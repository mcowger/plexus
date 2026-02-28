import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import type { QuotaCheckResult } from '../../types/quota';
import { QuotaProgressBar } from './QuotaProgressBar';

interface AntigravityQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const AntigravityQuotaDisplay: React.FC<AntigravityQuotaDisplayProps> = ({
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
  const primaryWindow = windows[0];

  if (isCollapsed) {
    const status = primaryWindow?.status || 'ok';
    return (
      <div className="px-2 py-2 flex justify-center">
        {status === 'ok' ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <AlertTriangle
            size={18}
            className={clsx(status === 'warning' ? 'text-warning' : 'text-danger')}
          />
        )}
      </div>
    );
  }

  if (windows.length === 0) {
    return (
      <div className="px-2 py-2 flex items-center gap-2 text-text-secondary">
        <TrendingUp size={16} />
        <span className="text-xs italic">No quota data</span>
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-3">
      {windows.map((window, index) => (
        <QuotaProgressBar
          key={index}
          label={window.windowLabel || `Window ${index + 1}`}
          value={window.used ?? 0}
          max={window.limit ?? 100}
          status={window.status}
          displayValue={
            window.unit === 'percentage'
              ? `${Math.round(window.utilizationPercent ?? 0)}%`
              : undefined
          }
        />
      ))}
    </div>
  );
};
