import React from 'react';
import { clsx } from 'clsx';
import { CreditCard, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { QuotaCheckResult } from '../../types/quota';

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
  const window = windows.find((w) => w.windowType === 'monthly');
  const remaining = window?.remaining ?? 0;
  const limit = window?.limit ?? 0;
  const used = window?.used ?? 0;
  const hasQuota = remaining > 0;

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        {hasQuota ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <AlertTriangle size={18} className="text-danger" />
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
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-text-secondary">Monthly Credits</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-text-secondary">
          Used: <span className="font-semibold">${used.toFixed(2)}</span>
        </span>
        <span className="text-text-muted">/</span>
        <span className="text-xs font-semibold">${limit.toFixed(2)}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-text-secondary">
          Remaining:{' '}
          <span className={clsx('font-semibold', hasQuota ? 'text-success' : 'text-danger')}>
            ${remaining.toFixed(2)}
          </span>
        </span>
        <span className="text-xs text-text-muted">
          ({limit > 0 ? Math.round((remaining / limit) * 100) : 0}%)
        </span>
      </div>
    </div>
  );
};
