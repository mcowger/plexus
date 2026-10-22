import { clsx } from 'clsx';
import { AlertTriangle, RefreshCw, Wallet } from 'lucide-react';
import React, { useState } from 'react';

import { toTitleCase } from '../../lib/format';
import type { Meter, QuotaCheckerInfo } from '../../types/quota';
import { Button } from '../ui/Button';
import { BalanceMeterRow } from './BalanceMeterRow';
import { getCheckerDisplayName } from './checker-presentation';
import { MeterHistoryModal } from './MeterHistoryModal';
import { StaleReadingNotice } from './StaleReadingNotice';

interface CombinedBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  onRefresh: (checkerId: string) => void;
  refreshing: Set<string>;
  displayNameMap?: Map<string, string>;
}

export const CombinedBalancesCard: React.FC<CombinedBalancesCardProps> = ({
  balanceQuotas,
  onRefresh,
  refreshing,
  displayNameMap,
}) => {
  const [historyTarget, setHistoryTarget] = useState<{
    quota: QuotaCheckerInfo;
    meter: Meter;
    displayName: string;
  } | null>(null);

  if (balanceQuotas.length === 0) return null;

  const midPoint = Math.ceil(balanceQuotas.length / 2);
  const shouldSplit = balanceQuotas.length > 3;
  const leftColumn = shouldSplit ? balanceQuotas.slice(0, midPoint) : balanceQuotas;
  const rightColumn = shouldSplit ? balanceQuotas.slice(midPoint) : [];

  const renderRow = (quota: QuotaCheckerInfo) => {
    const displayName = getCheckerDisplayName(quota.checkerType, quota.checkerId, displayNameMap);
    const balanceMeters = quota.meters.filter((m) => m.kind === 'balance');

    return (
      <div
        key={quota.checkerId}
        className="hover:bg-bg-hover flex flex-col gap-3 px-3 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-4"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Wallet size={14} className="text-info flex-shrink-0" />
            <span className="text-text text-sm font-semibold">{toTitleCase(quota.checkerId)}</span>
          </div>
          <div className="text-text-muted truncate pl-5 text-xs">
            {displayName}
            {quota.oauthAccountId && ` • Account: ${quota.oauthAccountId}`}
          </div>
        </div>

        <div className="min-w-0 px-0 sm:px-4">
          {!quota.success ? (
            <div className="text-danger flex items-center gap-2">
              <AlertTriangle size={14} />
              <span className="text-xs">Error</span>
            </div>
          ) : balanceMeters.length > 0 ? (
            <div>
              {quota.stale && <StaleReadingNotice error={quota.error} className="mb-1" />}
              {balanceMeters.map((meter) => (
                <BalanceMeterRow
                  key={meter.key}
                  meter={meter}
                  onClick={() =>
                    setHistoryTarget({
                      quota,
                      meter,
                      displayName: getCheckerDisplayName(
                        quota.checkerType,
                        quota.checkerId,
                        displayNameMap
                      ),
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <span className="text-text-muted text-xs">No data</span>
          )}
        </div>

        <div className="flex-shrink-0 self-end sm:self-auto">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRefresh(quota.checkerId)}
            disabled={refreshing.has(quota.checkerId)}
            className="h-7 w-7 p-0"
          >
            <RefreshCw
              size={14}
              className={clsx(refreshing.has(quota.checkerId) && 'animate-spin')}
            />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="bg-bg-card border-border overflow-hidden rounded-lg border">
        <div className="bg-bg-subtle border-border flex items-center gap-2 border-b px-4 py-3">
          <Wallet size={18} className="text-info" />
          <h3 className="font-heading text-text text-base font-semibold">Account Balances</h3>
        </div>

        <div
          className={clsx('grid gap-0', shouldSplit ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}
        >
          <div className="divide-border divide-y">{leftColumn.map(renderRow)}</div>
          {rightColumn.length > 0 && (
            <div className="divide-border border-border divide-y lg:border-l">
              {rightColumn.map(renderRow)}
            </div>
          )}
        </div>
      </div>

      {historyTarget && (
        <MeterHistoryModal
          isOpen
          onClose={() => setHistoryTarget(null)}
          quota={historyTarget.quota}
          meter={historyTarget.meter}
          displayName={historyTarget.displayName}
        />
      )}
    </>
  );
};
