import React from 'react';
import type { LiveRequestSnapshot } from '../../../../lib/api';
import { formatTokens, formatCost, formatMs, formatTPS, formatTimeAgo } from '../../../../lib/format';

interface LiveRequestListProps {
  requests: LiveRequestSnapshot[];
  maxItems?: number;
}

const getStatusTone = (status: string): string => {
  const normalized = status.toLowerCase();
  if (normalized === 'success') {
    return 'text-success bg-emerald-500/15 border border-success/25';
  }
  if (normalized === 'unknown') {
    return 'text-text-secondary bg-bg-hover border border-border-glass';
  }
  return 'text-danger bg-red-500/15 border border-danger/30';
};

export const LiveRequestList: React.FC<LiveRequestListProps> = ({
  requests,
  maxItems = 20
}) => {
  const displayRequests = requests.slice(0, maxItems);

  if (requests.length === 0) {
    return (
      <div className="py-8 text-sm text-text-secondary text-center">
        No requests observed yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
      {displayRequests.map((request) => (
        <div key={request.requestId} className="rounded-md border border-border-glass bg-bg-glass p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text font-medium">{request.provider}</span>
              <span className="text-xs text-text-secondary">{request.model}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-md ${getStatusTone(request.responseStatus)}`}>
                {request.responseStatus}
              </span>
            </div>
            <span className="text-xs text-text-muted">
              {formatTimeAgo(Math.max(0, Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)))}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>Tokens: {formatTokens(request.totalTokens)}</span>
            <span>Cost: {formatCost(request.costTotal, 6)}</span>
            <span>Latency: {formatMs(request.durationMs)}</span>
            <span>TTFT: {formatMs(request.ttftMs)}</span>
            <span>TPS: {formatTPS(request.tokensPerSec)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
