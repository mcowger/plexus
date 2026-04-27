import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import type { QuotaCheckerInfo, Meter } from '../../types/quota';
import { getCheckerDisplayName } from './checker-presentation';
import { AllowanceMeterRow } from './AllowanceMeterRow';

interface CompactQuotasCardProps {
  allowanceQuotas: QuotaCheckerInfo[];
}

function primaryAllowanceMeter(meters: Meter[]): Meter | undefined {
  const allowances = meters.filter((m) => m.kind === 'allowance');
  if (allowances.length === 0) return undefined;
  // Pick the most constrained (highest utilization)
  return allowances.reduce((worst, m) => {
    const wu = typeof worst.utilizationPercent === 'number' ? worst.utilizationPercent : 0;
    const mu = typeof m.utilizationPercent === 'number' ? m.utilizationPercent : 0;
    return mu > wu ? m : worst;
  });
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
      {allowanceQuotas.map((quota) => {
        const displayName = getCheckerDisplayName(quota.checkerType, quota.checkerId);

        if (!quota.success) {
          return (
            <div key={quota.checkerId} className="flex items-center gap-2 min-w-0 py-0.5">
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <AlertTriangle className="w-3 h-3 text-danger flex-shrink-0" />
            </div>
          );
        }

        const primary = primaryAllowanceMeter(quota.meters);
        if (!primary) {
          return (
            <div key={quota.checkerId} className="flex items-center gap-2 min-w-0 py-0.5">
              <span className="text-[11px] text-text-secondary truncate flex-1">{displayName}</span>
              <span className="text-[11px] text-text-muted">—</span>
            </div>
          );
        }

        return (
          <div key={quota.checkerId} className="py-0.5">
            <span className="text-[11px] text-text-muted pl-0 block truncate mb-0.5">
              {displayName}
            </span>
            <AllowanceMeterRow meter={primary} compact />
          </div>
        );
      })}
    </div>
  );
};
