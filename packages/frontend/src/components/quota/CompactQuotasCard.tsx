import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import type { Meter, QuotaCheckerInfo } from '../../types/quota';
import { AllowanceMeterRow } from './AllowanceMeterRow';
import { getCheckerDisplayName, sortQuotaCheckersByDisplayName } from './checker-presentation';
import { getStaleReadingMessage } from './StaleReadingNotice';

interface CompactQuotasCardProps {
  allowanceQuotas: QuotaCheckerInfo[];
  displayNameMap?: Map<string, string>;
}

function getAllowanceMeters(meters: Meter[]): Meter[] {
  return meters.filter((m) => m.kind === 'allowance');
}

export const CompactQuotasCard: React.FC<CompactQuotasCardProps> = ({
  allowanceQuotas,
  displayNameMap,
}) => {
  const navigate = useNavigate();

  if (allowanceQuotas.length === 0) return null;

  const sortedQuotas = sortQuotaCheckersByDisplayName(allowanceQuotas, displayNameMap);

  return (
    <div
      className="hover:bg-bg-hover cursor-pointer space-y-1 px-2 py-1 transition-colors"
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
      {sortedQuotas.map((quota, idx) => {
        const displayName = getCheckerDisplayName(
          quota.checkerType,
          quota.checkerId,
          displayNameMap
        );
        const allowanceMeters = getAllowanceMeters(quota.meters);
        const isLast = idx === sortedQuotas.length - 1;
        const providerName = quota.provider || quota.checkerId;
        const heading = (
          <div className="min-w-0 flex-1 text-[11px]">
            <div className="text-text-muted truncate">{displayName}</div>
            <div className="text-text-secondary break-words" title={providerName}>
              {providerName}
            </div>
          </div>
        );

        if (!quota.success) {
          return (
            <div
              key={quota.checkerId}
              className={clsx(
                'flex min-w-0 items-center gap-2 py-1',
                !isLast && 'border-border border-b pb-1.5'
              )}
            >
              {heading}
              <AlertTriangle className="text-danger h-3 w-3 flex-shrink-0" />
            </div>
          );
        }

        if (allowanceMeters.length === 0) {
          return (
            <div
              key={quota.checkerId}
              className={clsx(
                'flex min-w-0 items-center gap-2 py-1',
                !isLast && 'border-border border-b pb-1.5'
              )}
            >
              {heading}
              <span className="text-text-muted text-[11px]">—</span>
            </div>
          );
        }

        // Show the service and provider once, then stack their allowance meters below.
        return (
          <div
            key={quota.checkerId}
            className={clsx('min-w-0 py-1', !isLast && 'border-border border-b pb-1.5')}
          >
            <div className="mb-0.5 flex min-w-0 items-center gap-1">
              {heading}
              {quota.stale && (
                <span
                  className="flex-shrink-0"
                  role="img"
                  title={getStaleReadingMessage(quota.error)}
                  aria-label={getStaleReadingMessage(quota.error)}
                >
                  <AlertTriangle className="text-warning h-3 w-3" aria-hidden="true" />
                </span>
              )}
            </div>
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
