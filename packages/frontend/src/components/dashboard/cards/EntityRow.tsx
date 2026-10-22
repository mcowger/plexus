/**
 * @file EntityRow.tsx
 *
 * Compact stat row for a single provider or model entity.
 * Used in both the inline "stats" card and its expanded modal view.
 */

import { Cpu, Server } from 'lucide-react';
import React from 'react';

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
    <div className="border-border-glass bg-bg-glass/50 hover:bg-bg-glass rounded-md border px-3 py-2 transition-colors">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isModel ? (
            <Cpu size={14} className="text-text-muted shrink-0" />
          ) : (
            <Server size={14} className="text-text-muted shrink-0" />
          )}
          <span className="text-text truncate text-sm font-medium" title={entity.name}>
            {entity.name.length > 25 ? entity.name.slice(0, 22) + '...' : entity.name}
          </span>
        </div>
        <span className="text-text-secondary text-xs">{formatNumber(entity.requests, 0)} req</span>
      </div>
      <div className="text-text-secondary flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>
          Success:{' '}
          {entity.successRate >= 95 ? (
            <span className="font-medium text-emerald-500">{entity.successRate.toFixed(1)}%</span>
          ) : entity.successRate >= 80 ? (
            <span className="font-medium text-amber-500">{entity.successRate.toFixed(1)}%</span>
          ) : (
            <span className="font-medium text-red-500">{entity.successRate.toFixed(1)}%</span>
          )}
        </span>
        <span>Latency: {formatMs(entity.avgLatency)}</span>
        <span>Cost: {formatCostIn(entity.cost, { currency, rate, symbol, decimals: 4 })}</span>
        <span>TPS: {formatNumber(entity.avgTps, 1)}</span>
      </div>
    </div>
  );
};
