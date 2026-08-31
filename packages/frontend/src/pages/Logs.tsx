import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { CostToolTip } from '../components/ui/CostToolTip';
import { PerformanceToolTip } from '../components/ui/PerformanceToolTip';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import {
  api,
  UsageRecord,
  formatLargeNumber,
  type UsageSortDirection,
  type UsageSortField,
} from '../lib/api';
import {
  formatBytes,
  formatCostIn,
  formatMs,
  formatTPS,
  getEstimatedBytesPerToken,
} from '../lib/format';
import { isClipboardAvailable, copyToClipboard } from '../lib/clipboard';
import { formatApiTypeLabel, getApiBaseType } from '../lib/apiFormats';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import { Drawer } from '../components/ui/Drawer';
import {
  ChevronLeft,
  ChevronRight,
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
  KeyRound,
  Coins,
  Gauge,
  RotateCcw,
  PencilLine,
  Plane,
  Eye,
  ScanSearch,
  PlayCircle,
  Circle,
  X,
  Ban,
  Timer,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  Loader,
  Pi,
  ListFilter,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../lib/CurrencyContext';
// @ts-ignore
import messagesLogo from '../assets/messages.svg';
// @ts-ignore
import antigravityLogo from '../assets/antigravity.svg';
// @ts-ignore
import chatLogo from '../assets/chat.svg';
// @ts-ignore
import geminiLogo from '../assets/gemini.svg';
// @ts-ignore
import responsesLogo from '../assets/responses.svg';

const SSE_HEARTBEAT_TIMEOUT_MS = 30_000;
const LIVE_DURATION_UPDATE_INTERVAL_MS = 500;
const DESKTOP_LOGS_MEDIA_QUERY = '(min-width: 1024px)';
const DESKTOP_STATUS_COLUMN_WIDTH = '32px';
const DESKTOP_DATE_COLUMN_WIDTH = '78px';
const DESKTOP_KEY_COLUMN_WIDTH = '82px';
const DESKTOP_API_COLUMN_WIDTH = '58px';
const DESKTOP_TOKENS_COLUMN_WIDTH = '144px';
const DESKTOP_COST_COLUMN_WIDTH = '86px';
const DESKTOP_PERF_COLUMN_WIDTH = '100px';
const DESKTOP_DELETE_COLUMN_WIDTH = '30px';
const DESKTOP_TABLE_MIN_WIDTH = '768px';

const EMPTY_LOG_FILTERS = {
  apiKey: '',
  incomingModelAlias: '',
  provider: '',
  startDate: '',
  endDate: '',
};

const formatReasoningEffort = (effort?: string | null): string | null => {
  if (!effort) return null;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
};

interface ProgressUpdate {
  requestId: string;
  bytesReceived: number;
  bytesPerSec: number | null;
  semanticBytesReceived?: number;
  semanticBytesPerSec?: number | null;
  isStreamed: boolean;
  state: 'DISPATCHED' | 'GRACE_PERIOD' | 'MONITORING' | 'THROUGHPUT_STALLED';
  elapsedMs: number;
}

const API_LOGOS: Record<string, string> = {
  messages: messagesLogo,
  antigravity: antigravityLogo,
  chat: chatLogo,
  gemini: geminiLogo,
  responses: responsesLogo,
  'openai-responses': responsesLogo,
  // pi-ai/OAuth outgoing API types
  'google-generative-ai': geminiLogo,
  'openai-completions': chatLogo,
  'anthropic-messages': messagesLogo,
};

const PI_AI_OUTGOING_TYPES = new Set([
  'google-generative-ai',
  'openai-completions',
  'anthropic-messages',
  'openai-responses',
]);

interface RetryAttemptDetail {
  index: number;
  provider: string;
  model: string;
  apiType?: string;
  status: 'success' | 'failed' | 'skipped';
  reason: string;
  statusCode?: number;
  retryable?: boolean;
}

const parseRetryHistory = (value?: string | null): RetryAttemptDetail[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is RetryAttemptDetail => {
      return (
        entry &&
        typeof entry.index === 'number' &&
        typeof entry.provider === 'string' &&
        typeof entry.model === 'string' &&
        typeof entry.status === 'string' &&
        typeof entry.reason === 'string'
      );
    });
  } catch {
    return [];
  }
};

const getOffsetFromSearchParams = (searchParams: URLSearchParams) => {
  const offsetParam = searchParams.get('offset');
  if (!offsetParam) return 0;

  const parsedOffset = Number(offsetParam);
  if (!Number.isFinite(parsedOffset) || parsedOffset < 0) return 0;

  return Math.floor(parsedOffset);
};

const formatDateSafely = (dateStr: string | undefined | null) => {
  if (!dateStr) return { time: '-', date: '-' };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { time: 'Invalid', date: 'Date' };
    return {
      time: d.toLocaleTimeString(),
      date: d.toISOString().split('T')[0],
    };
  } catch {
    return { time: 'Error', date: 'Date' };
  }
};

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener('change', updateMatches);
    return () => mediaQuery.removeEventListener('change', updateMatches);
  }, [query]);

  return matches;
};

interface PaginationControlsProps {
  position: 'top' | 'bottom';
  currentPage: number;
  totalPages: number;
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}

const PaginationControls = ({
  position,
  currentPage,
  totalPages,
  offset,
  limit,
  total,
  onOffsetChange,
}: PaginationControlsProps) => (
  <div
    className={clsx(
      'flex items-center justify-between gap-2 px-2 py-2 sm:justify-end sm:gap-3 sm:px-3 sm:py-3',
      position === 'top' ? 'border-b border-border' : 'border-t border-border'
    )}
  >
    <span className="text-xs text-text-secondary font-mono">
      Page {currentPage} of {Math.max(1, totalPages)}
    </span>
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - limit))}
      >
        <ChevronLeft size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={offset + limit >= total}
        onClick={() => onOffsetChange(offset + limit)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  </div>
);

interface LogRowProps {
  log: UsageRecord;
  isNewest: boolean;
  liveNow?: number;
  progress?: ProgressUpdate;
  onError: (requestId: string) => void;
  onDebug: (requestId: string) => void;
}

interface DesktopLogRowProps extends LogRowProps {
  onRetryDetails: (log: UsageRecord) => void;
  onDelete: (requestId: string) => void;
}

const MobileLogRow = React.memo(
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

const DesktopLogRow = React.memo(
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
          style={{ width: DESKTOP_KEY_COLUMN_WIDTH, ...(log.sourceIp ? { cursor: 'help' } : {}) }}
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
          title={`Incoming: ${formatApiTypeLabel(log.incomingApiType)} → Outgoing: ${formatApiTypeLabel(log.outgoingApiType)} • ${log.isStreamed ? 'Streamed' : 'Non-streamed'} • ${log.isRaw ? `Raw ${log.requestMethod || ''} ${log.requestPath || ''}` : log.outgoingApiType && PI_AI_OUTGOING_TYPES.has(log.outgoingApiType) ? 'pi-ai native' : log.isPassthrough ? 'Direct/Passthrough' : 'Translated'}`}
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
                  ) : log.outgoingApiType && PI_AI_OUTGOING_TYPES.has(log.outgoingApiType) ? (
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

export const Logs = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { adminKey, isAdmin, isLimited, principal } = useAuth();
  const [logs, setLogs] = useState<UsageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(() => getOffsetFromSearchParams(searchParams));
  const [newestLogId, setNewestLogId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<UsageSortField>('date');
  const [sortDir, setSortDir] = useState<UsageSortDirection>('desc');
  const [filters, setFilters] = useState(EMPTY_LOG_FILTERS);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'all' | 'older'>('older');
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [isDeleting, setIsDeleting] = useState(false);

  // Single Delete State
  const [selectedLogIdForDelete, setSelectedLogIdForDelete] = useState<string | null>(null);
  const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);
  const [selectedRetryLog, setSelectedRetryLog] = useState<UsageRecord | null>(null);
  const [isRetryModalOpen, setIsRetryModalOpen] = useState(false);

  const filtersRef = useRef(filters);
  const seenRequestIdsRef = useRef<Set<string>>(new Set());
  // sseConnected tracks whether the live-update SSE stream is currently active.
  // Used to stop the liveTick timer when the stream drops so duration counters freeze.
  const sseConnected = useRef(false);
  // sseStatus drives the visible connection indicator in the UI.
  const [sseStatus, setSseStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>(
    'disconnected'
  );

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const progressMapRef = useRef<Map<string, ProgressUpdate>>(new Map());
  const progressFrameRef = useRef<number | null>(null);
  // progressTick is incremented to trigger re-renders when progress data changes.
  // The value itself is intentionally unused; only the setter is called.
  const [, setProgressTick] = useState(0);
  const [, setLiveTick] = useState(0);
  const hasUnfrozenPendingLogs = logs.some(
    (log) => log.responseStatus === 'pending' && log.durationMs == null
  );
  const isDesktop = useMediaQuery(DESKTOP_LOGS_MEDIA_QUERY);

  useEffect(() => {
    if (sseStatus !== 'connected' || !hasUnfrozenPendingLogs) return;

    const interval = setInterval(() => {
      setLiveTick((tick) => tick + 1);
    }, LIVE_DURATION_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasUnfrozenPendingLogs, sseStatus]);

  useEffect(() => {
    const nextOffset = getOffsetFromSearchParams(searchParams);
    setOffset((currentOffset) => (currentOffset === nextOffset ? currentOffset : nextOffset));
  }, [searchParams]);

  const updateOffset = (nextOffset: number) => {
    const normalizedOffset = Math.max(0, Math.floor(nextOffset));
    setOffset(normalizedOffset);
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      if (normalizedOffset === 0) {
        nextParams.delete('offset');
      } else {
        nextParams.set('offset', String(normalizedOffset));
      }
      return nextParams;
    });
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const cleanFilters: Record<string, any> = {};
      if (filters.apiKey) cleanFilters.apiKey = filters.apiKey;
      if (filters.incomingModelAlias) cleanFilters.incomingModelAlias = filters.incomingModelAlias;
      if (filters.provider) cleanFilters.provider = filters.provider;
      if (filters.startDate) cleanFilters.startDate = new Date(filters.startDate).toISOString();
      if (filters.endDate) cleanFilters.endDate = new Date(filters.endDate).toISOString();

      const res = await api.getLogs(limit, offset, cleanFilters, sortBy, sortDir);
      seenRequestIdsRef.current = new Set(res.data.map((log) => log.requestId));
      setLogs(res.data);
      setTotal(Number(res.total) || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = () => {
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      if (deleteMode === 'all') {
        await api.deleteAllUsageLogs();
      } else {
        await api.deleteAllUsageLogs(olderThanDays);
      }
      // Reset to first page
      updateOffset(0);
      await loadLogs();
      setIsDeleteModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleError = useCallback(
    (requestId: string) => navigate('/errors', { state: { requestId } }),
    [navigate]
  );
  const handleDebug = useCallback(
    (requestId: string) => navigate('/debug', { state: { requestId } }),
    [navigate]
  );
  const handleRetryDetailsMemo = useCallback((log: UsageRecord) => {
    setSelectedRetryLog(log);
    setIsRetryModalOpen(true);
  }, []);
  const handleDeleteMemo = useCallback((requestId: string) => {
    setSelectedLogIdForDelete(requestId);
    setIsSingleDeleteModalOpen(true);
  }, []);

  const confirmDeleteSingle = async () => {
    if (!selectedLogIdForDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteUsageLog(selectedLogIdForDelete);
      setLogs(logs.filter((l) => l.requestId !== selectedLogIdForDelete));
      seenRequestIdsRef.current.delete(selectedLogIdForDelete);
      setTotal((prev) => Math.max(0, prev - 1));
      setIsSingleDeleteModalOpen(false);
      setSelectedLogIdForDelete(null);
    } catch (e) {
      console.error('Failed to delete log', e);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [offset, limit, sortBy, sortDir]); // Refresh when page or sort changes

  useEffect(() => {
    if (offset !== 0 || !adminKey || sortBy !== 'date' || sortDir !== 'desc') return;

    const controller = new AbortController();

    // Freeze pending logs and update connection status when the stream drops.
    const handleDisconnect = () => {
      sseConnected.current = false;
      setLogs((prev) =>
        prev.map((log) =>
          log.responseStatus === 'pending' && log.durationMs == null
            ? { ...log, durationMs: Date.now() - log.startTime }
            : log
        )
      );
    };

    // Attempt a single SSE connection.
    // Returns:
    //   true  — connected and stream ended (transient; safe to retry)
    //   false — connection-level error (transient; safe to retry)
    //   null  — permanent server error (4xx); stop retrying
    const connectOnce = async (): Promise<boolean | null> => {
      const connectionController = new AbortController();
      const abortConnection = () => connectionController.abort();
      controller.signal.addEventListener('abort', abortConnection, { once: true });
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimedOut = false;
      let streamConnected = false;

      const resetHeartbeatTimer = () => {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
          heartbeatTimedOut = true;
          connectionController.abort();
        }, SSE_HEARTBEAT_TIMEOUT_MS);
      };

      resetHeartbeatTimer();

      try {
        const response = await fetch('/v0/management/events', {
          headers: { 'x-admin-key': adminKey },
          signal: connectionController.signal,
        });

        if (!response.ok) {
          // Non-transient HTTP errors (401, 403, 404, etc.) — no point retrying.
          if (response.status >= 400 && response.status < 500) {
            handleDisconnect();
            console.error(`SSE: permanent error ${response.status} — stopping reconnect`);
            return null;
          }
          throw new Error(`Failed to connect: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) return false;

        streamConnected = true;
        sseConnected.current = true;
        setSseStatus('connected');
        resetHeartbeatTimer();

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            handleDisconnect();
            break;
          }

          // Any bytes prove the stream is alive; the server sends a ping every 10 seconds.
          resetHeartbeatTimer();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n'); // SSE messages are separated by double newline
          buffer = lines.pop() || '';

          for (const block of lines) {
            const blockLines = block.split('\n');
            let eventData = '';
            let eventType = '';

            for (const line of blockLines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7);
              } else if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }

            // Handle progress updates for in-flight requests
            if (eventType === 'progress' && eventData) {
              try {
                const update: ProgressUpdate = JSON.parse(eventData);
                progressMapRef.current.set(update.requestId, update);
                if (progressFrameRef.current == null) {
                  progressFrameRef.current = requestAnimationFrame(() => {
                    progressFrameRef.current = null;
                    setProgressTick((tick) => tick + 1);
                  });
                }
              } catch {
                // ignore malformed progress events
              }
            }

            // Handle different event types: started, updated, completed
            if (
              (eventType === 'started' || eventType === 'updated' || eventType === 'completed') &&
              eventData
            ) {
              try {
                const newLog = JSON.parse(eventData);
                const currentFilters = filtersRef.current;

                // Client-side filtering to match server-side LIKE behavior
                let matches = true;
                if (
                  currentFilters.apiKey &&
                  !newLog.apiKey?.toLowerCase().includes(currentFilters.apiKey.toLowerCase())
                ) {
                  matches = false;
                }
                if (
                  currentFilters.incomingModelAlias &&
                  !newLog.incomingModelAlias
                    ?.toLowerCase()
                    .includes(currentFilters.incomingModelAlias.toLowerCase())
                ) {
                  matches = false;
                }
                if (
                  currentFilters.provider &&
                  !newLog.provider?.toLowerCase().includes(currentFilters.provider.toLowerCase())
                ) {
                  matches = false;
                }
                // Client-side date filtering for SSE events
                if (currentFilters.startDate && newLog.startTime) {
                  const filterStart = new Date(currentFilters.startDate).getTime();
                  if (newLog.startTime < filterStart) matches = false;
                }
                if (currentFilters.endDate && newLog.startTime) {
                  const filterEnd = new Date(currentFilters.endDate).getTime();
                  if (newLog.startTime > filterEnd) matches = false;
                }

                if (matches) {
                  // If a completed event arrives, clear any stale progress entry
                  if (eventType === 'completed') {
                    progressMapRef.current.delete(newLog.requestId);
                  }
                  const isNewRequest = !seenRequestIdsRef.current.has(newLog.requestId);
                  seenRequestIdsRef.current.add(newLog.requestId);
                  setLogs((prev) => {
                    const existingIndex = prev.findIndex((l) => l.requestId === newLog.requestId);
                    if (existingIndex >= 0) {
                      // Merge update into existing record (supports progressive updates)
                      const updated = [...prev];
                      updated[existingIndex] = { ...updated[existingIndex], ...newLog };
                      return updated;
                    }
                    // New record - add to the top
                    const updated = [newLog, ...prev];
                    if (updated.length > limit) return updated.slice(0, limit);
                    return updated;
                  });
                  if (isNewRequest) setTotal((prev) => Number(prev) + 1);
                  setNewestLogId(newLog.requestId);
                }
              } catch (e) {
                console.error('Failed to parse log event', e);
              }
            }
          }
        }

        return true;
      } catch (err: any) {
        handleDisconnect();
        if (err.name === 'AbortError') {
          if (controller.signal.aborted) {
            // Intentional teardown — do not retry.
            throw err;
          }
          if (heartbeatTimedOut) {
            console.warn('SSE heartbeat timed out — reconnecting');
            return streamConnected;
          }
        }
        console.error('Log stream error:', err);
        return false;
      } finally {
        clearTimeout(heartbeatTimer);
        controller.signal.removeEventListener('abort', abortConnection);
      }
    };

    // Reconnect loop with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap).
    // Delay resets to 1s after any successful connection so a brief outage
    // following a long stable session doesn't start with an accumulated delay.
    const run = async () => {
      const MAX_DELAY_MS = 30_000;
      let delay = 1_000;

      while (!controller.signal.aborted) {
        const result = await connectOnce();

        if (controller.signal.aborted) break;

        // Permanent server error (4xx) — stop retrying entirely.
        if (result === null) break;

        // Reset backoff after a successful connection so the next drop after a
        // long stable session starts back at 1 s instead of the accumulated delay.
        if (result === true) delay = 1_000;

        // Stream ended unexpectedly — start reconnecting.
        setSseStatus('reconnecting');

        // Wait before retrying, but bail early if aborted.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          controller.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });

        if (!controller.signal.aborted) {
          delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
      }

      setSseStatus('disconnected');
    };

    run().catch(() => {
      // AbortError from intentional teardown — suppress.
      setSseStatus('disconnected');
    });

    return () => {
      if (progressFrameRef.current != null) {
        cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
      sseConnected.current = false;
      setSseStatus('disconnected');
      controller.abort();
      // Freeze any in-flight logs that are still 'pending' so their duration
      // counter stops at the moment the stream dropped rather than continuing forever.
      setLogs((prev) =>
        prev.map((log) =>
          log.responseStatus === 'pending' && log.durationMs == null
            ? { ...log, durationMs: Date.now() - log.startTime }
            : log
        )
      );
    };
  }, [offset, limit, adminKey, sortBy, sortDir]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setIsMobileFiltersOpen(false);
    if (offset === 0) {
      loadLogs();
      return;
    }
    updateOffset(0);
  };

  const handleLimitChange = (value: string) => {
    const nextLimit = Number(value);
    if (!Number.isFinite(nextLimit) || nextLimit <= 0) return;
    setLimit(nextLimit);
    // Reset to the first page so we don't land on an out-of-range offset.
    updateOffset(0);
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const clearFilters = () => {
    setFilters(EMPTY_LOG_FILTERS);
  };

  const handleSort = (field: UsageSortField) => {
    updateOffset(0);
    if (sortBy === field) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }

    setSortBy(field);
    setSortDir(field === 'date' ? 'desc' : 'asc');
  };

  const renderSortableHeader = (label: string, field: UsageSortField) => {
    const isActive = sortBy === field;

    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="inline-flex items-center justify-center gap-1 bg-transparent border-0 p-0 m-0 font-inherit text-inherit uppercase tracking-wider cursor-pointer"
        title={`Sort by ${label.toLowerCase()}`}
      >
        <span>{label}</span>
        <ChevronDown
          size={12}
          style={{
            opacity: isActive ? 1 : 0.35,
            transform: isActive && sortDir === 'asc' ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease, opacity 0.2s ease',
          }}
        />
      </button>
    );
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  const liveNow = hasUnfrozenPendingLogs ? Date.now() : undefined;

  const selectedRetryHistory = parseRetryHistory(selectedRetryLog?.retryHistory);
  const showLiveStatus = !!adminKey && offset === 0 && sortBy === 'date' && sortDir === 'desc';

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Logs"
        subtitle={
          principal?.role === 'limited' && principal.keyName
            ? `Scoped to key "${principal.keyName}"`
            : 'All API requests routed through the gateway'
        }
        className="py-2.5 sm:py-4"
        actions={
          <>
            {/* SSE live-update connection status — only visible when on page 1, sorted by date desc */}
            {showLiveStatus && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium select-none sm:px-2.5',
                  sseStatus === 'connected' && 'bg-green-500/10 text-green-400 border-green-500/20',
                  sseStatus === 'reconnecting' &&
                    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
                  sseStatus === 'disconnected' &&
                    'bg-red-500/10 text-text-muted border-border-glass'
                )}
                title={
                  sseStatus === 'connected'
                    ? 'Live updates active'
                    : sseStatus === 'reconnecting'
                      ? 'Reconnecting to live updates…'
                      : 'Live updates disconnected'
                }
              >
                {sseStatus === 'connected' && <Wifi size={12} />}
                {sseStatus === 'reconnecting' && <Loader size={12} className="animate-spin" />}
                {sseStatus === 'disconnected' && <WifiOff size={12} />}
                <span className="hidden sm:inline">
                  {sseStatus === 'connected'
                    ? 'Live'
                    : sseStatus === 'reconnecting'
                      ? 'Reconnecting…'
                      : 'Disconnected'}
                </span>
              </span>
            )}
            {isAdmin && (
              <Button
                onClick={handleDeleteAll}
                variant="danger"
                size="sm"
                leftIcon={<Trash2 size={14} />}
                disabled={logs.length === 0}
                type="button"
              >
                Delete All
              </Button>
            )}
          </>
        }
      >
        <div className="lg:hidden">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full justify-between"
            onClick={() => setIsMobileFiltersOpen(true)}
            leftIcon={<ListFilter size={15} />}
          >
            <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            <ChevronRight size={15} className="rotate-180" />
          </Button>
        </div>

        <form
          onSubmit={handleSearch}
          className="hidden w-full min-w-0 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-2"
        >
          <div className={clsx('grid min-w-0 gap-2', isLimited ? 'grid-cols-2' : 'grid-cols-3')}>
            {!isLimited && (
              <div className="min-w-0">
                <SearchInput
                  placeholder="Key…"
                  value={filters.apiKey}
                  onChange={(v) => setFilters({ ...filters, apiKey: v })}
                  className="!h-8 text-xs"
                />
              </div>
            )}
            <div className="min-w-0">
              <SearchInput
                placeholder="Model…"
                value={filters.incomingModelAlias}
                onChange={(v) => setFilters({ ...filters, incomingModelAlias: v })}
                className="!h-8 text-xs"
              />
            </div>
            <div className="min-w-0">
              <SearchInput
                placeholder="Provider…"
                value={filters.provider}
                onChange={(v) => setFilters({ ...filters, provider: v })}
                className="!h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <PlayCircle size={14} className="shrink-0 text-slate-400" />
              <DateTimePicker
                value={filters.startDate}
                onChange={(v) => setFilters((prev) => ({ ...prev, startDate: v }))}
                placeholder="Start date"
                className="min-w-0 flex-1 [&>button]:!h-8 [&>button]:!w-full [&>button]:!min-w-0 [&>button]:!gap-1.5 [&>button]:!px-2 [&>button]:!py-0 [&>button]:!text-xs"
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Circle size={14} className="shrink-0 text-slate-400" />
              <DateTimePicker
                value={filters.endDate}
                onChange={(v) => setFilters((prev) => ({ ...prev, endDate: v }))}
                placeholder="End date"
                className="min-w-0 flex-1 [&>button]:!h-8 [&>button]:!w-full [&>button]:!min-w-0 [&>button]:!gap-1.5 [&>button]:!px-2 [&>button]:!py-0 [&>button]:!text-xs"
              />
            </div>
            {(filters.startDate || filters.endDate) && (
              <button
                type="button"
                onClick={() => setFilters({ ...filters, startDate: '', endDate: '' })}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-text-muted transition-colors duration-fast hover:bg-bg-hover hover:text-text"
                title="Clear date filters"
                aria-label="Clear date filters"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="submit" variant="primary" size="sm" className="!h-8">
              Search
            </Button>
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <label htmlFor="logs-per-page" className="text-xs font-medium text-text-secondary">
                Per page
              </label>
              <div className="w-[4.5rem]">
                <Select
                  id="logs-per-page"
                  value={String(limit)}
                  onChange={handleLimitChange}
                  className="!h-8 !py-0 !pl-2 !pr-7 text-xs"
                  options={[
                    { value: '20', label: '20' },
                    { value: '50', label: '50' },
                    { value: '100', label: '100' },
                    { value: '200', label: '200' },
                  ]}
                />
              </div>
            </div>
          </div>
        </form>
      </PageHeader>

      <Drawer
        open={isMobileFiltersOpen}
        onClose={() => setIsMobileFiltersOpen(false)}
        side="right"
        aria-label="Log filters"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border-glass p-4">
            <div>
              <h2 className="m-0 font-heading text-lg font-semibold text-text">Filters</h2>
              <p className="mt-1 text-xs text-text-secondary">Narrow down the request logs.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsMobileFiltersOpen(false)}
              className="rounded-md border-0 bg-transparent p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text"
              aria-label="Close filters"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {!isLimited && (
                <SearchInput
                  label="Key"
                  placeholder="Search by key…"
                  value={filters.apiKey}
                  onChange={(v) => setFilters({ ...filters, apiKey: v })}
                  className="h-10 text-sm"
                />
              )}
              <SearchInput
                label="Model"
                placeholder="Search by model…"
                value={filters.incomingModelAlias}
                onChange={(v) => setFilters({ ...filters, incomingModelAlias: v })}
                className="h-10 text-sm"
              />
              <SearchInput
                label="Provider"
                placeholder="Search by provider…"
                value={filters.provider}
                onChange={(v) => setFilters({ ...filters, provider: v })}
                className="h-10 text-sm"
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                  <PlayCircle size={15} />
                  <span>Start date</span>
                </div>
                <DateTimePicker
                  value={filters.startDate}
                  onChange={(v) => setFilters((prev) => ({ ...prev, startDate: v }))}
                  placeholder="Select start date"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                  <Circle size={15} />
                  <span>End date</span>
                </div>
                <DateTimePicker
                  value={filters.endDate}
                  onChange={(v) => setFilters((prev) => ({ ...prev, endDate: v }))}
                  placeholder="Select end date"
                  className="w-full"
                />
              </div>
              <Select
                label="Per page"
                value={String(limit)}
                onChange={handleLimitChange}
                options={[
                  { value: '20', label: '20' },
                  { value: '50', label: '50' },
                  { value: '100', label: '100' },
                  { value: '200', label: '200' },
                ]}
              />
            </div>
            <div className="flex gap-2 border-t border-border-glass p-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={clearFilters}
                disabled={activeFilterCount === 0}
              >
                Clear
              </Button>
              <Button type="submit" variant="primary" size="sm" className="flex-1">
                Apply filters
              </Button>
            </div>
          </form>
        </div>
      </Drawer>

      <PageContainer>
        <Card flush>
          <PaginationControls
            position="top"
            currentPage={currentPage}
            totalPages={totalPages}
            offset={offset}
            limit={limit}
            total={total}
            onOffsetChange={updateOffset}
          />

          {!isDesktop && (
            <div className="space-y-1.5 p-2">
              {loading ? (
                <div className="rounded-lg border border-border-glass bg-bg-subtle p-4 text-center text-sm text-text-secondary">
                  Loading...
                </div>
              ) : logs.length === 0 ? (
                <div className="rounded-lg border border-border-glass bg-bg-subtle p-4 text-center text-sm text-text-secondary">
                  No logs found
                </div>
              ) : (
                logs.map((log) => {
                  return (
                    <MobileLogRow
                      key={log.requestId}
                      log={log}
                      isNewest={log.requestId === newestLogId}
                      liveNow={
                        log.responseStatus === 'pending' && log.durationMs == null
                          ? liveNow
                          : undefined
                      }
                      progress={
                        log.responseStatus === 'pending'
                          ? progressMapRef.current.get(log.requestId)
                          : undefined
                      }
                      onError={handleError}
                      onDebug={handleDebug}
                    />
                  );
                })
              )}
            </div>
          )}

          {isDesktop && (
            <div className="overflow-x-auto">
              <table
                className="w-full table-fixed border-collapse font-body text-[13px]"
                style={{ minWidth: DESKTOP_TABLE_MIN_WIDTH }}
              >
                <colgroup>
                  <col style={{ width: DESKTOP_STATUS_COLUMN_WIDTH }} />
                  <col style={{ width: DESKTOP_DATE_COLUMN_WIDTH }} />
                  <col style={{ width: DESKTOP_KEY_COLUMN_WIDTH }} />
                  <col style={{ width: DESKTOP_API_COLUMN_WIDTH }} />
                  <col />
                  <col style={{ width: DESKTOP_TOKENS_COLUMN_WIDTH }} />
                  <col style={{ width: DESKTOP_COST_COLUMN_WIDTH }} />
                  <col style={{ width: DESKTOP_PERF_COLUMN_WIDTH }} />
                  <col className="hidden min-[1150px]:table-column" />
                  <col style={{ width: DESKTOP_DELETE_COLUMN_WIDTH }} />
                </colgroup>
                <thead>
                  <tr className="text-center border-b border-border">
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_STATUS_COLUMN_WIDTH }}
                    >
                      <span className="sr-only">Status</span>
                      <Circle size={12} className="mx-auto" aria-hidden="true" />
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_DATE_COLUMN_WIDTH }}
                    >
                      {renderSortableHeader('Date', 'date')}
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_KEY_COLUMN_WIDTH }}
                    >
                      {renderSortableHeader('Key', 'apiKey')}
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_API_COLUMN_WIDTH }}
                    >
                      API
                    </th>
                    <th className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                      {renderSortableHeader('Model', 'incomingModelAlias')}
                    </th>
                    {/* <th style={{ padding: '6px' }}>Provider</th> */}
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_TOKENS_COLUMN_WIDTH }}
                    >
                      Tokens
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_COST_COLUMN_WIDTH }}
                    >
                      {renderSortableHeader('Cost', 'costTotal')}
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{
                        width: DESKTOP_PERF_COLUMN_WIDTH,
                        minWidth: DESKTOP_PERF_COLUMN_WIDTH,
                      }}
                    >
                      {renderSortableHeader('Perf', 'durationMs')}
                    </th>
                    <th className="hidden px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap min-[1150px]:table-cell">
                      Meta
                    </th>
                    <th
                      className="px-1 py-1.5 text-center border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                      style={{ width: DESKTOP_DELETE_COLUMN_WIDTH }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Trash2 size={12} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="p-5 text-center">
                        Loading...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-5 text-center">
                        No logs found
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <DesktopLogRow
                        key={log.requestId}
                        log={log}
                        isNewest={log.requestId === newestLogId}
                        liveNow={
                          log.responseStatus === 'pending' && log.durationMs == null
                            ? liveNow
                            : undefined
                        }
                        progress={
                          log.responseStatus === 'pending'
                            ? progressMapRef.current.get(log.requestId)
                            : undefined
                        }
                        onError={handleError}
                        onDebug={handleDebug}
                        onRetryDetails={handleRetryDetailsMemo}
                        onDelete={handleDeleteMemo}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <PaginationControls
            position="bottom"
            currentPage={currentPage}
            totalPages={totalPages}
            offset={offset}
            limit={limit}
            total={total}
            onOffsetChange={updateOffset}
          />
        </Card>
      </PageContainer>

      <Modal
        isOpen={isRetryModalOpen}
        onClose={() => setIsRetryModalOpen(false)}
        title="Retry History"
        footer={
          <Button variant="secondary" onClick={() => setIsRetryModalOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="text-sm text-text-secondary">
            <div>
              Request: <span className="text-text">{selectedRetryLog?.requestId || '-'}</span>
            </div>
            <div>
              Attempts: <span className="text-text">{selectedRetryLog?.attemptCount || 1}</span>
            </div>
          </div>

          {selectedRetryHistory.length === 0 ? (
            <div className="text-sm text-text-secondary">
              No retry history is available for this request.
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
              {selectedRetryHistory.map((attempt) => (
                <div
                  key={`${attempt.index}-${attempt.provider}-${attempt.model}`}
                  className={clsx(
                    'rounded-lg border p-3',
                    attempt.status === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/10'
                      : attempt.status === 'skipped'
                        ? 'border-yellow-500/30 bg-yellow-500/10'
                        : 'border-red-500/30 bg-red-500/10'
                  )}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="font-medium text-sm text-text">
                      Attempt {attempt.index}: {attempt.provider}/{attempt.model}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-text-secondary">
                      {attempt.status}
                    </div>
                  </div>
                  <div className="text-sm text-text-secondary">
                    <div>API: {attempt.apiType || '-'}</div>
                    {attempt.statusCode ? <div>Status Code: {attempt.statusCode}</div> : null}
                    {attempt.retryable !== undefined ? (
                      <div>Retryable: {attempt.retryable ? 'yes' : 'no'}</div>
                    ) : null}
                    <div className="mt-2 text-text">{attempt.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Confirm Deletion"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Logs'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p>Select which logs you would like to delete:</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="radio"
              id="delete-older"
              name="deleteMode"
              checked={deleteMode === 'older'}
              onChange={() => setDeleteMode('older')}
            />
            <label htmlFor="delete-older">Delete logs older than</label>
            <Input
              type="number"
              min="1"
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(parseInt(e.target.value) || 1)}
              style={{ width: '60px', padding: '4px 8px' }}
              disabled={deleteMode !== 'older'}
            />
            <span>days</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="radio"
              id="delete-all"
              name="deleteMode"
              checked={deleteMode === 'all'}
              onChange={() => setDeleteMode('all')}
            />
            <label htmlFor="delete-all" style={{ color: 'var(--color-danger)' }}>
              Delete ALL logs (Cannot be undone)
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isSingleDeleteModalOpen}
        onClose={() => setIsSingleDeleteModalOpen(false)}
        title="Confirm Deletion"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsSingleDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteSingle} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Log'}
            </Button>
          </>
        }
      >
        <p>
          Are you sure you want to delete log <strong>{selectedLogIdForDelete}</strong>? This action
          cannot be undone.
        </p>
      </Modal>
    </div>
  );
};
