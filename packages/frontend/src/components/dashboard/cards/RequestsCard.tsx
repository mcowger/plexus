/**
 * @file RequestsCard.tsx
 *
 * Draggable card rendering the latest 20 requests with status badges, tokens,
 * cost, and latency metrics, plus quick filter toggles.
 */

import { clsx } from 'clsx';
import { Ban, CheckCircle, Plane, Timer, XCircle } from 'lucide-react';
import React from 'react';

import type { UsageRecord } from '../../../lib/api';
import { useCurrency } from '../../../lib/CurrencyContext';
import {
  formatCostIn,
  formatMs,
  formatTimeAgo,
  formatTokens,
  formatTPS,
} from '../../../lib/format';
import { AnalyzeButton } from '../../analytics/AnalyzeButton';
import { Button } from '../../ui/Button';
import { SortableCard } from '../../ui/SortableCard';
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
            <span className="text-text-secondary mr-1 hidden text-xs sm:inline">Latest 20</span>
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
            <div className="text-text-secondary flex h-48 items-center justify-center sm:h-56">
              {liveRequests.length === 0
                ? 'No requests observed yet.'
                : 'No requests match the current filter.'}
            </div>
          ) : (
            <div className="h-48 space-y-2 overflow-y-auto pr-1 sm:h-56">
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
                    className="border-border-glass bg-bg-glass rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text text-sm font-medium">{providerLabel}</span>
                        <span className="text-text-secondary text-xs">{modelLabel}</span>
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
                            status === 'success'
                              ? 'text-success border-success/25 bg-emerald-500/15'
                              : status === 'pending'
                                ? 'text-warning border-warning/25 bg-yellow-500/15'
                                : status === 'cancelled'
                                  ? 'border-blue-400/25 bg-blue-500/15 text-blue-400'
                                  : status === 'timeout'
                                    ? 'border-orange-400/25 bg-orange-500/15 text-orange-400'
                                    : 'text-danger border-danger/30 bg-red-500/15'
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
                      <span className="text-text-muted text-xs">
                        {formatTimeAgo(requestTimeSeconds)}
                      </span>
                    </div>
                    <div className="text-text-secondary mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
