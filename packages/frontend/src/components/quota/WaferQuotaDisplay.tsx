import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import type { QuotaCheckResult, QuotaWindow } from '../../types/quota';
import { QuotaProgressBar } from './QuotaProgressBar';
import { formatNumber } from '../../lib/format';

interface WaferQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const WaferQuotaDisplay: React.FC<WaferQuotaDisplayProps> = ({ result, isCollapsed }) => {
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
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-semibold text-text whitespace-nowrap">Wafer</span>
      </div>
      {windows.map((window: QuotaWindow, index: number) => (
        <QuotaProgressBar
          key={index}
          label={window.windowLabel || 'Requests'}
          value={window.used ?? 0}
          max={window.limit ?? 100}
          status={window.status}
          displayValue={
            window.unit === 'requests'
              ? `${formatNumber(window.used ?? 0)} / ${formatNumber(window.limit ?? 0)}`
              : typeof window.utilizationPercent === 'number'
                ? `${Math.round(window.utilizationPercent)}%`
                : `${window.utilizationPercent}`
          }
        />
      ))}
    </div>
  );
};
