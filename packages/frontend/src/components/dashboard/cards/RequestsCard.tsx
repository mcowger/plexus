/**
 * @file RequestsCard.tsx
 *
 * Draggable card rendering the latest 20 requests with status badges, tokens,
 * cost, and latency metrics, plus quick filter toggles.
 */

import React from 'react';
import { Ban, CheckCircle, Plane, Timer, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { SortableCard } from '../../ui/SortableCard';
import { Button } from '../../ui/Button';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { useCurrency } from '../../../lib/CurrencyContext';
import {
  formatCostIn,
  formatMs,
  formatTimeAgo,
  formatTokens,
  formatTPS,
} from '../../../lib/format';
import type { UsageRecord } from '../../../lib/api';
import type { StreamFilter } from '../liveTypes';
import { getModelLabel, getProviderLabel } from '../liveUtils';

export interface RequestsCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  onAnalyze?: () => void;
  streamFilter: StreamFilter;
  onFilterChange: (filter: StreamFilter) => void;
  liveRequests: UsageRecord[];
  filteredLiveRequests: UsageRecord[];
}

export const RequestsCard: React.FC<RequestsCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  onAnalyze,
  streamFilter,
  onFilterChange,
  liveRequests,
  filteredLiveRequests,
}) => {
  const { currency, rate, symbol } = useCurrency();

  return (
    <SortableCard
      key="sortable-requests"
      card={{
        id: 'requests',
        title: 'Latest Requests',
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        extra: (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <span className="hidden text-xs text-text-secondary mr-1 sm:inline">Latest 20</span>
            <Button
              size="sm"
              variant={streamFilter === 'all' ? 'primary' : 'secondary'}
              onClick={(event) => {
                event.stopPropagation();
                onFilterChange('all');
              }}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={streamFilter === 'success' ? 'primary' : 'secondary'}
              onClick={(event) => {
                event.stopPropagation();
                onFilterChange('success');
              }}
            >
              Success
            </Button>
            <Button
              size="sm"
              variant={streamFilter === 'error' ? 'primary' : 'secondary'}
              onClick={(event) => {
                event.stopPropagation();
                onFilterChange('error');
              }}
            >
              Errors
            </Button>
            <AnalyzeButton cardType="requests" size="sm" onClick={onAnalyze} />
          </div>
        ),
        content:
          filteredLiveRequests.length === 0 ? (
            <div className="h-48 sm:h-56 flex items-center justify-center text-text-secondary">
              {liveRequests.length === 0
                ? 'No requests observed yet.'
                : 'No requests match the current filter.'}
            </div>
          ) : (
            <div className="h-48 sm:h-56 space-y-2 overflow-y-auto pr-1">
              {filteredLiveRequests.slice(0, 20).map((request) => {
                const requestTimeSeconds = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)
                );
                const status = (request.responseStatus || 'errored').toLowerCase();
                const providerLabel = getProviderLabel(request);
                const modelLabel = getModelLabel(request);

                return (
                  <div
                    key={request.requestId}
                    className="rounded-md border border-border-glass bg-bg-glass p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text font-medium">{providerLabel}</span>
                        <span className="text-xs text-text-secondary">{modelLabel}</span>
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border',
                            status === 'success'
                              ? 'text-success bg-emerald-500/15 border-success/25'
                              : status === 'pending'
                                ? 'text-warning bg-yellow-500/15 border-warning/25'
                                : status === 'cancelled'
                                  ? 'text-blue-400 bg-blue-500/15 border-blue-400/25'
                                  : status === 'timeout'
                                    ? 'text-orange-400 bg-orange-500/15 border-orange-400/25'
                                    : 'text-danger bg-red-500/15 border-danger/30'
                          )}
                        >
                          {status === 'success' ? (
                            <CheckCircle size={10} />
                          ) : status === 'pending' ? (
                            <Plane size={10} className="animate-pulse" />
                          ) : status === 'cancelled' ? (
                            <Ban size={10} />
                          ) : status === 'timeout' ? (
                            <Timer size={10} />
                          ) : (
                            <XCircle size={10} />
                          )}
                          {status}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {formatTimeAgo(requestTimeSeconds)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <span>ID: {request.requestId.slice(0, 8)}...</span>
                      <span>
                        Tokens:{' '}
                        {formatTokens(
                          Number(request.tokensInput || 0) +
                            Number(request.tokensOutput || 0) +
                            Number(request.tokensCached || 0) +
                            Number(request.tokensCacheWrite || 0)
                        )}
                      </span>
                      <span>
                        Cost:{' '}
                        {formatCostIn(Number(request.costTotal || 0), {
                          currency,
                          rate,
                          symbol,
                          decimals: 6,
                        })}
                      </span>
                      <span>Latency: {formatMs(Number(request.durationMs || 0))}</span>
                      <span>TTFT: {formatMs(Number(request.ttftMs || 0))}</span>
                      <span>TPS: {formatTPS(Number(request.tokensPerSec || 0))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
