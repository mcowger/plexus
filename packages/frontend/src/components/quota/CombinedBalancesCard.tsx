import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { toTitleCase } from '../../lib/format';
import type { QuotaCheckerInfo, Meter } from '../../types/quota';
import { Button } from '../ui/Button';
import { getCheckerDisplayName } from './checker-presentation';
import { BalanceMeterRow } from './BalanceMeterRow';
import { MeterHistoryModal } from './MeterHistoryModal';

interface CombinedBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  onRefresh: (checkerId: string) => void;
  refreshing: Set<string>;
}

export const CombinedBalancesCard: React.FC<CombinedBalancesCardProps> = ({
  balanceQuotas,
  onRefresh,
  refreshing,
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
    const displayName = getCheckerDisplayName(quota.checkerType, quota.checkerId);
    const balanceMeters = quota.meters.filter((m) => m.kind === 'balance');

    return (
      <div
        key={quota.checkerId}
        className="px-4 py-3 flex items-center justify-between hover:bg-bg-hover transition-colors"
      >
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wallet size={14} className="text-info flex-shrink-0" />
            <span className="text-sm font-semibold text-text">{toTitleCase(quota.checkerId)}</span>
          </div>
          <div className="text-xs text-text-muted pl-5 truncate">
            {displayName}
            {quota.oauthAccountId && ` • Account: ${quota.oauthAccountId}`}
          </div>
        </div>

        <div className="flex flex-col gap-0.5 px-4 min-w-0">
          {!quota.success ? (
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle size={14} />
              <span className="text-xs">Error</span>
            </div>
          ) : balanceMeters.length > 0 ? (
            balanceMeters.map((meter) => (
              <BalanceMeterRow
                key={meter.key}
                meter={meter}
                onClick={() =>
                  setHistoryTarget({
                    quota,
                    meter,
                    displayName: getCheckerDisplayName(quota.checkerType, quota.checkerId),
                  })
                }
              />
            ))
          ) : (
            <span className="text-xs text-text-muted">No data</span>
          )}
        </div>

        <div className="flex-shrink-0">
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
      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center gap-2">
          <Wallet size={18} className="text-info" />
          <h3 className="font-heading text-base font-semibold text-text">Account Balances</h3>
        </div>

        <div
          className={clsx('grid gap-0', shouldSplit ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}
        >
          <div className="divide-y divide-border">{leftColumn.map(renderRow)}</div>
          {rightColumn.length > 0 && (
            <div className="divide-y divide-border lg:border-l border-border">
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
