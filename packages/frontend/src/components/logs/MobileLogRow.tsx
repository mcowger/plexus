import { clsx } from 'clsx';
import {
  AlertTriangle,
  Ban,
  BrainCog,
  CheckCircle,
  ChevronRight,
  CircleHelp,
  Plane,
  Timer,
  XCircle,
} from 'lucide-react';
import React, { useRef, useState } from 'react';

import { formatApiTypeLabel } from '../../lib/apiFormats';
import { useCurrency } from '../../lib/CurrencyContext';
import { formatCostIn, formatMs, formatTPS, getEstimatedBytesPerToken } from '../../lib/format';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {
  formatDateSafely,
  formatReasoningEffort,
  getServiceTierDisplay,
  hasUpstreamRewrite,
} from './helpers';
import type { LogRowProps } from './types';

const COMPACT_EFFORTS: Partial<Record<string, string>> = {
  minimal: 'Min',
  medium: 'Med',
  xhigh: 'X-Hi',
};

const getThroughput = (
  log: LogRowProps['log'],
  status: string,
  progress: LogRowProps['progress']
): string | null => {
  if (status === 'pending') {
    if (!progress) return null;
    const bytesReceived = progress.semanticBytesReceived ?? progress.bytesReceived;
    let bytesPerSec = progress.semanticBytesPerSec ?? progress.bytesPerSec ?? 0;
    if (!(bytesPerSec > 0) && progress.elapsedMs > 0) {
      bytesPerSec = (bytesReceived / progress.elapsedMs) * 1000;
    }
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return null;
    const bytesPerToken = getEstimatedBytesPerToken({ ...log, isStreamed: progress.isStreamed });
    return `~${formatTPS(bytesPerSec / bytesPerToken)} tok/s`;
  }

  const outputTokens = (log.tokensOutput ?? 0) + (log.tokensReasoning ?? 0);
  const durationMs = log.durationMs ?? 0;
  if (durationMs > 0 && outputTokens > 0) {
    return `${formatTPS(outputTokens / (durationMs / 1000))} tok/s`;
  }
  return null;
};

const ERROR_STATUS_BADGE = {
  Icon: XCircle,
  color: 'border-danger/30 bg-red-500/15 text-danger',
};

const STATUS_BADGES: Partial<Record<string, typeof ERROR_STATUS_BADGE>> = {
  success: { Icon: CheckCircle, color: 'border-success/30 bg-emerald-500/15 text-success' },
  pending: { Icon: Plane, color: 'border-warning/30 bg-yellow-500/15 text-warning' },
  cancelled: { Icon: Ban, color: 'border-blue-400/30 bg-blue-500/15 text-blue-400' },
  timeout: { Icon: Timer, color: 'border-orange-400/30 bg-orange-500/15 text-orange-400' },
  unknown: { Icon: CircleHelp, color: 'border-border-glass bg-bg-subtle text-text-secondary' },
};

const MobileLogDetails = ({
  log,
  timestamp,
  status,
  effort,
  duration,
  cost,
  throughput,
}: Pick<LogRowProps, 'log'> & {
  timestamp: string;
  status: string;
  effort: string | null;
  duration: string | null;
  cost: string | null;
  throughput: string | null;
}) => {
  const provider = log.finalAttemptProvider ?? log.provider;
  const routeModel = log.finalAttemptModel ?? log.selectedModelName;
  const tier = getServiceTierDisplay(log);

  const fields = [
    ['Model alias', log.incomingModelAlias],
    ['Status', status],
    ['Timestamp', timestamp],
    [status === 'pending' ? 'Elapsed' : 'Duration', duration],
    ['Cost', cost],
    ['Reasoning effort', effort],
    ['Route', [provider, routeModel].filter(Boolean).join(' / ')],
    ['Upstream model', hasUpstreamRewrite(log) ? log.upstreamModel : null],
    ['Service tier', tier?.tooltip],
    [
      'Request path',
      log.requestPath && [log.requestMethod, log.requestPath].filter(Boolean).join(' '),
    ],
    ['Request ID', log.requestId],
    ['Key name', log.apiKey],
    ['Incoming API', log.incomingApiType && formatApiTypeLabel(log.incomingApiType)],
    ['Outgoing API', log.outgoingApiType && formatApiTypeLabel(log.outgoingApiType)],
    ['Input tokens', log.tokensInput?.toLocaleString()],
    ['Output tokens', log.tokensOutput?.toLocaleString()],
    ['Reasoning tokens', log.tokensReasoning?.toLocaleString()],
    ['Cached tokens', log.tokensCached?.toLocaleString()],
    ['Cache write tokens', log.tokensCacheWrite?.toLocaleString()],
    [status === 'pending' ? 'Estimated throughput' : 'End-to-end throughput', throughput],
    ['Messages', log.messageCount],
    ['Tool calls', log.toolCallsCount],
  ];

  return (
    <dl className="text-text grid gap-3 text-sm whitespace-nowrap">
      {fields.map(([label, value]) =>
        value !== null && value !== undefined && value !== '' ? (
          <div key={label} className="min-w-0">
            <dt className="text-text-secondary text-xs">{label}</dt>
            <dd className="overflow-x-auto">{value}</dd>
          </div>
        ) : null
      )}
    </dl>
  );
};

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
    const [detailsOpen, setDetailsOpen] = useState(false);
    const detailsButton = useRef<HTMLButtonElement>(null);
    const closeDetails = () => {
      setDetailsOpen(false);
      detailsButton.current?.focus();
    };
    const { date, time } = formatDateSafely(log.date);
    const status = log.responseStatus || (log.hasError ? 'error' : 'unknown');
    const alias = log.incomingModelAlias || log.requestPath || 'Unknown model';
    const effort = formatReasoningEffort(log.reasoningEffort);
    const effortKey = effort?.toLowerCase();
    const shortEffort =
      effortKey && Object.hasOwn(COMPACT_EFFORTS, effortKey) ? COMPACT_EFFORTS[effortKey] : effort;
    const liveTimestamp = liveNow ?? null;
    let durationMs = log.durationMs ?? null;
    if (durationMs === null && status === 'pending' && liveTimestamp !== null) {
      durationMs = liveTimestamp - log.startTime;
    }
    const duration = durationMs === null ? null : formatMs(Math.max(0, durationMs));
    const throughput = getThroughput(log, status, progress);
    const costTotal = log.costTotal ?? null;
    const cost = costTotal === null ? null : formatCostIn(costTotal, { currency, rate, symbol });
    const provider = log.finalAttemptProvider ?? log.provider;
    const attemptCount = log.attemptCount ?? 0;
    const badge = Object.hasOwn(STATUS_BADGES, status) ? STATUS_BADGES[status] : undefined;
    const { Icon: StatusIcon, color: statusColor } = badge ?? ERROR_STATUS_BADGE;

    return (
      <article
        className={clsx(
          'border-border-glass bg-bg-card flex h-16 min-w-0 items-center rounded-lg border shadow-sm',
          isNewest && 'animate-slide-in',
          status === 'pending' && 'bg-yellow-500/5'
        )}
      >
        <button
          ref={detailsButton}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setDetailsOpen(true)}
          className="hover:bg-bg-hover focus-visible:outline-primary @container flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center gap-1 rounded-lg px-2.5 text-left whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className="text-text min-w-0 flex-1 truncate text-sm font-medium">{alias}</span>
            {throughput && (
              <span className="text-text-secondary shrink-0 text-xs tabular-nums">
                <span className="sr-only">
                  {status === 'pending' ? 'Estimated throughput: ' : 'End-to-end throughput: '}
                </span>
                {throughput}
              </span>
            )}
            {shortEffort && (
              <span className="inline-flex max-w-20 shrink-0 items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-xs font-medium text-purple-300">
                <BrainCog size={12} className="shrink-0" aria-hidden="true" />
                <span className="sr-only">Reasoning effort: {effort}</span>
                <span className="truncate" aria-hidden="true">
                  {shortEffort}
                </span>
              </span>
            )}
            <span
              title={`Status: ${status}`}
              className={clsx(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full border',
                statusColor
              )}
            >
              <StatusIcon size={14} aria-hidden="true" />
              <span className="sr-only">Status: {status}</span>
            </span>
          </span>
          <span className="text-text-secondary flex w-full min-w-0 items-center gap-1.5 text-xs tabular-nums">
            <time className="shrink-0" dateTime={log.date}>
              {time}
            </time>
            {duration && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  <span className="sr-only">
                    {status === 'pending' ? 'Elapsed: ' : 'Duration: '}
                  </span>
                  {duration}
                </span>
              </>
            )}
            {cost && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  <span className="sr-only">Cost: </span>
                  {cost}
                </span>
              </>
            )}
            {provider && (
              <span className="min-w-0 truncate" title={provider}>
                <span className="mr-1.5" aria-hidden="true">
                  ·
                </span>
                <span className="sr-only">Provider: </span>
                {provider}
              </span>
            )}
            {attemptCount > 1 && (
              <span className="hidden shrink-0 @min-[22rem]:inline">
                <span className="mr-1.5" aria-hidden="true">
                  ·
                </span>
                {attemptCount} attempts
              </span>
            )}
            <ChevronRight className="ml-auto shrink-0" size={16} aria-hidden="true" />
            <span className="sr-only">View request details</span>
          </span>
        </button>
        {log.hasError && (
          <Button
            type="button"
            size="icon"
            variant="danger"
            className="focus-visible:outline-primary mr-1 min-h-11 min-w-11 shrink-0 focus-visible:outline-2"
            aria-label="View error"
            onClick={() => onError(log.requestId)}
          >
            <AlertTriangle size={16} aria-hidden="true" />
          </Button>
        )}
        {detailsOpen && (
          <Modal
            isOpen
            onClose={closeDetails}
            title="Request details"
            size="sm"
            footer={
              <>
                {log.hasDebug && (
                  <Button variant="secondary" onClick={() => onDebug(log.requestId)}>
                    Debug trace
                  </Button>
                )}
                {onRetryDetails && attemptCount > 1 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      closeDetails();
                      onRetryDetails(log);
                    }}
                  >
                    Retry history ({attemptCount})
                  </Button>
                )}
                <Button variant="secondary" autoFocus onClick={closeDetails}>
                  Close
                </Button>
              </>
            }
          >
            <MobileLogDetails
              log={log}
              throughput={throughput}
              timestamp={`${date} ${time}`}
              status={status}
              effort={effort}
              duration={duration}
              cost={cost}
            />
          </Modal>
        )}
      </article>
    );
  }
);
