/**
 * @file RequestsModal.tsx
 *
 * Full-height scrollable list view of all requests matching the active filter.
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
    <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
      {filteredLiveRequests.length === 0 ? (
        <div className="text-text-secondary flex h-full items-center justify-center">
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
              className="border-border-glass bg-bg-glass rounded-md border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-text text-base font-medium">{providerLabel}</span>
                  <span className="text-text-secondary text-sm">{modelLabel}</span>
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
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
                <span className="text-text-muted text-sm">{formatTimeAgo(requestTimeSeconds)}</span>
              </div>
              <div className="text-text-secondary mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
