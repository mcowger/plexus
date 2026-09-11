/**
 * @file AlertsCard.tsx
 *
 * Draggable card showing active provider cooldowns and top provider activity.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatMsToMinSec, INDEFINITE_COOLDOWN_THRESHOLD_MS } from '@plexus/shared';
import { SortableCard } from '../../ui/SortableCard';
import { useCurrency } from '../../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatNumber } from '../../../lib/format';
import type { Cooldown } from '../../../lib/api';
import { normalizeTelemetryLabel } from '../liveUtils';
import { CooldownRow } from './CooldownRow';

export interface AlertsCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  cooldowns: Cooldown[];
  groupedCooldowns: Record<string, Cooldown[]>;
  providerRows: {
    provider: string;
    requests: number;
    successRate: number;
    avgLatency: number;
    totalCost: number;
  }[];
  liveWindowMinutes: number;
  isAdmin: boolean;
  onClearCooldowns: () => Promise<void>;
  onClearSingleCooldown: (provider: string, model?: string) => Promise<void>;
}

export const AlertsCard: React.FC<AlertsCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  cooldowns,
  groupedCooldowns,
  providerRows,
  liveWindowMinutes,
  isAdmin,
  onClearCooldowns,
  onClearSingleCooldown,
}) => {
  const { currency, rate, symbol } = useCurrency();

  return (
    <SortableCard
      key="sortable-alerts"
      card={{
        id: 'alerts',
        title: 'Alerts & Providers',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <AlertTriangle
              size={15}
              className={cooldowns.length > 0 ? 'text-warning' : 'text-text-muted'}
            />
            {cooldowns.length > 0 && isAdmin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void onClearCooldowns();
                }}
                className="text-[11px] text-warning hover:text-warning/80 transition-colors cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content: (
          <div className="h-48 sm:h-56 flex flex-col overflow-hidden">
            {cooldowns.length > 0 && (
              <div className="divide-y divide-border border-b border-warning/30 bg-warning/5 max-h-30 overflow-y-auto">
                {Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
                  const [provider, model] = key.split(':');
                  const maxTime = Math.max(...modelCooldowns.map((c) => c.timeRemainingMs));
                  const representative = modelCooldowns.reduce((a, b) =>
                    a.timeRemainingMs >= b.timeRemainingMs ? a : b
                  );
                  const timeDisplay = formatMsToMinSec(maxTime, representative.lastError);
                  const isIndefinite =
                    representative.timeRemainingMs >= INDEFINITE_COOLDOWN_THRESHOLD_MS;
                  const lastErr = representative.lastError?.toLowerCase() ?? '';
                  const expiryStr = isIndefinite
                    ? lastErr.includes('balance') ||
                      lastErr.includes('credit') ||
                      lastErr.includes('payment') ||
                      lastErr.includes('account')
                      ? 'Until positive balance'
                      : 'Until reset'
                    : new Date(representative.expiry).toLocaleString();
                  return (
                    <CooldownRow
                      key={key}
                      provider={normalizeTelemetryLabel(provider) || 'Unknown'}
                      modelDisplay={model || 'all models'}
                      timeDisplay={timeDisplay}
                      consecutiveFailures={representative.consecutiveFailures}
                      lastError={representative.lastError}
                      expiryStr={expiryStr}
                      onClear={() => void onClearSingleCooldown(provider, model)}
                    />
                  );
                })}
              </div>
            )}
            <div className="flex-1 divide-y divide-border overflow-y-auto">
              {providerRows.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-muted">
                  No provider activity in the last {liveWindowMinutes} minutes.
                </div>
              ) : (
                providerRows.map((row) => (
                  <div key={row.provider} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text">{row.provider}</span>
                      <span className="text-xs text-text-muted tabular-nums">
                        {formatNumber(row.requests, 0)} req
                      </span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-[11px] text-text-muted">
                      <span>{row.successRate.toFixed(1)}% ok</span>
                      <span>{formatMs(row.avgLatency)}</span>
                      <span className="text-info">
                        {formatCostIn(row.totalCost, {
                          currency,
                          rate,
                          symbol,
                          decimals: 6,
                        })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
