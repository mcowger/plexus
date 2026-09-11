import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { api, UsageRecord, type UsageSortDirection, type UsageSortField } from '../lib/api';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import { Drawer } from '../components/ui/Drawer';
import {
  ChevronRight,
  Trash2,
  ChevronDown,
  PlayCircle,
  Circle,
  X,
  Wifi,
  WifiOff,
  Loader,
  ListFilter,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  DesktopLogRow,
  MobileLogRow,
  PaginationControls,
  type ProgressUpdate,
  DESKTOP_STATUS_COLUMN_WIDTH,
  DESKTOP_DATE_COLUMN_WIDTH,
  DESKTOP_API_COLUMN_WIDTH,
  DESKTOP_TOKENS_COLUMN_WIDTH,
  DESKTOP_COST_COLUMN_WIDTH,
  DESKTOP_PERF_COLUMN_WIDTH,
  DESKTOP_DELETE_COLUMN_WIDTH,
  DESKTOP_TABLE_MIN_WIDTH,
} from '../components/logs';

const SSE_HEARTBEAT_TIMEOUT_MS = 30_000;
const LIVE_DURATION_UPDATE_INTERVAL_MS = 500;
const DESKTOP_LOGS_MEDIA_QUERY = '(min-width: 1024px)';

const EMPTY_LOG_FILTERS = {
  apiKey: '',
  incomingModelAlias: '',
  provider: '',
  startDate: '',
  endDate: '',
};

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
                  <col />
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
                    <th className="px-1 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
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
