import { clsx } from 'clsx';
import {
  AlertTriangle,
  Ban,
  BrainCog,
  Bug,
  CheckCircle,
  Coins,
  Gauge,
  KeyRound,
  MessagesSquare,
  Plane,
  Timer,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import React from 'react';

import { formatLargeNumber } from '../../lib/api';
import { formatApiTypeLabel } from '../../lib/apiFormats';
import { useCurrency } from '../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatTPS, getEstimatedBytesPerToken } from '../../lib/format';
import { Button } from '../ui/Button';
import { ApiTypeIcon } from './ApiTypeIcon';
import {
  formatDateSafely,
  formatReasoningEffort,
  getAttemptIndicatorLabel,
  getServiceTierDisplay,
  hasUpstreamRewrite,
} from './helpers';
import { ServiceTierIndicator } from './ServiceTierIndicator';
import type { LogRowProps } from './types';

export const MobileLogRow = React.memo(
  ({
    log,
    isNewest,
    liveNow,
    progress,
    onError,
    onDebug,
    onRetryDetails,
  }: LogRowProps & { onRetryDetails?: (log: LogRowProps['log']) => void }) => {
    const { currency, rate, symbol } = useCurrency();
    const formatted = formatDateSafely(log.date);
    const totalTokens =
      Number(log.tokensInput || 0) +
      Number(log.tokensOutput || 0) +
      Number(log.tokensCached || 0) +
      Number(log.tokensCacheWrite || 0) +
      Number(log.tokensReasoning || 0);
    const e2eOutputTokens = Number(log.tokensOutput || 0) + Number(log.tokensReasoning || 0);
    const status = log.responseStatus || (log.hasError ? 'error' : 'unknown');
    const rawDurationMs =
      log.durationMs != null && log.durationMs > 0
        ? log.durationMs
        : status === 'pending' && liveNow != null
          ? liveNow - log.startTime
          : null;
    const mobileDuration = rawDurationMs != null ? formatMs(rawDurationMs) : '-';
    const estimatedTokensPerSec = (() => {
      if (!progress) return null;

      const semanticBytesReceived = progress.semanticBytesReceived ?? progress.bytesReceived;
      const semanticBytesPerSec = progress.semanticBytesPerSec ?? progress.bytesPerSec;
      const bytesPerToken = getEstimatedBytesPerToken({
        ...log,
        isStreamed: progress.isStreamed,
      });
      const effectiveBytesPerSec =
        semanticBytesPerSec != null && semanticBytesPerSec > 0
          ? semanticBytesPerSec
          : progress.elapsedMs > 0 && semanticBytesReceived > 0
            ? (semanticBytesReceived / progress.elapsedMs) * 1000
            : null;

      return effectiveBytesPerSec != null &&
        Number.isFinite(effectiveBytesPerSec) &&
        effectiveBytesPerSec > 0
        ? effectiveBytesPerSec / bytesPerToken
        : null;
    })();
    const statusClass =
      status === 'success'
        ? 'border-success/30 bg-emerald-500/15 text-success'
        : status === 'pending'
          ? 'border-warning/30 bg-yellow-500/15 text-warning'
          : status === 'cancelled'
            ? 'border-blue-400/30 bg-blue-500/15 text-blue-400'
            : status === 'timeout'
              ? 'border-orange-400/30 bg-orange-500/15 text-orange-400'
              : 'border-danger/30 bg-red-500/15 text-danger';

    return (
      <article
        className={clsx(
          'border-border-glass bg-bg-card rounded-lg border p-1.5 shadow-sm',
          isNewest && 'animate-slide-in',
          log.responseStatus === 'pending' && 'bg-yellow-500/5'
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-xs">
            <span className="text-text shrink-0 font-mono text-[11px] font-medium">
              {formatted.time}
            </span>
            <span className="text-text-muted shrink-0" aria-hidden="true">
              ·
            </span>
            <span className="text-text min-w-0 truncate font-medium">
              {log.incomingModelAlias || '-'}
            </span>
            <span className="text-text-muted shrink-0" aria-hidden="true">
              ·
            </span>
            <span
              className="text-text-secondary min-w-0 truncate font-normal"
              title={(() => {
                const routeModel = log.finalAttemptModel ?? log.selectedModelName ?? '-';
                return hasUpstreamRewrite(log)
                  ? `${log.provider || '-'}:${routeModel} → ${log.upstreamModel} (route → upstream)`
                  : undefined;
              })()}
            >
              {(() => {
                const routeModel = log.finalAttemptModel ?? log.selectedModelName ?? '-';
                return hasUpstreamRewrite(log)
                  ? `${log.provider || '-'}:${routeModel} → ${log.upstreamModel}`
                  : `${log.provider || '-'}:${routeModel}`;
              })()}
            </span>
            {(() => {
              const hasRewrite = hasUpstreamRewrite(log);
              const indicatorLabel = getAttemptIndicatorLabel(log.attemptCount);
              if (!indicatorLabel || !onRetryDetails) return null;
              return (
                <button
                  type="button"
                  onClick={() => onRetryDetails(log)}
                  className="shrink-0 text-[10px] font-medium text-orange-500"
                  aria-label={`View retry history (${log.attemptCount} attempts${hasRewrite ? ', model rewritten upstream' : ''})`}
                >
                  {indicatorLabel}
                </button>
              );
            })()}
          </div>
          <span
            className={clsx(
              'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold capitalize',
              statusClass
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

        <div className="mt-1 space-y-1">
          {(() => {
            const reasoning = formatReasoningEffort(log.reasoningEffort);
            const tier = getServiceTierDisplay(log);
            if (!reasoning && !tier) return null;
            return (
              <div className="text-text-secondary flex items-center gap-1 text-[10px] font-normal">
                {reasoning && (
                  <>
                    <BrainCog
                      size={12}
                      className="shrink-0 text-purple-400"
                      role="img"
                      aria-label="Effort"
                    />
                    <span className="truncate">{reasoning}</span>
                  </>
                )}
                {tier && <ServiceTierIndicator display={tier} />}
              </div>
            );
          })()}
          <div className="grid grid-cols-4 gap-1 text-[11px]">
            <div
              className="bg-bg-subtle min-w-0 overflow-hidden rounded px-1 py-0.5"
              title={`Key: ${log.apiKey || '-'}`}
            >
              <div className="text-text flex min-w-0 items-center gap-1 truncate">
                <KeyRound size={12} className="text-text-muted shrink-0" aria-hidden="true" />
                {log.apiKey || '-'}
              </div>
            </div>
            <div
              className="bg-bg-subtle min-w-0 overflow-hidden rounded px-1 py-0.5"
              title={`Messages: ${(log.messageCount || 0) === 0 ? '-' : log.messageCount} • Tool calls: ${(log.toolCallsCount || 0) === 0 ? '-' : log.toolCallsCount}`}
            >
              <div className="text-text flex min-w-0 items-center gap-0.5 whitespace-nowrap">
                <div
                  className="flex w-3 shrink-0 justify-center"
                  title={formatApiTypeLabel(log.incomingApiType || '')}
                >
                  <ApiTypeIcon apiType={log.incomingApiType} size={12} />
                </div>
                <span className="text-text-muted text-[9px]" aria-hidden="true">
                  →
                </span>
                <div
                  className="flex w-3 shrink-0 justify-center"
                  title={formatApiTypeLabel(log.outgoingApiType || '')}
                >
                  <ApiTypeIcon apiType={log.outgoingApiType} size={12} />
                </div>
                <span className="text-text-muted" aria-hidden="true">
                  ·
                </span>
                <MessagesSquare size={10} className="shrink-0 text-blue-400" aria-hidden="true" />
                <span>{(log.messageCount || 0) === 0 ? '-' : log.messageCount}</span>
                <Wrench size={10} className="shrink-0 text-orange-400" aria-hidden="true" />
                <span>{(log.toolCallsCount || 0) === 0 ? '-' : log.toolCallsCount}</span>
              </div>
            </div>
            <div
              className="bg-bg-subtle min-w-0 overflow-hidden rounded px-1 py-0.5"
              title={`Tokens: ${formatLargeNumber(totalTokens)} • Cost: ${log.costTotal == null || log.costTotal === 0 ? '-' : formatCostIn(log.costTotal, { currency, rate, symbol, decimals: 2 })}`}
            >
              <div className="text-text flex min-w-0 items-center gap-1 truncate">
                <Coins size={12} className="text-text-muted shrink-0" aria-hidden="true" />
                {formatLargeNumber(totalTokens)}
                <span className="text-text-muted" aria-hidden="true">
                  ·
                </span>
                {log.costTotal == null || log.costTotal === 0
                  ? '-'
                  : formatCostIn(log.costTotal, { currency, rate, symbol, decimals: 2 })}
              </div>
            </div>
            <div
              className="bg-bg-subtle min-w-0 overflow-hidden rounded px-1 py-0.5"
              title={
                status === 'pending'
                  ? `Duration: ${mobileDuration}${estimatedTokensPerSec != null ? ` • Estimated tokens/sec: ${formatTPS(estimatedTokensPerSec)}` : ''}`
                  : `End-to-end throughput: ${log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0 ? formatTPS(e2eOutputTokens / (log.durationMs / 1000)) : '-'}`
              }
            >
              <div className="text-text flex min-w-0 items-center gap-1 truncate">
                <Gauge size={12} className="text-text-muted shrink-0" aria-hidden="true" />
                {status === 'pending' ? (
                  <>
                    {mobileDuration}
                    {estimatedTokensPerSec != null && (
                      <span className="text-text-secondary">
                        {' · '}
                        <Zap size={11} className="inline-block text-amber-400" aria-hidden="true" />
                        {' ~'}
                        {formatTPS(estimatedTokensPerSec)} tok/s
                      </span>
                    )}
                  </>
                ) : log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0 ? (
                  formatTPS(e2eOutputTokens / (log.durationMs / 1000))
                ) : (
                  '-'
                )}
              </div>
            </div>
          </div>
        </div>

        {(log.hasError || log.hasDebug) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {log.hasError && (
              <Button size="sm" variant="danger" onClick={() => onError(log.requestId)}>
                <AlertTriangle size={12} />
                Error
              </Button>
            )}
            {log.hasDebug && (
              <Button size="sm" variant="secondary" onClick={() => onDebug(log.requestId)}>
                <Bug size={12} />
                Debug
              </Button>
            )}
          </div>
        )}
      </article>
    );
  }
);
