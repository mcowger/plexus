import React from 'react';
import { clsx } from 'clsx';
import {
  Trash2,
  Bug,
  Zap,
  ZapOff,
  AlertTriangle,
  Languages,
  MoveHorizontal,
  CloudUpload,
  CloudDownload,
  BrainCog,
  PackageOpen,
  Copy,
  Variable,
  AudioLines,
  Volume2,
  Wrench,
  MessagesSquare,
  PlugZap,
  CirclePause,
  Octagon,
  Hammer,
  RulerDimensionLine,
  ChevronDown,
  Image as ImageIcon,
  ShieldCheck,
  Braces,
  RotateCcw,
  PencilLine,
  Plane,
  Eye,
  ScanSearch,
  Ban,
  Timer,
  CheckCircle,
  XCircle,
  Pi,
} from 'lucide-react';
import { CostToolTip } from '../ui/CostToolTip';
import { PerformanceToolTip } from '../ui/PerformanceToolTip';
import { useCurrency } from '../../lib/CurrencyContext';
import { formatLargeNumber } from '../../lib/api';
import {
  formatBytes,
  formatCostIn,
  formatMs,
  formatTPS,
  getEstimatedBytesPerToken,
} from '../../lib/format';
import { formatApiTypeLabel, getApiBaseType } from '../../lib/apiFormats';
import { isClipboardAvailable, copyToClipboard } from '../../lib/clipboard';
import {
  API_LOGOS,
  PI_AI_OUTGOING_TYPES,
  DESKTOP_STATUS_COLUMN_WIDTH,
  DESKTOP_DATE_COLUMN_WIDTH,
  DESKTOP_API_COLUMN_WIDTH,
  DESKTOP_TOKENS_COLUMN_WIDTH,
  DESKTOP_COST_COLUMN_WIDTH,
  DESKTOP_PERF_COLUMN_WIDTH,
  DESKTOP_DELETE_COLUMN_WIDTH,
} from './constants';
import { formatDateSafely, formatReasoningEffort } from './helpers';
import type { DesktopLogRowProps } from './types';

export const DesktopLogRow = React.memo(
  ({
    log,
    isNewest,
    liveNow,
    progress,
    onError,
    onDebug,
    onRetryDetails,
    onDelete,
  }: DesktopLogRowProps) => {
    const { currency, rate, symbol } = useCurrency();
    const costBreakdown = {
      input:
        log.costInput === 0
          ? `${symbol}-.----`
          : formatCostIn(log.costInput || 0, { currency, rate, symbol, decimals: 4 }),
      output:
        log.costOutput === 0
          ? `${symbol}-.----`
          : formatCostIn(log.costOutput || 0, { currency, rate, symbol, decimals: 4 }),
      cached:
        log.costCached === 0
          ? `${symbol}-.----`
          : formatCostIn(log.costCached || 0, { currency, rate, symbol, decimals: 4 }),
      cacheWrite:
        log.costCacheWrite === 0
          ? `${symbol}-.----`
          : formatCostIn(log.costCacheWrite || 0, { currency, rate, symbol, decimals: 4 }),
    };
    return (
      <tr
        className={clsx(
          'group border-b border-border-glass hover:bg-bg-hover',
          isNewest && 'animate-slide-in'
        )}
        style={{
          height: '86px',
          backgroundColor: log.responseStatus === 'pending' ? 'rgba(234, 179, 8, 0.08)' : undefined,
        }}
      >
        <td
          className="px-0 py-1.5 text-center border-b border-border-glass text-text align-middle"
          style={{
            width: DESKTOP_STATUS_COLUMN_WIDTH,
            minWidth: DESKTOP_STATUS_COLUMN_WIDTH,
            maxWidth: DESKTOP_STATUS_COLUMN_WIDTH,
          }}
        >
          <div className="flex flex-col items-center justify-center gap-0.5">
            {log.hasDebug ? (
              <button
                type="button"
                onClick={() => onDebug(log.requestId)}
                className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-400/30 bg-blue-500/15 text-blue-400 transition-colors hover:bg-blue-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                title={
                  log.hasError ? 'View Debug Trace (error also available)' : 'View Debug Trace'
                }
                aria-label={
                  log.hasError
                    ? 'View Debug Trace. Error details are also available.'
                    : 'View Debug Trace'
                }
              >
                <Bug size={10} />
                {log.hasError && (
                  <span
                    aria-hidden="true"
                    className="absolute right-0 top-0 h-1 w-1 rounded-full bg-danger"
                  />
                )}
              </button>
            ) : log.hasError ? (
              <button
                type="button"
                onClick={() => onError(log.requestId)}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-danger/30 bg-red-500/15 text-danger transition-colors hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
                title="View Error Details"
                aria-label="View Error Details"
              >
                <AlertTriangle size={10} />
              </button>
            ) : (
              <span
                className={clsx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  log.responseStatus === 'success'
                    ? 'border-success/30 bg-emerald-500/15 text-success'
                    : log.responseStatus === 'pending'
                      ? 'border-warning/30 bg-yellow-500/15 text-warning'
                      : log.responseStatus === 'cancelled'
                        ? 'border-blue-400/30 bg-blue-500/15 text-blue-400'
                        : log.responseStatus === 'timeout'
                          ? 'border-orange-400/30 bg-orange-500/15 text-orange-400'
                          : 'border-danger/30 bg-red-500/15 text-danger'
                )}
                role="img"
                aria-label={`Status: ${log.responseStatus || 'unknown'}`}
                title={`Status: ${log.responseStatus || 'unknown'}`}
              >
                {log.responseStatus === 'success' ? (
                  <CheckCircle size={10} />
                ) : log.responseStatus === 'pending' ? (
                  <Plane size={10} className="animate-pulse" />
                ) : log.responseStatus === 'cancelled' ? (
                  <Ban size={10} />
                ) : log.responseStatus === 'timeout' ? (
                  <Timer size={10} />
                ) : (
                  <XCircle size={10} />
                )}
              </span>
            )}
            {log.attemptCount && log.attemptCount > 1 && (
              <button
                type="button"
                onClick={() => onRetryDetails(log)}
                className="inline-flex shrink-0 items-center gap-0 border-0 bg-transparent p-0 text-orange-500 transition-colors hover:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
                title="View retry history"
                aria-label={`View retry history (${log.attemptCount} attempts)`}
              >
                <RotateCcw size={10} />
                <span className="text-[8px] font-medium">{log.attemptCount}x</span>
              </button>
            )}
          </div>
        </td>
        <td
          className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
          style={{ width: DESKTOP_DATE_COLUMN_WIDTH }}
        >
          <div className="flex min-w-0 flex-col">
            {(() => {
              const formatted = formatDateSafely(log.date);
              return (
                <>
                  <span style={{ fontWeight: '500' }}>{formatted.time}</span>
                  <span
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: '0.85em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatted.date}
                  </span>
                </>
              );
            })()}
          </div>
        </td>
        <td
          className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle"
          title={log.sourceIp ? `IP: ${log.sourceIp}` : undefined}
          style={log.sourceIp ? { cursor: 'help' } : undefined}
        >
          <div className="flex min-w-0 flex-col">
            <span
              className="truncate"
              style={{ fontWeight: '500' }}
              title={log.apiKey || undefined}
            >
              {log.apiKey || '-'}
            </span>
            {log.attribution && (
              <span
                className="truncate"
                style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                title={log.attribution}
              >
                {log.attribution}
              </span>
            )}
          </div>
        </td>
        <td
          className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
          style={{ width: DESKTOP_API_COLUMN_WIDTH, cursor: 'help' }}
          title={`Incoming: ${formatApiTypeLabel(log.incomingApiType)} → Outgoing: ${formatApiTypeLabel(log.outgoingApiType)} • ${log.isStreamed ? 'Streamed' : 'Non-streamed'} • ${log.isRaw ? `Raw ${log.requestMethod || ''} ${log.requestPath || ''}` : Boolean(log.outgoingApiType && PI_AI_OUTGOING_TYPES[log.outgoingApiType]) ? 'pi-ai native' : log.isPassthrough ? 'Direct/Passthrough' : 'Translated'}`}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* API type icons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                {log.incomingApiType === 'embeddings' ? (
                  <Variable size={16} className="text-green-500" />
                ) : log.incomingApiType === 'transcriptions' ? (
                  <AudioLines size={16} className="text-purple-500" />
                ) : log.incomingApiType === 'speech' ? (
                  <Volume2 size={16} className="text-orange-500" />
                ) : log.incomingApiType === 'images' ? (
                  <ImageIcon size={16} className="text-fuchsia-500" />
                ) : log.incomingApiType === 'oauth' ? (
                  <ShieldCheck size={16} className="text-emerald-500" />
                ) : log.incomingApiType && API_LOGOS[getApiBaseType(log.incomingApiType)] ? (
                  <img
                    src={API_LOGOS[getApiBaseType(log.incomingApiType)]}
                    alt={formatApiTypeLabel(log.incomingApiType)}
                    title={formatApiTypeLabel(log.incomingApiType)}
                    style={{ width: '16px', height: '16px' }}
                  />
                ) : (
                  '?'
                )}
              </div>
              <span style={{ width: '14px', textAlign: 'center' }}>→</span>
              <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                {log.outgoingApiType === 'embeddings' ? (
                  <Variable size={16} className="text-green-500" />
                ) : log.outgoingApiType === 'transcriptions' ? (
                  <AudioLines size={16} className="text-purple-500" />
                ) : log.outgoingApiType === 'speech' ? (
                  <Volume2 size={16} className="text-orange-500" />
                ) : log.outgoingApiType === 'images' ? (
                  <ImageIcon size={16} className="text-fuchsia-500" />
                ) : log.outgoingApiType === 'oauth' ? (
                  <ShieldCheck size={16} className="text-emerald-500" />
                ) : log.outgoingApiType && API_LOGOS[getApiBaseType(log.outgoingApiType)] ? (
                  <img
                    src={API_LOGOS[getApiBaseType(log.outgoingApiType)]}
                    alt={formatApiTypeLabel(log.outgoingApiType)}
                    title={formatApiTypeLabel(log.outgoingApiType)}
                    style={{ width: '16px', height: '16px' }}
                  />
                ) : (
                  '?'
                )}
              </div>
            </div>
            <div className="hidden min-[1150px]:block">
              <div
                style={{
                  borderTop: '1px solid var(--color-border-glass)',
                  margin: '1px 4px',
                  width: '44px',
                }}
              ></div>
              {/* Streaming/Passthrough icons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                  {log.isStreamed ? (
                    <Zap size={12} className="text-blue-400" />
                  ) : (
                    <ZapOff size={12} className="text-gray-400" />
                  )}
                </div>
                <span style={{ width: '14px' }}></span>
                <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                  {log.isRaw ? (
                    <Braces size={12} className="text-cyan-400" />
                  ) : Boolean(log.outgoingApiType && PI_AI_OUTGOING_TYPES[log.outgoingApiType]) ? (
                    <Pi size={12} className="text-emerald-400" />
                  ) : log.isPassthrough ? (
                    <MoveHorizontal size={12} className="text-yellow-500" />
                  ) : (
                    <Languages size={12} className="text-purple-400" />
                  )}
                </div>
              </div>

              {/* Vision Fallthrough icons */}
              {(log.isVisionFallthrough || log.isDescriptorRequest) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    marginTop: '2px',
                  }}
                >
                  <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                    {log.isVisionFallthrough && (
                      <div
                        title={`Vision Fallthrough${log.visionFallthroughModel ? ` via ${log.visionFallthroughModel}` : ''} (Images converted to text)`}
                      >
                        <ScanSearch size={12} className="text-amber-500" />
                      </div>
                    )}
                  </div>
                  <span style={{ width: '14px' }}></span>
                  <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                    {log.isDescriptorRequest && (
                      <div title="Descriptor Request (Generated image description)">
                        <Eye size={12} className="text-blue-500" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="group/model flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate" title={log.incomingModelAlias || undefined}>
                {log.incomingModelAlias || '-'}
              </span>
              {log.incomingModelAlias && log.incomingModelAlias !== '-' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!isClipboardAvailable()) return;
                    await copyToClipboard(log.incomingModelAlias || '');
                  }}
                  className="flex shrink-0 items-center border-0 bg-transparent p-0 opacity-0 cursor-pointer transition-opacity group-hover/model:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:opacity-0"
                  title={
                    isClipboardAvailable() ? 'Copy incoming model alias' : 'Copy requires HTTPS'
                  }
                  disabled={!isClipboardAvailable()}
                >
                  <Copy size={12} className="text-text-secondary hover:text-text" />
                </button>
              )}
            </div>
            <div className="group/selected flex min-w-0 items-center gap-1">
              <span
                className="min-w-0 truncate"
                style={{ color: 'var(--color-text-secondary)', fontSize: '0.9em' }}
                title={`${log.provider || '-'}:${log.selectedModelName || '-'}`}
              >
                {log.provider || '-'}:{log.selectedModelName || '-'}
              </span>
              {log.selectedModelName && log.selectedModelName !== '-' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!isClipboardAvailable()) return;
                    await copyToClipboard(log.selectedModelName || '');
                  }}
                  className="flex shrink-0 items-center border-0 bg-transparent p-0 opacity-0 cursor-pointer transition-opacity group-hover/selected:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:opacity-0"
                  title={
                    isClipboardAvailable() ? 'Copy selected model name' : 'Copy requires HTTPS'
                  }
                  disabled={!isClipboardAvailable()}
                >
                  <Copy size={10} className="text-text-secondary hover:text-text" />
                </button>
              )}
            </div>
            {formatReasoningEffort(log.reasoningEffort) && (
              <div className="flex min-w-0 items-center gap-1">
                <span
                  className="truncate"
                  style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                >
                  Reasoning: {formatReasoningEffort(log.reasoningEffort)}
                </span>
              </div>
            )}
            {log.isVisionFallthrough && log.visionFallthroughModel && (
              <div
                className="group/vft flex min-w-0 items-center gap-1"
                title="Vision fallthrough descriptor model"
              >
                <ScanSearch size={10} className="text-amber-500 shrink-0" />
                <span
                  className="min-w-0 truncate"
                  style={{ color: 'var(--color-text-secondary)', fontSize: '0.8em' }}
                  title={log.visionFallthroughModel}
                >
                  {log.visionFallthroughModel}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!isClipboardAvailable()) return;
                    await copyToClipboard(log.visionFallthroughModel || '');
                  }}
                  className="flex shrink-0 items-center border-0 bg-transparent p-0 opacity-0 cursor-pointer transition-opacity group-hover/vft:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:opacity-0"
                  title={
                    isClipboardAvailable() ? 'Copy fallthrough model name' : 'Copy requires HTTPS'
                  }
                  disabled={!isClipboardAvailable()}
                >
                  <Copy size={10} className="text-text-secondary hover:text-text" />
                </button>
              </div>
            )}
          </div>
        </td>
        <td
          className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle"
          style={{ width: DESKTOP_TOKENS_COLUMN_WIDTH, cursor: 'help' }}
          title={`Input: ${(log.tokensInput || 0) === 0 ? '-' : formatLargeNumber(log.tokensInput || 0)} • Output: ${(log.tokensOutput || 0) === 0 ? '-' : formatLargeNumber(log.tokensOutput || 0)} • Reasoning: ${(log.tokensReasoning || 0) === 0 ? '-' : formatLargeNumber(log.tokensReasoning || 0)} • Cached: ${(log.tokensCached || 0) === 0 ? '-' : formatLargeNumber(log.tokensCached || 0)} • Cache Write: ${(log.tokensCacheWrite || 0) === 0 ? '-' : formatLargeNumber(log.tokensCacheWrite || 0)}${log.tokensEstimated ? ' • * = Estimated' : ''}`}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* Row 1: Input, Cache Read, and Cache Write */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <CloudUpload size={12} className="text-blue-400" />
                <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '24px' }}>
                  {(log.tokensInput || 0) === 0 ? '-' : formatLargeNumber(log.tokensInput || 0)}
                  {log.tokensEstimated ? (
                    <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                  ) : null}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <span aria-hidden="true">(</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <PackageOpen size={12} className="text-orange-400" />
                  <span
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: '0.85em',
                    }}
                  >
                    {(log.tokensCached || 0) === 0 ? '-' : formatLargeNumber(log.tokensCached || 0)}
                    {log.tokensEstimated ? (
                      <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                    ) : null}
                  </span>
                </div>
                <span aria-hidden="true">/</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <PencilLine size={12} className="text-fuchsia-400" />
                  <span
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: '0.85em',
                    }}
                  >
                    {(log.tokensCacheWrite || 0) === 0
                      ? '-'
                      : formatLargeNumber(log.tokensCacheWrite || 0)}
                    {log.tokensEstimated ? (
                      <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                    ) : null}
                  </span>
                </div>
                <span aria-hidden="true">)</span>
              </div>
            </div>
            {/* Row 2: Output and Reasoning */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <CloudDownload size={12} className="text-green-400" />
                <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '24px' }}>
                  {(log.tokensOutput || 0) === 0 ? '-' : formatLargeNumber(log.tokensOutput || 0)}
                  {log.tokensEstimated ? (
                    <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                  ) : null}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <span aria-hidden="true">(</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <BrainCog size={12} className="text-purple-400" />
                  <span
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: '0.85em',
                    }}
                  >
                    {(log.tokensReasoning || 0) === 0
                      ? '-'
                      : formatLargeNumber(log.tokensReasoning || 0)}
                    {log.tokensEstimated ? (
                      <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                    ) : null}
                  </span>
                </div>
                <span aria-hidden="true">)</span>
              </div>
            </div>
          </div>
        </td>
        <td
          className="min-w-0 px-1 py-1.5 border-b border-border-glass text-text align-middle"
          style={{ width: DESKTOP_COST_COLUMN_WIDTH }}
        >
          {log.costTotal !== undefined && log.costTotal !== null ? (
            <div className={log.costTotal === 0 ? 'text-center' : undefined}>
              <CostToolTip
                source={log.costSource}
                costMetadata={log.costMetadata}
                costBreakdown={costBreakdown}
              >
                <span className="block truncate" style={{ fontWeight: '500', cursor: 'help' }}>
                  {log.costTotal === 0
                    ? '-'
                    : formatCostIn(log.costTotal, { currency, rate, symbol, decimals: 6 })}
                </span>
              </CostToolTip>
            </div>
          ) : (
            <span
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '1.2em',
                display: 'block',
              }}
            >
              -
            </span>
          )}
        </td>
        <td
          className="min-w-0 overflow-hidden px-1 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
          style={{
            width: DESKTOP_PERF_COLUMN_WIDTH,
            minWidth: DESKTOP_PERF_COLUMN_WIDTH,
            maxWidth: DESKTOP_PERF_COLUMN_WIDTH,
            overflow: 'hidden',
          }}
        >
          {(() => {
            const rawDurationMs =
              log.durationMs != null && log.durationMs > 0
                ? log.durationMs
                : log.responseStatus === 'pending' && liveNow != null
                  ? liveNow - log.startTime
                  : null;
            const liveDuration = rawDurationMs != null ? formatMs(rawDurationMs) : '-';
            const e2eOutputTokens =
              Number(log.tokensOutput || 0) + Number(log.tokensReasoning || 0);
            // End-to-end throughput: output plus reasoning tokens / full request duration.
            // Unlike TPS (which excludes the TTFT delay), E2E includes it.
            const e2e =
              log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0
                ? e2eOutputTokens / (log.durationMs / 1000)
                : null;
            if (progress) {
              const semanticBytesReceived =
                progress.semanticBytesReceived ?? progress.bytesReceived;
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
              const estTokensPerSec =
                effectiveBytesPerSec != null &&
                Number.isFinite(effectiveBytesPerSec) &&
                effectiveBytesPerSec > 0
                  ? effectiveBytesPerSec / bytesPerToken
                  : null;
              const semanticBytesFormatted = formatBytes(semanticBytesReceived);
              const rawBytesFormatted =
                semanticBytesReceived !== progress.bytesReceived
                  ? formatBytes(progress.bytesReceived).replace(' ', '')
                  : undefined;
              const bytesPerSecFormatted =
                progress.bytesPerSec != null ? formatBytes(progress.bytesPerSec) : undefined;
              const estimatedTokensPerSecFormatted =
                estTokensPerSec != null ? `~${formatTPS(estTokensPerSec)} tok/s` : undefined;

              return (
                <PerformanceToolTip
                  duration={liveDuration}
                  semanticBytes={semanticBytesFormatted}
                  rawBytes={rawBytesFormatted}
                  bytesPerSec={bytesPerSecFormatted}
                  estimatedTokensPerSec={estimatedTokensPerSecFormatted}
                >
                  <div className="flex min-w-0 flex-col" title="Hover for live performance details">
                    <span title={`Duration: ${liveDuration}`}>Dur: {liveDuration}</span>
                    {estTokensPerSec != null && (
                      <span
                        className="flex items-center gap-1 whitespace-nowrap"
                        style={{
                          color: 'var(--color-text-secondary)',
                          fontSize: '0.85em',
                        }}
                      >
                        <Zap size={12} className="text-amber-400" />
                        <span
                          title={`Estimated tokens/sec (~${Math.round(bytesPerToken)} bytes/token for this API's streamed token events)`}
                        >
                          {estimatedTokensPerSecFormatted}
                        </span>
                      </span>
                    )}
                  </div>
                </PerformanceToolTip>
              );
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span title={`Duration: ${liveDuration}`}>Dur: {liveDuration}</span>
                <span
                  title={
                    log.ttftMs && log.ttftMs > 0
                      ? `Time to first token: ${formatMs(log.ttftMs)}`
                      : 'Time to first token: unavailable'
                  }
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: '0.85em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {log.ttftMs && log.ttftMs > 0 ? `TTFT: ${formatMs(log.ttftMs)}` : 'TTFT: -'}
                </span>
                <span
                  title={
                    log.tokensPerSec && log.tokensPerSec > 0
                      ? `Tokens per second: ${formatTPS(log.tokensPerSec)}`
                      : 'Tokens per second: unavailable'
                  }
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: '0.85em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {log.tokensPerSec && log.tokensPerSec > 0
                    ? `TPS: ${formatTPS(log.tokensPerSec)}`
                    : 'TPS: -'}
                </span>
                <span
                  title={
                    e2e != null
                      ? `End-to-end throughput: ${formatTPS(e2e)}`
                      : 'End-to-end throughput: unavailable'
                  }
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: '0.85em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e2e != null ? `E2E: ${formatTPS(e2e)}` : 'E2E: -'}
                </span>
              </div>
            );
          })()}
        </td>
        <td className="hidden px-1 py-1.5 text-center border-b border-border-glass text-text align-middle min-[1150px]:table-cell">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {/* Row 1: Messages and Tool calls */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                className="text-blue-400"
              >
                <MessagesSquare size={12} />
                <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}>
                  {(log.messageCount || 0) === 0 ? '-' : log.messageCount}
                </span>
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                className="text-green-400"
              >
                <PlugZap size={12} />
                <span
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: '0.85em',
                    minWidth: '20px',
                  }}
                >
                  {(log.toolCallsCount || 0) === 0 ? '-' : log.toolCallsCount}
                </span>
              </div>
            </div>
            {/* Row 2: Tools defined and Finish reason */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                className="text-orange-400"
              >
                <Wrench size={12} />
                <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}>
                  {log.toolsDefined || 0}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {log.finishReason === 'end_turn' ? (
                  <CirclePause size={12} className="text-yellow-500" />
                ) : log.finishReason === 'stop' ? (
                  <Octagon size={12} className="text-red-500" />
                ) : log.finishReason === 'tool_calls' || log.finishReason === 'tool_use' ? (
                  <Hammer size={12} className="text-purple-500" />
                ) : log.finishReason === 'length' || log.finishReason === 'max_tokens' ? (
                  <RulerDimensionLine size={12} className="text-pink-400" />
                ) : (
                  <ChevronDown size={12} className="text-gray-400" />
                )}
                <span
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: '0.85em',
                    minWidth: '20px',
                  }}
                >
                  {log.finishReason || '-'}
                </span>
              </div>
            </div>
          </div>
        </td>
        <td
          className="px-1 py-1.5 text-left border-b border-border-glass text-text align-middle"
          style={{ width: DESKTOP_DELETE_COLUMN_WIDTH }}
        >
          <button
            type="button"
            onClick={() => onDelete(log.requestId)}
            className="flex items-center justify-center rounded border-0 bg-transparent p-1 text-text-muted opacity-0 cursor-pointer transition-all duration-200 hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            title="Delete log"
            aria-label="Delete log"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
    );
  }
);
