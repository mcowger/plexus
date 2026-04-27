import React from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import type { QuotaCheckerInfo, Meter } from '../../types/quota';
import { getCheckerDisplayName } from './checker-presentation';
import { AllowanceMeterRow } from './AllowanceMeterRow';

interface CompactQuotasCardProps {
  allowanceQuotas: QuotaCheckerInfo[];
}

function getAllowanceMeters(meters: Meter[]): Meter[] {
  return meters.filter((m) => m.kind === 'allowance');
}

export const CompactQuotasCard: React.FC<CompactQuotasCardProps> = ({ allowanceQuotas }) => {
  const navigate = useNavigate();

  if (allowanceQuotas.length === 0) return null;

  return (
    <div
      className="px-2 py-1 space-y-1 cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={() => navigate('/quotas')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/quotas');
        }
      }}
    >
      {allowanceQuotas.map((quota, idx) => {
        const displayName = getCheckerDisplayName(quota.checkerType, quota.checkerId);
        const allowanceMeters = getAllowanceMeters(quota.meters);
        const isLast = idx === allowanceQuotas.length - 1;

        if (!quota.success) {
          return (
            <div
              key={quota.checkerId}
              className={clsx(
                'flex items-center gap-2 min-w-0 py-1',
                !isLast && 'border-b border-border pb-1.5'
              )}
            >
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <AlertTriangle className="w-3 h-3 text-danger flex-shrink-0" />
            </div>
          );
        }

        if (allowanceMeters.length === 0) {
          return (
            <div
              key={quota.checkerId}
              className={clsx(
                'flex items-center gap-2 min-w-0 py-1',
                !isLast && 'border-b border-border pb-1.5'
              )}
            >
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <span className="text-[11px] text-text-muted">—</span>
            </div>
          );
        }

        // Show the service name once, then stack all allowance meters below it
        return (
          <div
            key={quota.checkerId}
            className={clsx('py-1', !isLast && 'border-b border-border pb-1.5')}
          >
            <span className="text-[11px] text-text-muted pl-0 block truncate mb-0.5">
              {displayName}
            </span>
            <div className="space-y-px">
              {allowanceMeters.map((meter) => (
                <AllowanceMeterRow key={meter.key} meter={meter} compact />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
