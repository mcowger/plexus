import React from 'react';
import { clsx } from 'clsx';
import {
  CheckCircle,
  Plane,
  Ban,
  Timer,
  XCircle,
  KeyRound,
  Braces,
  Variable,
  AudioLines,
  Volume2,
  Image as ImageIcon,
  ShieldCheck,
  MessagesSquare,
  Wrench,
  Coins,
  Gauge,
  Zap,
  AlertTriangle,
  Bug,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useCurrency } from '../../lib/CurrencyContext';
import { formatLargeNumber } from '../../lib/api';
import { formatCostIn, formatMs, formatTPS, getEstimatedBytesPerToken } from '../../lib/format';
import { formatApiTypeLabel, getApiBaseType } from '../../lib/apiFormats';
import { API_LOGOS } from './constants';
import { formatDateSafely, formatReasoningEffort } from './helpers';
import type { LogRowProps } from './types';

export const MobileLogRow = React.memo(
  ({ log, isNewest, liveNow, progress, onError, onDebug }: LogRowProps) => {
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
          'rounded-lg border border-border-glass bg-bg-card p-1.5 shadow-sm',
          isNewest && 'animate-slide-in',
          log.responseStatus === 'pending' && 'bg-yellow-500/5'
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-xs">
            <span className="shrink-0 font-mono text-[11px] font-medium text-text">
              {formatted.time}
            </span>
            <span className="shrink-0 text-text-muted" aria-hidden="true">
              ·
            </span>
            <span className="min-w-0 truncate font-medium text-text">
              {log.incomingModelAlias || '-'}
            </span>
            <span className="shrink-0 text-text-muted" aria-hidden="true">
              ·
            </span>
            <span className="min-w-0 truncate font-normal text-text-secondary">
              {log.provider || '-'}:{log.selectedModelName || '-'}
            </span>
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
          {formatReasoningEffort(log.reasoningEffort) && (
            <div className="truncate text-[10px] font-normal text-text-secondary">
              Reasoning: {formatReasoningEffort(log.reasoningEffort)}
            </div>
          )}
          <div className="grid grid-cols-4 gap-1 text-[11px]">
            <div
              className="min-w-0 overflow-hidden rounded bg-bg-subtle px-1 py-0.5"
              title={`Key: ${log.apiKey || '-'}`}
            >
              <div className="flex min-w-0 items-center gap-1 truncate text-text">
                <KeyRound size={12} className="shrink-0 text-text-muted" aria-hidden="true" />
                {log.apiKey || '-'}
              </div>
            </div>
            <div
              className="min-w-0 overflow-hidden rounded bg-bg-subtle px-1 py-0.5"
              title={`Messages: ${(log.messageCount || 0) === 0 ? '-' : log.messageCount} • Tool calls: ${(log.toolCallsCount || 0) === 0 ? '-' : log.toolCallsCount}`}
            >
              <div className="flex min-w-0 items-center gap-0.5 whitespace-nowrap text-text">
                <div
                  className="flex w-3 shrink-0 justify-center"
                  title={formatApiTypeLabel(log.incomingApiType || '')}
                >
                  {log.incomingApiType === 'raw' ? (
                    <Braces size={12} className="text-cyan-400" />
                  ) : log.incomingApiType === 'embeddings' ? (
                    <Variable size={12} className="text-green-500" />
                  ) : log.incomingApiType === 'transcriptions' ? (
                    <AudioLines size={12} className="text-purple-500" />
                  ) : log.incomingApiType === 'speech' ? (
                    <Volume2 size={12} className="text-orange-500" />
                  ) : log.incomingApiType === 'images' ? (
                    <ImageIcon size={12} className="text-fuchsia-500" />
                  ) : log.incomingApiType === 'oauth' ? (
                    <ShieldCheck size={12} className="text-emerald-500" />
                  ) : log.incomingApiType && API_LOGOS[getApiBaseType(log.incomingApiType)] ? (
                    <img
                      src={API_LOGOS[getApiBaseType(log.incomingApiType)]}
                      alt={formatApiTypeLabel(log.incomingApiType)}
                      title={formatApiTypeLabel(log.incomingApiType)}
                      className="h-3 w-3"
                    />
                  ) : (
                    <span className="text-[10px] text-text-muted">?</span>
                  )}
                </div>
                <span className="text-[9px] text-text-muted" aria-hidden="true">
                  →
                </span>
                <div
                  className="flex w-3 shrink-0 justify-center"
                  title={formatApiTypeLabel(log.outgoingApiType || '')}
                >
                  {log.outgoingApiType === 'raw' ? (
                    <Braces size={12} className="text-cyan-400" />
                  ) : log.outgoingApiType === 'embeddings' ? (
                    <Variable size={12} className="text-green-500" />
                  ) : log.outgoingApiType === 'transcriptions' ? (
                    <AudioLines size={12} className="text-purple-500" />
                  ) : log.outgoingApiType === 'speech' ? (
                    <Volume2 size={12} className="text-orange-500" />
                  ) : log.outgoingApiType === 'images' ? (
                    <ImageIcon size={12} className="text-fuchsia-500" />
                  ) : log.outgoingApiType === 'oauth' ? (
                    <ShieldCheck size={12} className="text-emerald-500" />
                  ) : log.outgoingApiType && API_LOGOS[getApiBaseType(log.outgoingApiType)] ? (
                    <img
                      src={API_LOGOS[getApiBaseType(log.outgoingApiType)]}
                      alt={formatApiTypeLabel(log.outgoingApiType)}
                      title={formatApiTypeLabel(log.outgoingApiType)}
                      className="h-3 w-3"
                    />
                  ) : (
                    <span className="text-[10px] text-text-muted">?</span>
                  )}
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
              className="min-w-0 overflow-hidden rounded bg-bg-subtle px-1 py-0.5"
              title={`Tokens: ${formatLargeNumber(totalTokens)} • Cost: ${log.costTotal == null || log.costTotal === 0 ? '-' : formatCostIn(log.costTotal, { currency, rate, symbol, decimals: 2 })}`}
            >
              <div className="flex min-w-0 items-center gap-1 truncate text-text">
                <Coins size={12} className="shrink-0 text-text-muted" aria-hidden="true" />
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
              className="min-w-0 overflow-hidden rounded bg-bg-subtle px-1 py-0.5"
              title={
                status === 'pending'
                  ? `Duration: ${mobileDuration}${estimatedTokensPerSec != null ? ` • Estimated tokens/sec: ${formatTPS(estimatedTokensPerSec)}` : ''}`
                  : `End-to-end throughput: ${log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0 ? formatTPS(e2eOutputTokens / (log.durationMs / 1000)) : '-'}`
              }
            >
              <div className="flex min-w-0 items-center gap-1 truncate text-text">
                <Gauge size={12} className="shrink-0 text-text-muted" aria-hidden="true" />
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
