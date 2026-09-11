/**
 * @file EntityRow.tsx
 *
 * Compact stat row for a single provider or model entity.
 * Used in both the inline "stats" card and its expanded modal view.
 */

import React from 'react';
import { Cpu, Server } from 'lucide-react';
import { useCurrency } from '../../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatNumber } from '../../../lib/format';
import type { EntityStats } from '../liveTypes';

export interface EntityRowProps {
  entity: EntityStats;
  isModel?: boolean;
}

export const EntityRow: React.FC<EntityRowProps> = ({ entity, isModel }) => {
  const { currency, rate, symbol } = useCurrency();

  return (
    <div className="rounded-md border border-border-glass bg-bg-glass/50 px-3 py-2 hover:bg-bg-glass transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {isModel ? (
            <Cpu size={14} className="text-text-muted shrink-0" />
          ) : (
            <Server size={14} className="text-text-muted shrink-0" />
          )}
          <span className="text-sm text-text font-medium truncate" title={entity.name}>
            {entity.name.length > 25 ? entity.name.slice(0, 22) + '...' : entity.name}
          </span>
        </div>
        <span className="text-xs text-text-secondary">{formatNumber(entity.requests, 0)} req</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span>
          Success:{' '}
          {entity.successRate >= 95 ? (
            <span className="text-emerald-500 font-medium">{entity.successRate.toFixed(1)}%</span>
          ) : entity.successRate >= 80 ? (
            <span className="text-amber-500 font-medium">{entity.successRate.toFixed(1)}%</span>
          ) : (
            <span className="text-red-500 font-medium">{entity.successRate.toFixed(1)}%</span>
          )}
        </span>
        <span>Latency: {formatMs(entity.avgLatency)}</span>
        <span>Cost: {formatCostIn(entity.cost, { currency, rate, symbol, decimals: 4 })}</span>
        <span>TPS: {formatNumber(entity.avgTps, 1)}</span>
      </div>
    </div>
  );
};
