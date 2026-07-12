import React, { useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { CostToolTip } from '../components/ui/CostToolTip';
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
  KWH_PER_SLICE,
  formatBytes,
  formatCost,
  formatEnergy,
  formatMs,
  formatSlices,
  formatTPS,
} from '../lib/format';
import { isClipboardAvailable, copyToClipboard } from '../lib/clipboard';
import { formatApiTypeLabel, getApiBaseType } from '../lib/apiFormats';
import { DateTimePicker } from '../components/ui/DateTimePicker';
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
  Gauge,
  Wifi,
  WifiOff,
  Loader,
  Pi,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
  const [filters, setFilters] = useState({
    apiKey: '',
    incomingModelAlias: '',
    provider: '',
    startDate: '',
    endDate: '',
  });

  const apiLogos: Record<string, string> = {
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

  interface ProgressUpdate {
    requestId: string;
    bytesReceived: number;
    bytesPerSec: number | null;
    state: 'DISPATCHED' | 'GRACE_PERIOD' | 'MONITORING' | 'THROUGHPUT_STALLED';
    elapsedMs: number;
  }

  const progressMapRef = useRef<Map<string, ProgressUpdate>>(new Map());
  // progressTick is incremented to trigger re-renders when progress data changes.
  // The value itself is intentionally unused; only the setter is called.
  const [, setProgressTick] = useState(0);
  // liveTick triggers re-renders every 100ms so pending-request durations update live.
  const [, setLiveTick] = useState(0);

  useEffect(() => {
    // Only tick while the SSE stream is active so duration counters freeze when it drops.
    const interval = setInterval(() => {
      if (sseConnected.current) setLiveTick((t) => t + 1);
    }, 100);
    return () => clearInterval(interval);
  }, []);

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

  const handleDelete = (requestId: string) => {
    setSelectedLogIdForDelete(requestId);
    setIsSingleDeleteModalOpen(true);
  };

  const handleRetryDetails = (log: UsageRecord) => {
    setSelectedRetryLog(log);
    setIsRetryModalOpen(true);
  };

  const confirmDeleteSingle = async () => {
    if (!selectedLogIdForDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteUsageLog(selectedLogIdForDelete);
      setLogs(logs.filter((l) => l.requestId !== selectedLogIdForDelete));
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
                setProgressTick((t) => t + 1);
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
                  setTotal((prev) => Number(prev) + 1);
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

  const formatDateSafely = (dateStr: string | undefined | null) => {
    if (!dateStr) return { time: '-', date: '-' };
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return { time: 'Invalid', date: 'Date' };
      return {
        time: d.toLocaleTimeString(),
        date: d.toISOString().split('T')[0],
      };
    } catch (e) {
      return { time: 'Error', date: 'Date' };
    }
  };

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
        <form
          onSubmit={handleSearch}
          className="grid grid-cols-3 items-end gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-end"
        >
          {!isLimited && (
            <div className="col-span-1 sm:w-56">
              <SearchInput
                placeholder="Key…"
                value={filters.apiKey}
                onChange={(v) => setFilters({ ...filters, apiKey: v })}
              />
            </div>
          )}
          <div className="col-span-1 sm:w-56">
            <SearchInput
              placeholder="Model…"
              value={filters.incomingModelAlias}
              onChange={(v) => setFilters({ ...filters, incomingModelAlias: v })}
            />
          </div>
          <div className="col-span-1 sm:w-44">
            <SearchInput
              placeholder="Provider…"
              value={filters.provider}
              onChange={(v) => setFilters({ ...filters, provider: v })}
            />
          </div>
          <div className="hidden sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
              <PlayCircle size={18} className="shrink-0 text-slate-400 sm:h-6 sm:w-6" />
              <DateTimePicker
                value={filters.startDate}
                onChange={(v) => setFilters((prev) => ({ ...prev, startDate: v }))}
                placeholder="Start date"
                className="min-w-0 flex-1 sm:flex-none"
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
              <Circle size={18} className="shrink-0 text-slate-400 sm:h-6 sm:w-6" />
              <DateTimePicker
                value={filters.endDate}
                onChange={(v) => setFilters((prev) => ({ ...prev, endDate: v }))}
                placeholder="End date"
                className="min-w-0 flex-1 sm:flex-none"
              />
            </div>
            {(filters.startDate || filters.endDate) && (
              <button
                type="button"
                onClick={() => setFilters({ ...filters, startDate: '', endDate: '' })}
                className="rounded-md border-0 bg-transparent text-text-muted transition-colors duration-fast hover:bg-bg-hover hover:text-text"
                title="Clear date filters"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" size="sm" className="col-span-2 w-full sm:w-auto">
            Search
          </Button>
          <div className="col-span-1 sm:w-40">
            <Select
              label="Per page"
              value={String(limit)}
              onChange={handleLimitChange}
              className="py-1.5 sm:py-2"
              options={[
                { value: '20', label: '20' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
                { value: '200', label: '200' },
              ]}
            />
          </div>
        </form>
      </PageHeader>

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

          <div className="space-y-1.5 p-2 lg:hidden">
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
                const formatted = formatDateSafely(log.date);
                const totalTokens =
                  Number(log.tokensInput || 0) +
                  Number(log.tokensOutput || 0) +
                  Number(log.tokensCached || 0) +
                  Number(log.tokensCacheWrite || 0) +
                  Number(log.tokensReasoning || 0);
                const e2eOutputTokens =
                  Number(log.tokensOutput || 0) + Number(log.tokensReasoning || 0);
                const status = log.responseStatus || (log.hasError ? 'error' : 'unknown');
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
                    key={log.requestId}
                    className={clsx(
                      'rounded-lg border border-border-glass bg-bg-card p-2 shadow-sm',
                      log.requestId === newestLogId && 'animate-slide-in',
                      log.responseStatus === 'pending' && 'bg-yellow-500/5'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-medium text-text">
                          {formatted.time}{' '}
                          <span className="text-[10px] text-text-muted">{formatted.date}</span>
                        </div>
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

                    <div className="mt-1.5 space-y-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-text">
                          {log.incomingModelAlias || '-'}
                          <span className="font-normal text-text-secondary">
                            {' '}
                            · {log.provider || '-'}:{log.selectedModelName || '-'}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="truncate text-text">
                            <span className="text-[9px] uppercase text-text-muted">Key </span>
                            {log.apiKey || '-'}
                          </div>
                        </div>
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="flex items-center gap-1 text-text">
                            <div className="flex w-4 shrink-0 justify-center">
                              {log.incomingApiType === 'embeddings' ? (
                                <Variable size={14} className="text-green-500" />
                              ) : log.incomingApiType === 'transcriptions' ? (
                                <AudioLines size={14} className="text-purple-500" />
                              ) : log.incomingApiType === 'speech' ? (
                                <Volume2 size={14} className="text-orange-500" />
                              ) : log.incomingApiType === 'images' ? (
                                <ImageIcon size={14} className="text-fuchsia-500" />
                              ) : log.incomingApiType === 'oauth' ? (
                                <ShieldCheck size={14} className="text-emerald-500" />
                              ) : log.incomingApiType &&
                                apiLogos[getApiBaseType(log.incomingApiType)] ? (
                                <img
                                  src={apiLogos[getApiBaseType(log.incomingApiType)]}
                                  alt={formatApiTypeLabel(log.incomingApiType)}
                                  title={formatApiTypeLabel(log.incomingApiType)}
                                  className="h-3.5 w-3.5"
                                />
                              ) : (
                                <span className="text-[10px] text-text-muted">?</span>
                              )}
                            </div>
                            <span className="text-[10px] text-text-muted">→</span>
                            <div className="flex w-4 shrink-0 justify-center">
                              {log.outgoingApiType === 'embeddings' ? (
                                <Variable size={14} className="text-green-500" />
                              ) : log.outgoingApiType === 'transcriptions' ? (
                                <AudioLines size={14} className="text-purple-500" />
                              ) : log.outgoingApiType === 'speech' ? (
                                <Volume2 size={14} className="text-orange-500" />
                              ) : log.outgoingApiType === 'images' ? (
                                <ImageIcon size={14} className="text-fuchsia-500" />
                              ) : log.outgoingApiType === 'oauth' ? (
                                <ShieldCheck size={14} className="text-emerald-500" />
                              ) : log.outgoingApiType &&
                                apiLogos[getApiBaseType(log.outgoingApiType)] ? (
                                <img
                                  src={apiLogos[getApiBaseType(log.outgoingApiType)]}
                                  alt={formatApiTypeLabel(log.outgoingApiType)}
                                  title={formatApiTypeLabel(log.outgoingApiType)}
                                  className="h-3.5 w-3.5"
                                />
                              ) : (
                                <span className="text-[10px] text-text-muted">?</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="truncate text-text">
                            <span className="text-[9px] uppercase text-text-muted">Tok </span>
                            {formatLargeNumber(totalTokens)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="truncate text-text">
                            <span className="text-[9px] uppercase text-text-muted">Cost </span>
                            {log.costTotal == null || log.costTotal === 0
                              ? '-'
                              : formatCost(log.costTotal)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="truncate text-text">
                            <span className="text-[9px] uppercase text-text-muted">E2E </span>
                            {log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0
                              ? formatTPS(e2eOutputTokens / (log.durationMs / 1000))
                              : '-'}
                          </div>
                        </div>
                        <div className="min-w-0 rounded bg-bg-subtle px-1.5 py-1">
                          <div className="truncate text-text">
                            <span className="text-[9px] uppercase text-text-muted">Meta </span>
                            {(log.messageCount || 0) === 0 ? '-' : log.messageCount} msg /{' '}
                            {(log.toolCallsCount || 0) === 0 ? '-' : log.toolCallsCount} tools
                          </div>
                        </div>
                      </div>
                    </div>

                    {(log.hasError || log.hasDebug) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {log.hasError && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              navigate('/errors', { state: { requestId: log.requestId } })
                            }
                          >
                            <AlertTriangle size={12} />
                            Error
                          </Button>
                        )}
                        {log.hasDebug && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              navigate('/debug', { state: { requestId: log.requestId } })
                            }
                          >
                            <Bug size={12} />
                            Debug
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse font-body text-[13px]">
              <thead>
                <tr className="text-center border-b border-border">
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    {renderSortableHeader('Date', 'date')}
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    {renderSortableHeader('Key', 'apiKey')}
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    API
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    {renderSortableHeader('Model', 'incomingModelAlias')}
                  </th>
                  {/* <th style={{ padding: '6px' }}>Provider</th> */}
                  <th
                    className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                    style={{ width: '125px' }}
                  >
                    Tokens
                  </th>
                  <th
                    className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap"
                    style={{ minWidth: '130px' }}
                  >
                    {renderSortableHeader('Cost', 'costTotal')}
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap min-w-[140px]">
                    {renderSortableHeader('Perf', 'durationMs')}
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    Meta
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-2 py-1.5 text-center border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Trash2 size={12} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="p-5 text-center">
                      Loading...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-5 text-center">
                      No logs found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.requestId}
                      className={clsx(
                        'group border-b border-border-glass hover:bg-bg-hover',
                        log.requestId === newestLogId && 'animate-slide-in'
                      )}
                      style={{
                        height: '86px',
                        backgroundColor:
                          log.responseStatus === 'pending' ? 'rgba(234, 179, 8, 0.08)' : undefined,
                      }}
                    >
                      <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
                        className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle"
                        title={log.sourceIp ? `IP: ${log.sourceIp}` : undefined}
                        style={log.sourceIp ? { cursor: 'help' } : undefined}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '500' }}>{log.apiKey || '-'}</span>
                          {log.attribution && (
                            <span
                              style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                            >
                              {log.attribution}
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
                        title={`Incoming: ${formatApiTypeLabel(log.incomingApiType)} → Outgoing: ${formatApiTypeLabel(log.outgoingApiType)} • ${log.isStreamed ? 'Streamed' : 'Non-streamed'} • ${log.outgoingApiType && PI_AI_OUTGOING_TYPES.has(log.outgoingApiType) ? 'pi-ai native' : log.isPassthrough ? 'Direct/Passthrough' : 'Translated'}`}
                        style={{ cursor: 'help' }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {/* API type icons */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <div
                              style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                            >
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
                              ) : log.incomingApiType &&
                                apiLogos[getApiBaseType(log.incomingApiType)] ? (
                                <img
                                  src={apiLogos[getApiBaseType(log.incomingApiType)]}
                                  alt={formatApiTypeLabel(log.incomingApiType)}
                                  title={formatApiTypeLabel(log.incomingApiType)}
                                  style={{ width: '16px', height: '16px' }}
                                />
                              ) : (
                                '?'
                              )}
                            </div>
                            <span style={{ width: '14px', textAlign: 'center' }}>→</span>
                            <div
                              style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                            >
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
                              ) : log.outgoingApiType &&
                                apiLogos[getApiBaseType(log.outgoingApiType)] ? (
                                <img
                                  src={apiLogos[getApiBaseType(log.outgoingApiType)]}
                                  alt={formatApiTypeLabel(log.outgoingApiType)}
                                  title={formatApiTypeLabel(log.outgoingApiType)}
                                  style={{ width: '16px', height: '16px' }}
                                />
                              ) : (
                                '?'
                              )}
                            </div>
                          </div>
                          <div
                            style={{
                              borderTop: '1px solid var(--color-border-glass)',
                              margin: '1px 4px',
                              width: '44px',
                            }}
                          ></div>
                          {/* Streaming/Passthrough icons */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <div
                              style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                            >
                              {log.isStreamed ? (
                                <Zap size={12} className="text-blue-400" />
                              ) : (
                                <ZapOff size={12} className="text-gray-400" />
                              )}
                            </div>
                            <span style={{ width: '14px' }}></span>
                            <div
                              style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                            >
                              {log.outgoingApiType &&
                              PI_AI_OUTGOING_TYPES.has(log.outgoingApiType) ? (
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
                              <div
                                style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                              >
                                {log.isVisionFallthrough && (
                                  <div
                                    title={`Vision Fallthrough${log.visionFallthroughModel ? ` via ${log.visionFallthroughModel}` : ''} (Images converted to text)`}
                                  >
                                    <ScanSearch size={12} className="text-amber-500" />
                                  </div>
                                )}
                              </div>
                              <span style={{ width: '14px' }}></span>
                              <div
                                style={{ width: '16px', display: 'flex', justifyContent: 'center' }}
                              >
                                {log.isDescriptorRequest && (
                                  <div title="Descriptor Request (Generated image description)">
                                    <Eye size={12} className="text-blue-500" />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div className="group/model flex items-center gap-1">
                            <span>{log.incomingModelAlias || '-'}</span>
                            {log.incomingModelAlias && log.incomingModelAlias !== '-' && (
                              <button
                                onClick={async () => {
                                  if (!isClipboardAvailable()) return;
                                  await copyToClipboard(log.incomingModelAlias || '');
                                }}
                                className="opacity-0 group-hover/model:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer p-0 flex items-center disabled:opacity-0"
                                title={
                                  isClipboardAvailable()
                                    ? 'Copy incoming model alias'
                                    : 'Copy requires HTTPS'
                                }
                                disabled={!isClipboardAvailable()}
                              >
                                <Copy size={12} className="text-text-secondary hover:text-text" />
                              </button>
                            )}
                          </div>
                          <div className="group/selected flex items-center gap-1">
                            <span
                              style={{ color: 'var(--color-text-secondary)', fontSize: '0.9em' }}
                            >
                              {log.provider || '-'}:{log.selectedModelName || '-'}
                            </span>
                            {log.selectedModelName && log.selectedModelName !== '-' && (
                              <button
                                onClick={async () => {
                                  if (!isClipboardAvailable()) return;
                                  await copyToClipboard(log.selectedModelName || '');
                                }}
                                className="opacity-0 group-hover/selected:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer p-0 flex items-center disabled:opacity-0"
                                title={
                                  isClipboardAvailable()
                                    ? 'Copy selected model name'
                                    : 'Copy requires HTTPS'
                                }
                                disabled={!isClipboardAvailable()}
                              >
                                <Copy size={10} className="text-text-secondary hover:text-text" />
                              </button>
                            )}
                          </div>
                          {log.isVisionFallthrough && log.visionFallthroughModel && (
                            <div
                              className="group/vft flex items-center gap-1"
                              title="Vision fallthrough descriptor model"
                            >
                              <ScanSearch size={10} className="text-amber-500 shrink-0" />
                              <span
                                style={{ color: 'var(--color-text-secondary)', fontSize: '0.8em' }}
                              >
                                {log.visionFallthroughModel}
                              </span>
                              <button
                                onClick={async () => {
                                  if (!isClipboardAvailable()) return;
                                  await copyToClipboard(log.visionFallthroughModel || '');
                                }}
                                className="opacity-0 group-hover/vft:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer p-0 flex items-center disabled:opacity-0"
                                title={
                                  isClipboardAvailable()
                                    ? 'Copy fallthrough model name'
                                    : 'Copy requires HTTPS'
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
                        className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle"
                        title={`Input: ${(log.tokensInput || 0) === 0 ? '-' : formatLargeNumber(log.tokensInput || 0)} • Output: ${(log.tokensOutput || 0) === 0 ? '-' : formatLargeNumber(log.tokensOutput || 0)} • Reasoning: ${(log.tokensReasoning || 0) === 0 ? '-' : formatLargeNumber(log.tokensReasoning || 0)} • Cached: ${(log.tokensCached || 0) === 0 ? '-' : formatLargeNumber(log.tokensCached || 0)} • Cache Write: ${(log.tokensCacheWrite || 0) === 0 ? '-' : formatLargeNumber(log.tokensCacheWrite || 0)}${log.tokensEstimated ? ' • * = Estimated' : ''}`}
                        style={{ cursor: 'help' }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {/* Row 1: Input and Reasoning */}
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CloudUpload size={12} className="text-blue-400" />
                              <span
                                style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '30px' }}
                              >
                                {(log.tokensInput || 0) === 0
                                  ? '-'
                                  : formatLargeNumber(log.tokensInput || 0)}
                                {log.tokensEstimated ? (
                                  <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                                ) : null}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <BrainCog size={12} className="text-purple-400" />
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  minWidth: '30px',
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
                          </div>
                          {/* Row 2: Output and Cache */}
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CloudDownload size={12} className="text-green-400" />
                              <span
                                style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '30px' }}
                              >
                                {(log.tokensOutput || 0) === 0
                                  ? '-'
                                  : formatLargeNumber(log.tokensOutput || 0)}
                                {log.tokensEstimated ? (
                                  <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                                ) : null}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <PackageOpen size={12} className="text-orange-400" />
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  minWidth: '30px',
                                }}
                              >
                                {(log.tokensCached || 0) === 0
                                  ? '-'
                                  : formatLargeNumber(log.tokensCached || 0)}
                                {log.tokensEstimated ? (
                                  <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup>
                                ) : null}
                              </span>
                            </div>
                          </div>
                          {/* Row 3: Cache Write */}
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <PencilLine size={12} className="text-fuchsia-400" />
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  minWidth: '30px',
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
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 border-b border-border-glass text-text align-middle">
                        {log.costTotal !== undefined && log.costTotal !== null ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {/* Row 1: Total cost */}
                            <div>
                              {log.costSource ? (
                                <CostToolTip
                                  source={log.costSource}
                                  costMetadata={log.costMetadata}
                                >
                                  <span style={{ fontWeight: '500', cursor: 'help' }}>
                                    {log.costTotal === 0 ? '-' : formatCost(log.costTotal, 6)}
                                  </span>
                                </CostToolTip>
                              ) : (
                                <span style={{ fontWeight: '500' }}>
                                  {log.costTotal === 0 ? '-' : formatCost(log.costTotal, 6)}
                                </span>
                              )}
                            </div>
                            {/* Separator */}
                            <div
                              style={{
                                borderTop: '1px solid var(--color-border-glass)',
                                margin: '1px 2px',
                              }}
                            />
                            {/* Breakdown grid: 2 rows x 4 columns (icon, value, icon, value) */}
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr auto 1fr',
                                gap: '2px 4px',
                                alignItems: 'center',
                              }}
                            >
                              <CloudUpload size={10} className="text-blue-400" />
                              <span
                                style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                              >
                                {log.costInput === 0 ? '$-.----' : formatCost(log.costInput || 0)}
                              </span>
                              <CloudDownload size={10} className="text-green-400" />
                              <span
                                style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                              >
                                {log.costOutput === 0 ? '$-.----' : formatCost(log.costOutput || 0)}
                              </span>
                              <PackageOpen size={10} className="text-orange-400" />
                              <span
                                style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                              >
                                {log.costCached === 0 ? '$-.----' : formatCost(log.costCached || 0)}
                              </span>
                              <PencilLine size={10} className="text-fuchsia-400" />
                              <span
                                style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}
                              >
                                {log.costCacheWrite === 0
                                  ? '$-.----'
                                  : formatCost(log.costCacheWrite || 0)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span
                            style={{
                              color: 'var(--color-text-secondary)',
                              fontSize: '1.2em',
                              display: 'block',
                              textAlign: 'center',
                            }}
                          >
                            -
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                        {(() => {
                          const progress =
                            log.responseStatus === 'pending'
                              ? progressMapRef.current.get(log.requestId)
                              : undefined;
                          const rawDurationMs =
                            log.durationMs != null && log.durationMs > 0
                              ? log.durationMs
                              : log.responseStatus === 'pending'
                                ? Date.now() - log.startTime
                                : null;
                          const liveDuration =
                            rawDurationMs != null ? formatMs(rawDurationMs) : '-';
                          const e2eOutputTokens =
                            Number(log.tokensOutput || 0) + Number(log.tokensReasoning || 0);
                          // End-to-end throughput: output plus reasoning tokens / full request duration.
                          // Unlike TPS (which excludes the TTFT delay), E2E includes it.
                          const e2e =
                            log.durationMs != null && log.durationMs > 0 && e2eOutputTokens > 0
                              ? e2eOutputTokens / (log.durationMs / 1000)
                              : null;
                          if (progress) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span>Duration: {liveDuration}</span>
                                <span
                                  style={{
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '0.85em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <CloudDownload size={12} className="text-yellow-400" />
                                  <span>{formatBytes(progress.bytesReceived)}</span>
                                </span>
                                {progress.bytesPerSec != null && (
                                  <span
                                    style={{
                                      color: 'var(--color-text-secondary)',
                                      fontSize: '0.85em',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <Gauge size={12} className="text-text-secondary" />
                                    {formatBytes(progress.bytesPerSec)}/s
                                  </span>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>Duration: {liveDuration}</span>
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {log.ttftMs && log.ttftMs > 0
                                  ? `TTFT: ${formatMs(log.ttftMs)}`
                                  : ''}
                              </span>
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {log.tokensPerSec && log.tokensPerSec > 0
                                  ? `TPS: ${formatTPS(log.tokensPerSec)}`
                                  : ''}
                              </span>
                              <span
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontSize: '0.85em',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {e2e != null ? `E2E: ${formatTPS(e2e)}` : ''}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td
                        className="px-2 py-1.5 text-center border-b border-border-glass text-text align-middle"
                        title={
                          log.kwhUsed != null && log.kwhUsed > 0
                            ? `Energy: ${formatEnergy(log.kwhUsed)} ≈ ${formatSlices(log.kwhUsed / KWH_PER_SLICE)} toast slices`
                            : undefined
                        }
                        style={
                          log.kwhUsed != null && log.kwhUsed > 0 ? { cursor: 'help' } : undefined
                        }
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {/* Row 1: Messages and Tool calls */}
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                              className="text-blue-400"
                            >
                              <MessagesSquare size={12} />
                              <span
                                style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}
                              >
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
                          <div style={{ display: 'flex', gap: '16px' }}>
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                              className="text-orange-400"
                            >
                              <Wrench size={12} />
                              <span
                                style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}
                              >
                                {(log.toolsDefined || 0) === 0 ? '-' : log.toolsDefined}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {log.finishReason === 'end_turn' ? (
                                <CirclePause size={12} className="text-yellow-500" />
                              ) : log.finishReason === 'stop' ? (
                                <Octagon size={12} className="text-red-500" />
                              ) : log.finishReason === 'tool_calls' ? (
                                <Hammer size={12} className="text-purple-500" />
                              ) : log.finishReason === 'length' ||
                                log.finishReason === 'max_tokens' ? (
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
                          {/* Row 3: Retry indicator */}
                          {log.attemptCount && log.attemptCount > 1 && (
                            <div style={{ display: 'flex', gap: '16px' }}>
                              <button
                                type="button"
                                onClick={() => handleRetryDetails(log)}
                                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                className="text-orange-500 bg-transparent border-0 p-0 cursor-pointer hover:text-orange-400 transition-colors"
                                title="View retry history"
                              >
                                <RotateCcw size={12} />
                                <span
                                  style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}
                                >
                                  {log.attemptCount}x
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                        <div className="flex gap-2 items-center">
                          {log.hasError && (
                            <button
                              onClick={() =>
                                navigate('/errors', { state: { requestId: log.requestId } })
                              }
                              className={clsx(
                                'inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 border',
                                'text-danger border-danger/30 bg-red-500/15 hover:bg-red-500/25'
                              )}
                              style={{ width: '52px' }}
                              title="View Error Details"
                            >
                              <AlertTriangle size={12} />
                              <span style={{ fontWeight: 600 }}>✗</span>
                            </button>
                          )}
                          {log.hasDebug && (
                            <button
                              onClick={() =>
                                navigate('/debug', { state: { requestId: log.requestId } })
                              }
                              className={clsx(
                                'inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 border',
                                'text-blue-400 border-blue-400/30 bg-blue-500/15 hover:bg-blue-500/25'
                              )}
                              style={{ width: '52px' }}
                              title="View Debug Trace"
                            >
                              <Bug size={12} />
                              <span style={{ fontWeight: 600 }}>✓</span>
                            </button>
                          )}
                          {!log.hasError && !log.hasDebug && (
                            <div
                              className={clsx(
                                'inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium border',
                                log.responseStatus === 'success'
                                  ? 'text-success border-success/30 bg-emerald-500/15'
                                  : log.responseStatus === 'pending'
                                    ? 'text-warning border-warning/30 bg-yellow-500/15'
                                    : log.responseStatus === 'cancelled'
                                      ? 'text-blue-400 border-blue-400/30 bg-blue-500/15'
                                      : log.responseStatus === 'timeout'
                                        ? 'text-orange-400 border-orange-400/30 bg-orange-500/15'
                                        : 'text-danger border-danger/30 bg-red-500/15'
                              )}
                              style={{ width: '52px' }}
                            >
                              {log.responseStatus === 'success' ? (
                                <CheckCircle size={12} />
                              ) : log.responseStatus === 'pending' ? (
                                <Plane size={12} className="animate-pulse" />
                              ) : log.responseStatus === 'cancelled' ? (
                                <Ban size={12} />
                              ) : log.responseStatus === 'timeout' ? (
                                <Timer size={12} />
                              ) : (
                                <XCircle size={12} />
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                        <button
                          onClick={() => handleDelete(log.requestId)}
                          className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 opacity-0"
                          title="Delete log"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
