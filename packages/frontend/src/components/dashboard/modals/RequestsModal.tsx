/**
 * @file RequestsModal.tsx
 *
 * Full-height scrollable list view of all requests matching the active filter.
 */

import React from 'react';
import { Ban, CheckCircle, Plane, Timer, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useCurrency } from '../../../lib/CurrencyContext';
import {
  formatCostIn,
  formatMs,
  formatTimeAgo,
  formatTokens,
  formatTPS,
} from '../../../lib/format';
import type { UsageRecord } from '../../../lib/api';
import { getModelLabel, getProviderLabel } from '../liveUtils';

export interface RequestsModalProps {
  liveRequests: UsageRecord[];
  filteredLiveRequests: UsageRecord[];
}

export const RequestsModal: React.FC<RequestsModalProps> = ({
  liveRequests,
  filteredLiveRequests,
}) => {
  const { currency, rate, symbol } = useCurrency();

  return (
    <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
      {filteredLiveRequests.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-secondary">
          {liveRequests.length === 0
            ? 'No requests observed yet.'
            : 'No requests match the current filter.'}
        </div>
      ) : (
        filteredLiveRequests.map((request) => {
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
              className="rounded-md border border-border-glass bg-bg-glass p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base text-text font-medium">{providerLabel}</span>
                  <span className="text-sm text-text-secondary">{modelLabel}</span>
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border',
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
                      <CheckCircle size={11} />
                    ) : status === 'pending' ? (
                      <Plane size={11} className="animate-pulse" />
                    ) : status === 'cancelled' ? (
                      <Ban size={11} />
                    ) : status === 'timeout' ? (
                      <Timer size={11} />
                    ) : (
                      <XCircle size={11} />
                    )}
                    {status}
                  </span>
                </div>
                <span className="text-sm text-text-muted">{formatTimeAgo(requestTimeSeconds)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
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
        })
      )}
    </div>
  );
};
