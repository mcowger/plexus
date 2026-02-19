import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatCost } from '../../lib/format';
import type { QuotaCheckerInfo } from '../../types/quota';
import { Button } from '../ui/Button';
import { BalanceHistoryModal } from './BalanceHistoryModal';

interface CombinedBalancesCardProps {
  balanceQuotas: QuotaCheckerInfo[];
  onRefresh: (checkerId: string) => void;
  refreshing: Set<string>;
  getQuotaResult: (quota: QuotaCheckerInfo) => any;
}

// Checker display names
const CHECKER_DISPLAY_NAMES: Record<string, string> = {
  'openrouter': 'OpenRouter',
  'minimax': 'MiniMax',
  'moonshot': 'Moonshot',
  'naga': 'Naga',
  'kilo': 'Kilo',
};

export const CombinedBalancesCard: React.FC<CombinedBalancesCardProps> = ({
  balanceQuotas,
  onRefresh,
  refreshing,
  getQuotaResult,
}) => {
  const [selectedQuota, setSelectedQuota] = useState<QuotaCheckerInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleRowClick = (quota: QuotaCheckerInfo) => {
    setSelectedQuota(quota);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedQuota(null);
  };

  const getDisplayName = (quota: QuotaCheckerInfo): string => {
    const checkerType = (quota.checkerType || quota.checkerId).toLowerCase();
    let normalizedType = checkerType;
    if (checkerType.includes('openrouter')) normalizedType = 'openrouter';
    else if (checkerType.includes('minimax')) normalizedType = 'minimax';
    else if (checkerType.includes('moonshot')) normalizedType = 'moonshot';
    else if (checkerType.includes('naga')) normalizedType = 'naga';
    else if (checkerType.includes('kilo')) normalizedType = 'kilo';
    return CHECKER_DISPLAY_NAMES[normalizedType] || quota.checkerId;
  };

  if (balanceQuotas.length === 0) {
    return null;
  }

  // Split balances into columns (max 2 columns)
  const midPoint = Math.ceil(balanceQuotas.length / 2);
  const shouldSplit = balanceQuotas.length > 3;
  const leftColumn = shouldSplit ? balanceQuotas.slice(0, midPoint) : balanceQuotas;
  const rightColumn = shouldSplit ? balanceQuotas.slice(midPoint) : [];

  const renderBalanceRow = (quota: QuotaCheckerInfo) => {
    const result = getQuotaResult(quota);
    const checkerType = (quota.checkerType || quota.checkerId).toLowerCase();
    
    // Normalize checker type name
    let normalizedType = checkerType;
    if (checkerType.includes('openrouter')) normalizedType = 'openrouter';
    else if (checkerType.includes('minimax')) normalizedType = 'minimax';
    else if (checkerType.includes('moonshot')) normalizedType = 'moonshot';
    else if (checkerType.includes('naga')) normalizedType = 'naga';
    else if (checkerType.includes('kilo')) normalizedType = 'kilo';

    const displayName = CHECKER_DISPLAY_NAMES[normalizedType] || quota.checkerId;
    const windows = result.windows || [];
    const subscriptionWindow = windows.find((w: any) => w.windowType === 'subscription');
    const balance = subscriptionWindow?.remaining;

    return (
      <div
        key={quota.checkerId}
        onClick={() => handleRowClick(quota)}
        className="px-4 py-3 flex items-center justify-between hover:bg-bg-hover transition-colors cursor-pointer"
      >
        {/* Left: Provider Name & Account */}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wallet size={14} className="text-info flex-shrink-0" />
            <span className="text-sm font-semibold text-text">
              {displayName}
            </span>
          </div>
          {result.oauthAccountId && (
            <div className="text-xs text-text-muted pl-5 truncate">
              Account: {result.oauthAccountId}
            </div>
          )}
        </div>

        {/* Center: Balance or Error */}
        <div className="flex items-center gap-3 px-4">
          {!result.success ? (
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle size={14} />
              <span className="text-xs">Error</span>
            </div>
          ) : balance !== undefined ? (
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-text-secondary">Balance</span>
              <span className="text-base font-semibold text-info tabular-nums">
                {formatCost(balance)}
              </span>
            </div>
          ) : (
            <span className="text-xs text-text-muted">No data</span>
          )}
        </div>

        {/* Right: Refresh Button */}
        <div className="flex-shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(quota.checkerId);
            }}
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
        {/* Header */}
        <div className="px-4 py-3 bg-bg-subtle border-b border-border flex items-center gap-2">
          <Wallet size={18} className="text-info" />
          <h3 className="font-heading text-base font-semibold text-text">Account Balances</h3>
        </div>

        {/* Balance Grid - max 2 columns */}
        <div className={clsx(
          "grid gap-0",
          shouldSplit ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
        )}>
          {/* Left Column */}
          <div className="divide-y divide-border">
            {leftColumn.map((quota) => renderBalanceRow(quota))}
          </div>

          {/* Right Column */}
          {rightColumn.length > 0 && (
            <div className="divide-y divide-border lg:border-l border-border">
              {rightColumn.map((quota) => renderBalanceRow(quota))}
            </div>
          )}
        </div>
      </div>

      <BalanceHistoryModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        quota={selectedQuota}
        displayName={selectedQuota ? getDisplayName(selectedQuota) : ''}
      />
    </>
  );
};
