/**
 * @file LiveTab.tsx
 *
 * Core component for the Live Metrics dashboard tab. Renders a real-time view
 * of LLM proxy traffic over a rolling 5-minute window. The dashboard is built
 * around a drag-and-drop card grid (powered by @dnd-kit) where each card
 * visualises a different facet of live traffic: request velocity, provider
 * and model distributions, timelines, concurrency gauges, and a scrollable
 * request stream.
 *
 * Cards can be reordered via drag-and-drop, and positions are persisted across
 * sessions through the useCardPositions hook. Clicking a card opens an expanded
 * modal view. Each card also exposes an "Analyze" button that opens a
 * DetailedUsage page (embedded inside the same modal) pre-seeded with a query
 * string relevant to that card's data slice.
 *
 * Data is fetched via polling (configurable interval: 5s / 10s / 30s) and
 * automatically pauses when the browser tab is hidden to conserve resources.
 *
 * Key design decisions:
 * - All chart data is derived from the `liveRequests` array via useMemo hooks,
 *   ensuring consistent snapshots across cards within a single render cycle.
 * - Concurrency data is fetched on a separate 10-second interval because the
 *   backend endpoint for in-flight request counts is independent from the
 *   main dashboard/logs endpoints.
 * - The modal system is dual-purpose: it can show either an expanded card view
 *   (via `modalCard` state) or an embedded DetailedUsage page (via
 *   `detailedUsageQuery` state). Both share the same Modal shell.
 */

//
// IMPORTS -- React core
//
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

//
// IMPORTS -- Drag-and-Drop (@dnd-kit)
//
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';

//
// IMPORTS -- Icons (lucide-react)
//
import { AlertTriangle, Clock, Cpu, Info, RefreshCw, Server, Signal, X } from 'lucide-react';

//
// IMPORTS -- UI components (internal)
//
import { SortableCard } from '../../ui/SortableCard';
import { useCardPositions } from '../../../hooks/useCardPositions';
import type { CardId } from '../../../types/card';
import { AnalyzeButton, buildQueryString, type CardType } from '../../analytics/AnalyzeButton';
import { DetailedUsage } from '../../../pages/DetailedUsage';

//
// IMPORTS -- Charts (recharts)
//

import {
  AreaChart,
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

//
// IMPORTS -- Shared UI primitives
//
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

//
// IMPORTS -- API layer and types
//
import {
  api,
  STAT_LABELS,
  type Cooldown,
  type Stat,
  type TodayMetrics,
  type UsageRecord,
  type ConcurrencyData,
} from '../../../lib/api';

//
// IMPORTS -- Formatting utilities
//
import {
  formatCost,
  formatMs,
  formatNumber,
  formatTimeAgo,
  formatTokens,
  formatTPS,
} from '../../../lib/format';
import { useAuth } from '../../../contexts/AuthContext';

//
// LOCAL TYPES
//

/**
 * A single minute-resolution bucket for the timeline area chart.
 * Each bucket aggregates all requests that fall within that calendar minute.
 */
type MinuteBucket = {
  /** Locale-formatted time label, e.g. "14:32" */
  time: string;
  /** Total request count in this minute */
  requests: number;
  /** Count of non-success (errored) requests in this minute */
  errors: number;
  /** Sum of all token types (input + output + cached + cache-write) */
  tokens: number;
};

/**
 * Metadata for one series line in the model-stack composed chart.
 * Each series corresponds to one of the top N models by request volume.
 */

type ModelTimelineSeries = {
  /** Synthetic key like "model_0", used as the recharts dataKey */
  key: string;
  /** Human-readable model name for legend/tooltip display */
  label: string;
  /** Hex colour assigned from MODEL_TIMELINE_COLORS palette */
  color: string;
};

/**
 * A single minute bucket for the model-stack chart. Extends Record<string, ...>
 * because dynamic model keys (e.g. "model_0", "model_1") are added at runtime
 * as stacked bar segments. The fixed fields track aggregate stats and running
 * totals for computing averages (TTFT and TPS) after the accumulation pass.
 */
type ModelTimelineBucket = Record<string, string | number> & {
  time: string;
  requests: number;
  errors: number;
  tokens: number;
  /** Final computed average Time To First Token (ms) for this bucket */
  avgTtftMs: number;
  /** Final computed average Tokens Per Second for this bucket */
  avgTps: number;
  /** Running sum of TTFT values -- used to compute avgTtftMs after iteration */
  ttftTotal: number;
  /** Count of requests with valid TTFT -- divisor for avgTtftMs */
  ttftCount: number;
  /** Running sum of TPS values -- used to compute avgTps after iteration */
  tpsTotal: number;
  /** Count of requests with valid TPS -- divisor for avgTps */
  tpsCount: number;
};

/** Filter for the request stream card: show all, only successes, or only errors */
type StreamFilter = 'all' | 'success' | 'error';

/** Available live window periods in minutes */
const LIVE_WINDOW_OPTIONS = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 1440, label: '1d' },
  { value: 10080, label: '7d' },
  { value: 43200, label: '30d' },
] as const;

/** Props passed to LiveTab from the parent dashboard layout */
interface LiveTabProps {
  /** Current polling interval in milliseconds (5000 / 10000 / 30000) */
  pollInterval: number;
  /** Callback to propagate poll interval changes to the parent (for persistence) */
  onPollIntervalChange: (interval: number) => void;
  /** Current live window period in minutes (5 / 15 / 30 / 1440 / 10080 / 43200) */
  liveWindowPeriod?: number;
  /** Callback to propagate live window period changes to the parent */
  onLiveWindowPeriodChange?: (period: number) => void;
}

//
// CONSTANTS
//

/** Available polling intervals shown as toggle buttons in the toolbar */
const POLL_INTERVAL_OPTIONS = [5000, 10000, 30000] as const;
/** Maximum number of distinct models shown in the model-stack chart */
const MODEL_TIMELINE_MAX_SERIES = 5;
/** Colour palette for the stacked model bars (cycles if more than 5 models) */
const MODEL_TIMELINE_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444'] as const;

/**
 * Telemetry labels that are treated as "unset". Providers and models sometimes
 * report placeholder strings instead of null, so we normalise these away.
 */
const PLACEHOLDER_LABELS = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'undefined']);

//
// LABEL NORMALISATION HELPERS
//

/**
 * Strips whitespace and filters out placeholder telemetry labels.
 * Returns an empty string for any value that is null, undefined, blank,
 * or matches a known placeholder (e.g. "unknown", "n/a", "null").
 */
const normalizeTelemetryLabel = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }

  if (PLACEHOLDER_LABELS.has(normalized.toLowerCase())) {
    return '';
  }

  return normalized;
};

/**
 * Derives a display label for the provider of a request.
 * Falls back to "Failed Request" if the request errored before a provider was
 * resolved, or "Unresolved Provider" if the provider field is simply absent.
 */
const getProviderLabel = (request: UsageRecord): string => {
  const provider = normalizeTelemetryLabel(request.provider);
  if (provider) {
    return provider;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Request';
  }

  return 'Unresolved Provider';
};

/**
 * Derives a display label for the model used in a request.
 * Prefers `selectedModelName` (the actual model dispatched to) over
 * `incomingModelAlias` (the alias the client requested). Falls back to
 * "Failed Before Model Selection" for errors, or "Unresolved Model" otherwise.
 */
const getModelLabel = (request: UsageRecord): string => {
  const model =
    normalizeTelemetryLabel(request.selectedModelName) ||
    normalizeTelemetryLabel(request.incomingModelAlias);
  if (model) {
    return model;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Before Model Selection';
  }

  return 'Unresolved Model';
};

//
// MODULE-LEVEL COMPONENTS AND HELPERS
//

/**
 * Aggregated statistics for a single entity (provider or model).
 * Used by the "stats" card and its expanded modal view.
 *
 * All averages (latency, TTFT, TPS) are arithmetic means computed from the
 * total running sum divided by the request count for that entity.
 */
interface EntityStats {
  /** Display name of the provider or model */
  name: string;
  /** Total number of requests routed to this entity in the live window */
  requests: number;
  /** Number of requests that did NOT have responseStatus === 'success' */
  errors: number;
  /** Percentage of successful requests: ((requests - errors) / requests) * 100 */
  successRate: number;
  /** Sum of all token types (input + output + cached + cache-write) */
  tokens: number;
  /** Cumulative cost in USD for all requests to this entity */
  cost: number;
  /** Mean end-to-end latency (ms) across all requests */
  avgLatency: number;
  /** Mean Time To First Token (ms) across all requests */
  avgTtft: number;
  /** Mean tokens-per-second throughput across all requests */
  avgTps: number;
}

/**
 * Groups an array of usage records by a specified entity dimension (provider
 * or model), then computes aggregate statistics for each group.
 *
 * Algorithm:
 * 1. Iterate over all requests, resolving each to a string key via
 *    getProviderLabel or getModelLabel.
 * 2. Accumulate running totals in a Map<string, accumulators> -- using a Map
 *    rather than a plain object for O(1) key lookup and to avoid prototype
 *    pollution with arbitrary provider/model name strings.
 * 3. Convert the Map entries into EntityStats objects, computing averages by
 *    dividing cumulative sums by the request count.
 * 4. Sort descending by request count and return only the top 5.
 *
 * @param requests - The filtered array of live UsageRecords
 * @param entityType - Whether to group by 'provider' or 'model'
 * @returns Top 5 entities sorted by descending request count
 */
const aggregateByEntity = (
  requests: UsageRecord[],
  entityType: 'provider' | 'model'
): EntityStats[] => {
  const grouped = new Map<
    string,
    {
      requests: number;
      errors: number;
      tokens: number;
      cost: number;
      latency: number;
      ttft: number;
      tps: number;
    }
  >();

  requests.forEach((request) => {
    const key = entityType === 'provider' ? getProviderLabel(request) : getModelLabel(request);

    const existing = grouped.get(key) || {
      requests: 0,
      errors: 0,
      tokens: 0,
      cost: 0,
      latency: 0,
      ttft: 0,
      tps: 0,
    };

    existing.requests++;
    if (request.responseStatus !== 'success') existing.errors++;
    existing.tokens +=
      (request.tokensInput || 0) +
      (request.tokensOutput || 0) +
      (request.tokensCached || 0) +
      (request.tokensCacheWrite || 0);
    existing.cost += request.costTotal || 0;
    existing.latency += request.durationMs || 0;
    existing.ttft += request.ttftMs || 0;
    existing.tps += request.tokensPerSec || 0;
    grouped.set(key, existing);
  });

  return Array.from(grouped.entries())
    .map(([name, data]) => ({
      name,
      requests: data.requests,
      errors: data.errors,
      successRate: data.requests > 0 ? ((data.requests - data.errors) / data.requests) * 100 : 0,
      tokens: data.tokens,
      cost: data.cost,
      avgLatency: data.requests > 0 ? data.latency / data.requests : 0,
      avgTtft: data.requests > 0 ? data.ttft / data.requests : 0,
      avgTps: data.requests > 0 ? data.tps / data.requests : 0,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 5);
};

/**
 * Compact stat row for a single provider or model entity.
 *
 * Renders a small card with:
 * - An icon (Server for providers, Cpu for models) and the entity name
 * - Request count on the right
 * - A secondary row of stats: success rate (colour-coded by threshold),
 *   average latency, cumulative cost, and average TPS
 *
 * Used in both the inline "stats" card and its expanded modal view.
 * The name is truncated to 25 characters with an ellipsis and a title
 * attribute for the full string on hover.
 */
const EntityRow: React.FC<{ entity: EntityStats; isModel?: boolean }> = ({ entity, isModel }) => (
  <div className="rounded-md border border-border-glass bg-bg-glass/50 px-3 py-2 hover:bg-bg-glass transition-colors">
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-2 min-w-0">
        {isModel ? (
          <Cpu size={14} className="text-text-muted shrink-0" />
        ) : (
          <Server size={14} className="text-text-muted shrink-0" />
        )}
        <span className="text-sm text-text font-medium truncate" title={entity.name}>
          {entity.name.length > 25 ? entity.name.slice(0, 22) + '...' : entity.name}
        </span>
      </div>
      <span className="text-xs text-text-secondary">{formatNumber(entity.requests, 0)} req</span>
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
      <span>
        Success:{' '}
        {entity.successRate >= 95 ? (
          <span className="text-emerald-500 font-medium">{entity.successRate.toFixed(1)}%</span>
        ) : entity.successRate >= 80 ? (
          <span className="text-amber-500 font-medium">{entity.successRate.toFixed(1)}%</span>
        ) : (
          <span className="text-red-500 font-medium">{entity.successRate.toFixed(1)}%</span>
        )}
      </span>
      <span>Latency: {formatMs(entity.avgLatency)}</span>
      <span>Cost: {formatCost(entity.cost, 4)}</span>
      <span>TPS: {formatNumber(entity.avgTps, 1)}</span>
    </div>
  </div>
);

/**
 * CooldownRow renders a single provider/model cooldown alert row.
 * Clicking the info icon opens a popover with error details, failure count,
 * and expiry timestamp. Uses a click-outside listener to auto-dismiss.
 */
interface CooldownRowProps {
  provider: string;
  modelDisplay: string;
  minutes: number;
  consecutiveFailures?: number;
  lastError?: string;
  expiryStr: string;
  onClear: () => void;
}

const CooldownRow: React.FC<CooldownRowProps> = ({
  provider,
  modelDisplay,
  minutes,
  consecutiveFailures,
  lastError,
  expiryStr,
  onClear,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; right: number } | null>(null);

  const updatePopoverPosition = useCallback(() => {
    const button = infoButtonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const popoverWidth = 288;
    const gutter = 12;
    const right = Math.max(gutter, viewportWidth - rect.right);
    const clampedRight = Math.min(right, Math.max(gutter, viewportWidth - popoverWidth - gutter));

    setPopoverStyle({
      top: rect.bottom + 8,
      right: clampedRight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !(popoverRef.current && popoverRef.current.contains(target))
      ) {
        setOpen(false);
      }
    };
    updatePopoverPosition();
    document.addEventListener('mousedown', handler);
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  return (
    <div
      className="px-3 py-2 flex items-center gap-2 bg-warning/5"
      onClick={(e) => e.stopPropagation()}
    >
      <AlertTriangle size={12} className="text-warning shrink-0" />
      <span className="text-xs font-medium text-text">{provider}</span>
      <span className="text-xs text-text-muted truncate">
        {modelDisplay} — {minutes}m
      </span>
      <div className="relative ml-auto shrink-0 flex items-center gap-2" ref={ref}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="text-text-muted hover:text-danger transition-colors"
          title="Clear this cooldown"
        >
          <X size={13} />
        </button>
        <button
          ref={infoButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="text-text-muted hover:text-text transition-colors"
          aria-label="Show cooldown details"
        >
          <Info size={13} />
        </button>
        {open && popoverStyle && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={popoverRef}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-100 w-72 rounded-md border border-border shadow-lg p-3 text-xs space-y-2"
                style={{
                  backgroundColor: 'rgb(15, 23, 42)',
                  top: popoverStyle.top,
                  right: popoverStyle.right,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold text-warning">
                  <AlertTriangle size={12} />
                  Cooldown Details
                </div>
                {lastError && (
                  <div>
                    <span className="text-text-muted font-medium">Error:</span>
                    <p className="mt-0.5 text-text wrap-break-word whitespace-pre-wrap font-mono text-[11px] bg-bg-hover rounded p-1.5 max-h-32 overflow-y-auto">
                      {lastError}
                    </p>
                  </div>
                )}
                {consecutiveFailures !== undefined && (
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Consecutive failures</span>
                    <span className="font-semibold text-danger">{consecutiveFailures}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-text-muted">Expires at</span>
                  <span className="font-semibold text-text text-right">{expiryStr}</span>
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
};

//
// MAIN COMPONENT
//

/**
 * LiveTab -- the primary component for the "Live Metrics" dashboard tab.
 *
 * Renders a two-column responsive grid of draggable metric cards, a toolbar
 * with polling controls, a summary metrics panel, and a cooldown/alerts panel.
 * All visualised data is derived from a rolling 5-minute window of the most
 * recent 200 usage records, refreshed at a configurable polling interval.
 */
export const LiveTab: React.FC<LiveTabProps> = ({
  pollInterval,
  onPollIntervalChange,
  liveWindowPeriod = 5,
  onLiveWindowPeriodChange,
}) => {
  const { isAdmin, principal } = useAuth();
  const limitedAllowedProviders =
    principal?.role === 'limited' ? (principal.allowedProviders ?? []) : null;
  // ---------------------------------------------------------------------------
  // STATE -- API data from polling
  // ---------------------------------------------------------------------------
  /** Aggregate stat values (total requests, total tokens, etc.) from the dashboard endpoint */
  const [stats, setStats] = useState<Stat[]>([]);
  /** Active provider cooldowns -- models temporarily disabled due to consecutive failures */
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  /** Cumulative metrics for the current calendar day */
  const [todayMetrics, setTodayMetrics] = useState<TodayMetrics>({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    kwhUsed: 0,
    totalCost: 0,
  });
  /** Raw usage records from the latest poll -- the source of truth for all derived data */
  const [logs, setLogs] = useState<UsageRecord[]>([]);

  // ---------------------------------------------------------------------------
  // STATE -- UI / polling bookkeeping
  // ---------------------------------------------------------------------------
  /** Timestamp of the last successful data fetch -- used for the "stale" indicator */
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  /** Elapsed seconds since lastUpdated -- updated every 10s for the staleness badge */

  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  /** Whether the most recent fetch succeeded (controls connected/warning badge) */
  const [isConnected, setIsConnected] = useState(false);
  /** True while a manual "Refresh Now" fetch is in-flight (shows spinner) */
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Active filter for the request stream card: 'all' | 'success' | 'error' */
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all');
  /** Local copy of the polling interval -- synced from props via useEffect below */
  const [pollIntervalMs, setPollIntervalMs] = useState(pollInterval);

  /** Keep local polling interval in sync when the parent changes the prop */
  useEffect(() => {
    setPollIntervalMs(pollInterval);
  }, [pollInterval]);

  /** Local copy of the live window period -- synced from props via useEffect below */
  const [liveWindowMinutes, setLiveWindowMinutes] = useState(liveWindowPeriod);

  /** Keep local live window period in sync when the parent changes the prop */
  useEffect(() => {
    setLiveWindowMinutes(liveWindowPeriod);
  }, [liveWindowPeriod]);

  /** Computed: window size in milliseconds for filtering */
  const liveWindowMs = useMemo(() => liveWindowMinutes * 60 * 1000, [liveWindowMinutes]);

  /**
   * Whether the browser tab is currently visible. Polling is paused when the
   * tab is hidden to avoid wasting bandwidth and CPU on invisible updates.
   * Initialised from document.visibilityState (SSR-safe: defaults to true).
   */
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  /** True until the first successful data fetch completes */
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // STATE -- Config migration warning
  // ---------------------------------------------------------------------------
  /** Whether adminKey was read from YAML (shows deprecation warning if true) */
  const [showConfigWarning, setShowConfigWarning] = useState(false);

  // ---------------------------------------------------------------------------
  // STATE -- Modal system
  // ---------------------------------------------------------------------------
  /** Whether the full-screen modal overlay is currently visible */
  const [modalOpen, setModalOpen] = useState(false);

  /**
   * Which card's expanded view to render inside the modal. This is a
   * discriminated union of all card IDs plus null (no card selected).
   * When modalCard is set, renderModalContent() switches on this value
   * to render the appropriate expanded chart/list.
   */
  const [modalCard, setModalCard] = useState<
    | 'velocity'
    | 'provider'
    | 'model'
    | 'timeline'
    | 'modelstack'
    | 'requests'
    | 'concurrency'
    | 'stats'
    | null
  >(null);

  /**
   * When non-null, the modal renders a DetailedUsage page instead of an
   * expanded card view. The string is a URL query string (e.g.
   * "?cardType=provider") that pre-seeds the DetailedUsage filters.
   * Set by openDetailedUsageInModal() when the user clicks an AnalyzeButton.
   */
  const [detailedUsageQuery, setDetailedUsageQuery] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // STATE -- Concurrency data (separate from main poll)
  // ---------------------------------------------------------------------------
  /** Array of in-flight request counts per provider, fetched every 10 seconds */
  const [concurrencyData, setConcurrencyData] = useState<ConcurrencyData[]>([]);
  /** Rolling history of concurrency snapshots for the stacked area chart (max 30 points = 5 min at 10s interval) */
  const [concurrencyHistory, setConcurrencyHistory] = useState<Record<string, unknown>[]>([]);
  /** Loading flag for the concurrency endpoint */
  const [concurrencyLoading, setConcurrencyLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // STATE -- Drag-and-drop
  // ---------------------------------------------------------------------------
  /**
   * The CardId currently being dragged, or null if no drag is in progress.
   * Used by DragOverlay to render the floating card preview during a drag.
   */
  const [activeCardId, setActiveCardId] = useState<CardId | null>(null);

  // ---------------------------------------------------------------------------
  // DRAG-AND-DROP SETUP
  // ---------------------------------------------------------------------------

  /**
   * The canonical list of card IDs in their DEFAULT display order.
   * This array defines which cards exist and their initial arrangement.
   *
   * IMPORTANT: This list must match the cases handled by renderDraggableCard()
   * and renderModalContent(). Adding a new card here requires adding a
   * corresponding render case in both functions plus the modalCard type union.
   *
   * Memoised with an empty dependency array because the card roster is static.
   */
  const cardIds = useMemo<CardId[]>(
    () => [
      'metrics',
      'alerts',
      'concurrency',
      'velocity',
      'provider',
      'model',
      'stats',
      'timeline',
      'modelstack',
      'requests',
    ],
    []
  );

  /**
   * useCardPositions persists the user's card arrangement to localStorage.
   * `positions` is an array of { id, order } objects reflecting the current
   * arrangement. `reorderCards(oldIndex, newIndex)` performs an array-move
   * and writes the new order to storage.
   */
  const { positions, reorderCards } = useCardPositions(cardIds);

  /**
   * Called when a drag gesture begins. Records which card is being dragged
   * so that DragOverlay can render a floating preview of that card.
   */
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveCardId(event.active.id as CardId);
  }, []);

  /**
   * Called when a drag gesture ends (card is dropped).
   *
   * Reordering logic:
   * 1. Clear the activeCardId (removes the drag overlay).
   * 2. If the card was dropped onto a different card (`over.id !== active.id`),
   *    find both indices in the current positions array.
   * 3. Call reorderCards(oldIndex, newIndex) which internally uses arrayMove
   *    to splice the dragged card into its new position and persists the
   *    updated order to localStorage.
   * 4. If the card was dropped back onto itself or into empty space, no
   *    reorder occurs -- the layout stays unchanged.
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveCardId(null);

      if (over && active.id !== over.id) {
        const oldIndex = positions.findIndex((p) => p.id === active.id);
        const newIndex = positions.findIndex((p) => p.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderCards(oldIndex, newIndex);
        }
      }
    },
    [positions, reorderCards]
  );

  /**
   * Called when a drag is cancelled (e.g. user presses Escape during drag).
   * Simply clears the active card to remove the drag overlay without
   * performing any reorder.
   */
  const handleDragCancel = useCallback(() => {
    setActiveCardId(null);
  }, []);

  /**
   * Derives the final ordered list of card IDs to render in the grid.
   *
   * If positions are available from localStorage (user has previously
   * reordered), sort by the persisted order. Any cards in `cardIds` that are
   * missing from `positions` (e.g. newly added cards) are appended at the end,
   * ensuring forward compatibility when new cards are introduced.
   *
   * Falls back to the default `cardIds` order if no positions are stored.
   */
  const orderedCardIds = useMemo<CardId[]>(() => {
    if (positions.length === 0) {
      return cardIds;
    }

    const next = [...positions]
      .sort((a, b) => a.order - b.order)
      .map((position) => position.id)
      .filter((id): id is CardId => cardIds.includes(id as CardId));

    const missing = cardIds.filter((id) => !next.includes(id));
    return [...next, ...missing];
  }, [positions, cardIds]);

  // ---------------------------------------------------------------------------
  // MODAL HELPERS
  // ---------------------------------------------------------------------------

  /** Opens the modal with a specific card's expanded view */
  const openModal = (card: typeof modalCard) => {
    setModalCard(card);
    setModalOpen(true);
  };

  /**
   * Opens the modal with an embedded DetailedUsage page instead of a card view.
   *
   * This is the bridge between the AnalyzeButton on each card and the full
   * DetailedUsage analytics page. The flow is:
   * 1. User clicks AnalyzeButton on a card (e.g. the "provider" card).
   * 2. buildQueryString('provider') generates a query string like
   *    "?cardType=provider&timeRange=5m" that pre-configures DetailedUsage
   *    filters to match the card's data context.
   * 3. detailedUsageQuery is set to that string, which causes
   *    renderModalContent() to render <DetailedUsage embedded ... /> instead
   *    of the normal card expansion.
   * 4. The DetailedUsage component renders in "embedded" mode (no page chrome)
   *    with a "Back" button that clears detailedUsageQuery to return to the
   *    card's normal expanded view.
   */
  const openDetailedUsageInModal = (cardType: CardType) => {
    setDetailedUsageQuery(buildQueryString(cardType));
    setModalOpen(true);
  };

  /** Closes the modal and resets both modal-state variables */
  const closeModal = () => {
    setModalOpen(false);
    setModalCard(null);
    setDetailedUsageQuery(null);
  };

  /** Keyboard shortcut: Escape closes the modal */
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    if (modalOpen) {
      window.addEventListener('keydown', handleEscape);
    }
    return () => window.removeEventListener('keydown', handleEscape);
  }, [modalOpen]);

  // ---------------------------------------------------------------------------
  // DATA FETCHING
  // ---------------------------------------------------------------------------

  /**
   * Fetches dashboard stats and recent logs from the API.
   * @param silent - When true (used by auto-poll), suppresses the refreshing
   *                 spinner so the UI does not flash on every poll cycle.
   */
  const loadData = async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
    }

    try {
      const [dashboardData, logData] = await Promise.all([
        api.getDashboardData('day', false),
        api.getLogs(fetchLimit, 0),
      ]);
      setStats(dashboardData.stats);
      setCooldowns(dashboardData.cooldowns);
      setTodayMetrics(dashboardData.todayMetrics);
      setLogs(logData.data || []);
      setLastUpdated(new Date());
      setIsConnected(true);
    } catch (e) {
      setIsConnected(false);
      console.error('Failed to load live metrics data', e);
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
      setLoading(false);
    }
  };

  /**
   * Fetches in-flight concurrency counts from a separate endpoint.
   * This runs on its own 10-second interval because the concurrency endpoint
   * is independent from the main dashboard data fetch.
   */
  const fetchConcurrencyData = async (silent = false) => {
    if (!silent) {
      setConcurrencyLoading(true);
    }
    try {
      const data = await api.getConcurrencyData('hour', 'live');
      setConcurrencyData(data);
      // Build history point for stacked area chart
      const point: Record<string, unknown> = { time: new Date().toLocaleTimeString() };
      for (const item of data) {
        const label = item.provider || 'unknown';
        point[label] = Number(item.count || 0);
      }
      setConcurrencyHistory((prev) => {
        const next = [...prev, point];
        // Keep last 30 data points (5 minutes at 10s intervals)
        return next.length > 30 ? next.slice(-30) : next;
      });
    } catch (e) {
      console.error('Failed to fetch concurrency data', e);
    } finally {
      if (!silent) {
        setConcurrencyLoading(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // POLLING EFFECTS
  // ---------------------------------------------------------------------------

  /**
   * Main data polling loop. Fetches immediately on mount, then sets up an
   * interval at `pollIntervalMs`. Polling stops when the tab is hidden
   * (isVisible === false) to save bandwidth. Re-triggers whenever the
   * visibility or interval changes.
   */
  useEffect(() => {
    void loadData();
    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      void loadData(true);
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [isVisible, pollIntervalMs]);

  /**
   * Calculate optimal fetch limit based on window size to prevent performance issues.
   * For short windows, fetch more detailed data. For long windows, limit the data.
   */
  const fetchLimit = useMemo(() => {
    if (liveWindowMinutes <= 30) {
      return 500; // 30 minutes or less: fetch up to 500 records
    } else if (liveWindowMinutes <= 24 * 60) {
      return 200; // Up to 24 hours: fetch 200 records
    } else if (liveWindowMinutes <= 7 * 24 * 60) {
      return 100; // Up to 7 days: fetch 100 records
    } else {
      return 50; // More than 7 days: fetch only 50 records
    }
  }, [liveWindowMinutes]);

  /**
   * Concurrency data polling loop. Runs independently from the main data
   * fetch because the backend concurrency endpoint is separate. Fixed at
   * a 10-second interval. Also pauses when the tab is hidden.
   */
  useEffect(() => {
    void fetchConcurrencyData();

    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      void fetchConcurrencyData(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [isVisible]);

  /**
   * Page visibility listener. When the user returns to this browser tab,
   * immediately triggers a silent data refresh so charts are up-to-date.
   * SSR-safe: skips registration if `document` is not available.
   */
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      if (visible) {
        void loadData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  /** Fetch config status to check if adminKey was read from YAML */
  useEffect(() => {
    const fetchConfigStatus = async () => {
      try {
        const response = await fetch('/v0/management/config/status');
        if (response.ok) {
          const data = await response.json();
          setShowConfigWarning(data.adminKeyFromYaml === true);
        }
      } catch (e) {
        // Silently ignore errors fetching config status
      }
    };
    void fetchConfigStatus();
  }, []);

  /** Ticks every 10 seconds to update the "seconds since last update" counter for the stale indicator */
  useEffect(() => {
    const updateTime = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
      setSecondsSinceUpdate(seconds);
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // ---------------------------------------------------------------------------
  // DERIVED DATA (useMemo) -- all chart/card data flows from liveRequests
  // ---------------------------------------------------------------------------

  /**
   * Filters `logs` to only those within the rolling live window and sorts
   * them newest-first. This is the foundational dataset that all other memos
   * derive from, ensuring a single consistent snapshot per render.
   */
  const liveRequests = useMemo(() => {
    const cutoff = Date.now() - liveWindowMs;
    return logs
      .filter((request) => {
        const requestTime = new Date(request.date).getTime();
        return Number.isFinite(requestTime) && requestTime >= cutoff;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [logs, liveWindowMs]);

  /** Applies the stream filter (all/success/error) on top of liveRequests */
  const filteredLiveRequests = useMemo(() => {
    if (streamFilter === 'all') {
      return liveRequests;
    }

    if (streamFilter === 'success') {
      return liveRequests.filter(
        (request) => (request.responseStatus || '').toLowerCase() === 'success'
      );
    }

    return liveRequests.filter(
      (request) => (request.responseStatus || '').toLowerCase() !== 'success'
    );
  }, [liveRequests, streamFilter]);

  /** Aggregate summary of all liveRequests: counts, token totals, cost, latency sums */
  const summary = useMemo(() => {
    return liveRequests.reduce(
      (acc, request) => {
        const isSuccess = (request.responseStatus || '').toLowerCase() === 'success';
        acc.requestCount += 1;
        if (isSuccess) {
          acc.successCount += 1;
        } else {
          acc.errorCount += 1;
        }

        acc.totalTokens +=
          Number(request.tokensInput || 0) +
          Number(request.tokensOutput || 0) +
          Number(request.tokensCached || 0) +
          Number(request.tokensCacheWrite || 0);
        acc.totalCost += Number(request.costTotal || 0);
        acc.totalLatency += Number(request.durationMs || 0);
        acc.totalTtft += Number(request.ttftMs || 0);
        return acc;
      },
      {
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalLatency: 0,
        totalTtft: 0,
      }
    );
  }, [liveRequests]);

  /**
   * Buckets liveRequests into per-minute time slots for the timeline area chart.
   * Pre-creates empty buckets for every minute in the window to ensure the chart
   * always shows the full window range, even if some minutes have zero traffic.
   *
   * For windows > 1 hour, buckets are aggregated to prevent performance issues:
   * - <= 30 minutes: 1-minute buckets
   * - <= 24 hours: 5-minute buckets
   * - <= 7 days: 1-hour buckets
   * - > 7 days: 6-hour buckets
   */
  const minuteSeries = useMemo(() => {
    const buckets = new Map<string, MinuteBucket>();
    const now = Date.now();

    // Determine bucket size based on window
    const useMinuteBuckets = liveWindowMinutes <= 30;
    const use5MinuteBuckets = liveWindowMinutes <= 24 * 60;
    const useHourlyBuckets = liveWindowMinutes <= 7 * 24 * 60;

    // Calculate bucket count and size
    let bucketCount: number;
    let bucketSizeMs: number;

    if (useMinuteBuckets) {
      bucketCount = liveWindowMinutes;
      bucketSizeMs = 60000; // 1 minute
    } else if (use5MinuteBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 5);
      bucketSizeMs = 300000; // 5 minutes
    } else if (useHourlyBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 60);
      bucketSizeMs = 3600000; // 1 hour
    } else {
      bucketCount = Math.ceil(liveWindowMinutes / (60 * 6));
      bucketSizeMs = 21600000; // 6 hours
    }

    // Limit maximum buckets to prevent rendering issues
    const MAX_BUCKETS = 100;
    if (bucketCount > MAX_BUCKETS) {
      bucketCount = MAX_BUCKETS;
      bucketSizeMs = Math.ceil(liveWindowMs / MAX_BUCKETS);
    }

    // Create empty buckets
    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      buckets.set(key, { time: key, requests: 0, errors: 0, tokens: 0 });
    }

    // Assign requests to buckets based on bucket size
    for (const request of liveRequests) {
      const requestTime = new Date(request.date).getTime();
      const bucketIndex = Math.floor((now - requestTime) / bucketSizeMs);
      const bucketDate = new Date(now - bucketIndex * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }

      bucket.requests += 1;
      if ((request.responseStatus || '').toLowerCase() !== 'success') {
        bucket.errors += 1;
      }
      bucket.tokens +=
        Number(request.tokensInput || 0) +
        Number(request.tokensOutput || 0) +
        Number(request.tokensCached || 0) +
        Number(request.tokensCacheWrite || 0);
    }

    return Array.from(buckets.values());
  }, [liveRequests]);

  /**
   * Builds the model-stack composed chart data. This is the most complex memo:
   * 1. Counts requests per model to find the top N models.
   * 2. Assigns each a colour from the palette and a synthetic dataKey.
   * 3. Creates per-minute buckets with a dynamic column for each model.
   * 4. Accumulates TTFT and TPS running totals, then computes averages
   *    in a final map pass.
   * Returns { series, seriesLabelMap, data } for the ComposedChart.
   */
  const modelTimeline = useMemo(() => {
    const modelCounts = new Map<string, number>();
    for (const request of liveRequests) {
      const model = getModelLabel(request);
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }

    const topModels = Array.from(modelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MODEL_TIMELINE_MAX_SERIES)
      .map(([label]) => label);

    const series: ModelTimelineSeries[] = topModels.map((label, index) => ({
      key: 'model_' + index,
      label,
      color: MODEL_TIMELINE_COLORS[index % MODEL_TIMELINE_COLORS.length],
    }));
    const seriesKeyByLabel = new Map(series.map((entry) => [entry.label, entry.key]));

    const buckets = new Map<string, ModelTimelineBucket>();
    const now = Date.now();

    // Use same bucketing strategy as minuteSeries
    const useMinuteBuckets = liveWindowMinutes <= 30;
    const use5MinuteBuckets = liveWindowMinutes <= 24 * 60;
    const useHourlyBuckets = liveWindowMinutes <= 7 * 24 * 60;

    let bucketCount: number;
    let bucketSizeMs: number;

    if (useMinuteBuckets) {
      bucketCount = liveWindowMinutes;
      bucketSizeMs = 60000;
    } else if (use5MinuteBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 5);
      bucketSizeMs = 300000;
    } else if (useHourlyBuckets) {
      bucketCount = Math.ceil(liveWindowMinutes / 60);
      bucketSizeMs = 3600000;
    } else {
      bucketCount = Math.ceil(liveWindowMinutes / (60 * 6));
      bucketSizeMs = 21600000;
    }

    const MAX_BUCKETS = 100;
    if (bucketCount > MAX_BUCKETS) {
      bucketCount = MAX_BUCKETS;
      bucketSizeMs = Math.ceil(liveWindowMs / MAX_BUCKETS);
    }

    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketDate = new Date(now - i * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket: ModelTimelineBucket = {
        time: key,
        requests: 0,
        errors: 0,
        tokens: 0,
        avgTtftMs: 0,
        avgTps: 0,
        ttftTotal: 0,
        ttftCount: 0,
        tpsTotal: 0,
        tpsCount: 0,
      };

      for (const item of series) {
        bucket[item.key] = 0;
      }
      buckets.set(key, bucket);
    }

    // Assign requests to buckets based on bucket size
    for (const request of liveRequests) {
      const requestTime = new Date(request.date).getTime();
      const bucketIndex = Math.floor((now - requestTime) / bucketSizeMs);
      const bucketDate = new Date(now - bucketIndex * bucketSizeMs);
      const key = bucketDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: useMinuteBuckets || use5MinuteBuckets ? '2-digit' : undefined,
        hour12: false,
      });
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }

      bucket.requests += 1;
      if ((request.responseStatus || '').toLowerCase() !== 'success') {
        bucket.errors += 1;
      }
      bucket.tokens +=
        Number(request.tokensInput || 0) +
        Number(request.tokensOutput || 0) +
        Number(request.tokensCached || 0) +
        Number(request.tokensCacheWrite || 0);

      const modelLabel = getModelLabel(request);
      const seriesKey = seriesKeyByLabel.get(modelLabel);
      if (seriesKey) {
        bucket[seriesKey] = Number(bucket[seriesKey] || 0) + 1;
      }

      const ttft = Number(request.ttftMs || 0);
      if (Number.isFinite(ttft) && ttft > 0) {
        bucket.ttftTotal += ttft;
        bucket.ttftCount += 1;
      }

      const tps = Number(request.tokensPerSec || 0);
      if (Number.isFinite(tps) && tps > 0) {
        bucket.tpsTotal += tps;
        bucket.tpsCount += 1;
      }
    }

    const data = Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      avgTtftMs: bucket.ttftCount > 0 ? bucket.ttftTotal / bucket.ttftCount : 0,
      avgTps: bucket.tpsCount > 0 ? bucket.tpsTotal / bucket.tpsCount : 0,
    }));

    return {
      series,
      seriesLabelMap: new Map(series.map((entry) => [entry.key, entry.label])),
      data,
    };
  }, [liveRequests]);

  // ---------------------------------------------------------------------------
  // COMPUTED SCALAR VALUES -- derived from summary and liveRequests
  // ---------------------------------------------------------------------------

  const successRate =
    summary.requestCount > 0 ? (summary.successCount / summary.requestCount) * 100 : 0;
  /** Data is considered "stale" if 3x the poll interval has elapsed without an update */
  const isStale = secondsSinceUpdate > Math.ceil((pollIntervalMs * 3) / 1000);
  const tokensPerMinute = summary.totalTokens / liveWindowMinutes;
  // const costPerMinute = summary.totalCost / liveWindowMinutes; // Unused
  const avgLatency = summary.requestCount > 0 ? summary.totalLatency / summary.requestCount : 0;
  // const avgTtft = summary.requestCount > 0 ? summary.totalTtft / summary.requestCount : 0; // Unused
  // const throughputSamples = liveRequests // Unused
  //   .map((request) => Number(request.tokensPerSec || 0))
  //   .filter((tps) => Number.isFinite(tps) && tps > 0);
  // const avgThroughput = // Unused
  //   throughputSamples.length > 0
  //     ? throughputSamples.reduce((acc, tps) => acc + tps, 0) / throughputSamples.length
  //     : 0;
  const totalRequestsValue =
    stats.find((stat) => stat.label === STAT_LABELS.REQUESTS)?.value || formatNumber(0, 0);
  const totalTokensValue =
    stats.find((stat) => stat.label === STAT_LABELS.TOKENS)?.value || formatTokens(0);
  // const todayTokenTotal = // Unused
  //   todayMetrics.inputTokens +
  //   todayMetrics.outputTokens +
  //   todayMetrics.reasoningTokens +
  //   todayMetrics.cachedTokens +
  //   todayMetrics.cacheWriteTokens;

  /** Total in-flight requests across all providers (sum of concurrencyData counts) */
  const totalConcurrentRequests = useMemo(() => {
    return concurrencyData.reduce((acc, item) => acc + Number(item.count || 0), 0);
  }, [concurrencyData]);

  /** Unique provider names seen across all concurrency history snapshots, for chart lines */
  const concurrencyProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const point of concurrencyHistory) {
      for (const key of Object.keys(point)) {
        if (key !== 'time') providers.add(key);
      }
    }
    return Array.from(providers).sort();
  }, [concurrencyHistory]);

  /** Colour palette for concurrency provider lines */
  const CONCURRENCY_COLORS = [
    '#3b82f6',
    '#14b8a6',
    '#8b5cf6',
    '#f59e0b',
    '#ef4444',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
  ];

  /** Top 6 providers with request count, success rate, avg latency, and cost -- for the alerts panel */
  const providerRows = useMemo(() => {
    const providers = new Map<
      string,
      { requests: number; success: number; totalLatency: number; totalCost: number }
    >();

    for (const request of liveRequests) {
      const provider = getProviderLabel(request);
      const row = providers.get(provider) || {
        requests: 0,
        success: 0,
        totalLatency: 0,
        totalCost: 0,
      };

      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      row.totalLatency += Number(request.durationMs || 0);
      row.totalCost += Number(request.costTotal || 0);
      providers.set(provider, row);
    }

    return Array.from(providers.entries())
      .map(([provider, row]) => ({
        provider,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
        avgLatency: row.requests > 0 ? row.totalLatency / row.requests : 0,
        totalCost: row.totalCost,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 6);
  }, [liveRequests]);

  /**
   * Computes minute-over-minute request rate deltas for the velocity chart.
   * For each bucket after the first, velocity = current.requests - previous.requests.
   * A positive value means traffic is accelerating; negative means decelerating.
   */
  const velocitySeries = useMemo(() => {
    return minuteSeries.map((bucket, index, arr) => {
      if (index === 0) {
        return { time: bucket.time, velocity: bucket.requests };
      }

      const prev = arr[index - 1];
      return {
        time: bucket.time,
        velocity: bucket.requests - prev.requests,
      };
    });
  }, [minuteSeries]);

  /** Top 8 providers by request count with success rate -- for the provider pulse bar chart */
  const providerPulseRows = useMemo(() => {
    const rows = new Map<string, { requests: number; success: number }>();
    for (const request of liveRequests) {
      const provider = getProviderLabel(request);
      const row = rows.get(provider) || { requests: 0, success: 0 };
      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      rows.set(provider, row);
    }

    return Array.from(rows.entries())
      .map(([label, row]) => ({
        label,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [liveRequests]);

  /** Top 8 models by request count with success rate -- for the model pulse bar chart */
  const modelPulseRows = useMemo(() => {
    const rows = new Map<string, { requests: number; success: number }>();
    for (const request of liveRequests) {
      const model = getModelLabel(request);
      const row = rows.get(model) || { requests: 0, success: 0 };
      row.requests += 1;
      if ((request.responseStatus || '').toLowerCase() === 'success') {
        row.success += 1;
      }
      rows.set(model, row);
    }

    return Array.from(rows.entries())
      .map(([label, row]) => ({
        label,
        requests: row.requests,
        successRate: row.requests > 0 ? (row.success / row.requests) * 100 : 0,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [liveRequests]);

  /** Groups cooldowns by "provider:model" key so multiple cooldowns for the same pair are merged */

  const groupedCooldowns = useMemo(() => {
    return cooldowns.reduce(
      (acc, cooldown) => {
        const key = String(cooldown.provider) + ':' + String(cooldown.model);
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(cooldown);
        return acc;
      },
      {} as Record<string, Cooldown[]>
    );
  }, [cooldowns]);

  /** Aggregated stats for the top 5 providers -- used by the "stats" card */
  const providerStats = useMemo(() => aggregateByEntity(liveRequests, 'provider'), [liveRequests]);

  /** Aggregated stats for the top 5 models -- used by the "stats" card */
  const modelStats = useMemo(() => aggregateByEntity(liveRequests, 'model'), [liveRequests]);

  const activeProviderCount = providerStats.filter((p) => p.requests > 0).length;
  const activeModelCount = modelStats.filter((m) => m.requests > 0).length;

  /** Prompts the user to confirm, then clears all active cooldowns via the API */
  const handleClearCooldowns = async () => {
    if (
      !confirm(
        'Clear ALL provider cooldowns?\n\n' +
          'Cooldowns are shared across all API keys. Clearing them affects traffic ' +
          "for every key using those providers. If the underlying problem hasn't " +
          'been resolved, cooldowns will simply re-establish on the next failure.'
      )
    ) {
      return;
    }

    try {
      await api.clearCooldown();
      await loadData();
    } catch (e) {
      alert('Failed to clear cooldowns');
      console.error('Failed to clear cooldowns', e);
    }
  };

  /** Clears a specific provider/model cooldown */
  const handleClearSingleCooldown = async (provider: string, model?: string) => {
    // Limited users whose allowedProviders list is set may only clear a
    // cooldown for a provider they're permitted to use. The backend also
    // enforces this; the client-side check is UX — surface a clear message.
    if (
      limitedAllowedProviders &&
      limitedAllowedProviders.length > 0 &&
      !limitedAllowedProviders.includes(provider)
    ) {
      alert(`Your API key is not permitted to clear cooldowns for provider '${provider}'.`);
      return;
    }
    if (
      !confirm(
        `Clear cooldown for ${provider}${model ? ':' + model : ''}?\n\n` +
          'This affects traffic for every API key using that provider. The ' +
          "cooldown will re-establish on the next failure if the issue isn't " +
          'resolved.'
      )
    ) {
      return;
    }
    try {
      await api.clearCooldown(provider, model);
      await loadData();
    } catch (e) {
      alert('Failed to clear cooldown');
      console.error('Failed to clear cooldown', e);
    }
  };

  //
  // MODAL COMPONENT (inline)
  //

  /**
   * Full-screen modal overlay. Defined inline because it accesses component
   * scope (closeModal) and is not reused elsewhere. Renders a centered, scrollable
   * card with a title bar and close button. Clicking the backdrop closes it.
   */
  const Modal = ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) => {
    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-6xl max-h-[90vh] overflow-auto rounded-lg border border-border-glass bg-bg-card p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-text">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
              aria-label="Close modal"
            >
              <X size={24} className="text-text-secondary" />
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  };

  //
  // MODAL TITLE RESOLVER
  //

  /**
   * Returns the title string for the modal header. When detailedUsageQuery is
   * set, the modal shows the DetailedUsage page and the title is always
   * "Detailed Usage". Otherwise, the title matches the card being expanded.
   */
  const getModalTitle = () => {
    if (detailedUsageQuery) {
      return 'Detailed Usage';
    }
    switch (modalCard) {
      case 'velocity': // Minute-over-minute request rate changes
        return 'Request Velocity (Last 5 Minutes)';
      case 'provider': // Bar chart of top providers by request count
        return 'Provider Pulse (5m)';
      case 'model': // Bar chart of top models by request count
        return 'Model Pulse (5m)';
      case 'timeline': // Area chart of requests/errors/tokens over time
        return 'Live Timeline';
      case 'modelstack': // Stacked bar of model usage with TTFT/TPS overlay
        return 'Model Stack + Runtime';
      case 'requests': // Scrollable list of recent individual requests
        return 'Latest Requests';
      case 'concurrency': // Active in-flight request counts per provider
        return 'Concurrency';
      case 'stats': // Two-column provider/model statistics with EntityRow
        return 'Provider & Model Stats';
      default:
        return '';
    }
  };

  //
  // MODAL CONTENT RENDERER
  //

  /**
   * Renders the expanded modal view for the currently selected card.
   *
   * This function handles two distinct modal modes:
   * 1. **DetailedUsage mode** -- when `detailedUsageQuery` is non-null (user
   *    clicked an AnalyzeButton), renders the full DetailedUsage analytics page
   *    in embedded mode, passing the pre-built query string. The "Back" button
   *    clears detailedUsageQuery, returning focus to the card expansion (or
   *    closing the modal if no card was selected).
   * 2. **Card expansion mode** -- when `modalCard` is set, renders a larger,
   *    more detailed version of that card's content (bigger charts, full lists,
   *    more data points).
   *
   * Each case block is self-contained and renders a full-height chart or list
   * inside the modal's content area.
   */
  const renderModalContent = () => {
    /**
     * DetailedUsage takes priority over card expansion. This handles the case
     * where the user clicked "Analyze" on a card -- the modal shows the full
     * analytics page instead of the card's expanded chart.
     */
    if (detailedUsageQuery) {
      return (
        <DetailedUsage
          embedded
          initialQueryString={detailedUsageQuery}
          onBack={() => setDetailedUsageQuery(null)}
        />
      );
    }
    switch (modalCard) {
      // Expanded velocity chart: full-height LineChart of minute-over-minute deltas
      case 'velocity':
        return (
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={velocitySeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="velocity"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      // Expanded provider chart: full-height BarChart of top 8 providers by request count
      case 'provider':
        return (
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={providerPulseRows.slice(0, 8)}
                margin={{ top: 10, right: 24, left: 0, bottom: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-text-secondary)"
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      // Expanded model view: list of top models with request count and success rate
      case 'model':
        return (
          <div className="h-[60vh]">
            {modelPulseRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary">
                No model traffic in the selected live window.
              </div>
            ) : (
              <div className="space-y-3">
                {modelPulseRows.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-md border border-border-glass bg-bg-glass px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-base text-text font-medium">{row.label}</span>
                      <span className="text-sm text-text-secondary">
                        {formatNumber(row.requests, 0)} requests
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      Success: {row.successRate.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      // Expanded timeline: dual-axis AreaChart with requests+errors (left) and tokens (right)
      case 'timeline':
        return (
          <div className="h-[60vh]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={minuteSeries} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="liveRequests" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="liveTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                <YAxis yAxisId="left" stroke="var(--color-text-secondary)" />
                <YAxis yAxisId="right" orientation="right" stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="requests"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#liveRequests)"
                  strokeWidth={2}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="errors"
                  stroke="#ef4444"
                  fillOpacity={0.15}
                  fill="#ef4444"
                  strokeWidth={1.5}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="tokens"
                  stroke="#10b981"
                  fillOpacity={1}
                  fill="url(#liveTokens)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      // Expanded model stack: ComposedChart with stacked bars (model counts) + line overlays (TTFT, TPS)
      case 'modelstack':
        return (
          <div className="h-[70vh]">
            {modelTimeline.series.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary">
                No model stack data in the selected live window.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={modelTimeline.data}
                  margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                  <YAxis yAxisId="left" stroke="var(--color-text-secondary)" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--color-text-secondary)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'var(--color-text)' }}
                    formatter={(value, name) => {
                      const numeric = Number(value || 0);
                      const label = modelTimeline.seriesLabelMap.get(String(name));
                      if (label) {
                        return [formatNumber(numeric, 0), label];
                      }
                      if (name === 'avgTtftMs') {
                        return [formatMs(numeric), 'Avg TTFT'];
                      }
                      if (name === 'avgTps') {
                        return [formatTPS(numeric), 'Avg TPS'];
                      }
                      return [formatNumber(numeric, 0), String(name)];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => modelTimeline.seriesLabelMap.get(String(value)) || value}
                  />
                  {modelTimeline.series.map((series) => (
                    <Bar
                      key={series.key}
                      yAxisId="left"
                      stackId="model-stack"
                      dataKey={series.key}
                      fill={series.color}
                    />
                  ))}
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgTtftMs"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgTps"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        );
      // Expanded requests: full scrollable list of all filtered requests with detailed stats
      case 'requests':
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
                const isSuccess = status.toLowerCase() === 'success';
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
                          className={
                            isSuccess
                              ? 'text-xs px-2 py-0.5 rounded-md text-success bg-emerald-500/15 border border-success/25'
                              : 'text-xs px-2 py-0.5 rounded-md text-danger bg-red-500/15 border border-danger/30'
                          }
                        >
                          {status}
                        </span>
                      </div>
                      <span className="text-sm text-text-muted">
                        {formatTimeAgo(requestTimeSeconds)}
                      </span>
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
                      <span>Cost: {formatCost(Number(request.costTotal || 0), 6)}</span>
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
      // Expanded concurrency: stacked area chart of in-flight requests over time
      case 'concurrency':
        return (
          <div className="h-[60vh]">
            {concurrencyHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-secondary">
                Collecting concurrency data...
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between p-4 bg-bg-subtle rounded-lg mb-4">
                  <span className="text-sm text-text-muted">Current In-Flight</span>
                  <span className="text-2xl font-semibold text-text tabular-nums">
                    {formatNumber(totalConcurrentRequests, 0)}
                  </span>
                </div>
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={concurrencyHistory}
                      margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                      <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                      <YAxis stroke="var(--color-text-secondary)" allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '8px',
                        }}
                      />
                      {concurrencyProviders.map((provider, idx) => (
                        <Area
                          key={provider}
                          type="monotone"
                          dataKey={provider}
                          stackId="1"
                          stroke={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                          fill={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                          fillOpacity={0.6}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        );
      // Expanded stats: two-column layout with EntityRow lists for providers and models
      case 'stats':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-text flex items-center gap-2">
                <Server size={18} className="text-primary" />
                Top Providers
              </h3>
              {providerStats.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                  No provider activity in window
                </div>
              ) : (
                <div className="space-y-2">
                  {providerStats.map((provider) => (
                    <EntityRow key={provider.name} entity={provider} />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-text flex items-center gap-2">
                <Cpu size={18} className="text-secondary" />
                Top Models
              </h3>
              {modelStats.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                  No model activity in window
                </div>
              ) : (
                <div className="space-y-2">
                  {modelStats.map((model) => (
                    <EntityRow key={model.name} entity={model} isModel />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  //
  // DRAGGABLE CARD FACTORY
  //

  /**
   * Card factory for the drag-and-drop grid. Given a cardId, renders the
   * corresponding SortableCard with its chart/content, title, extra controls
   * (AnalyzeButton, filter toggles), and click handler to open the modal.
   *
   * Each card is wrapped in a SortableCard component from @dnd-kit which
   * provides the drag handle, transform styles, and accessibility attributes.
   *
   * @param cardId   - Which card to render (matches the CardId type)
   * @param index    - Position in the grid (passed to SortableCard for animation)
   * @param isOverlay - True when rendering the drag preview in DragOverlay
   *                    (same visual, but detached from the grid flow)
   *
   * Design: Each case is intentionally self-contained with inline chart config.
   * While this creates some repetition (e.g. Tooltip styling), it keeps each
   * card's complete configuration visible in one place, which is easier to
   * maintain than abstracting shared chart options into a separate config object.
   */
  const renderDraggableCard = (cardId: CardId, index: number, isOverlay = false) => {
    switch (cardId) {
      // metrics: Combined overview and live window stats
      case 'metrics':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Metrics',
              extra: (
                <div className="flex items-center gap-2">
                  <Signal size={15} className="text-info" />
                  <span className="text-[11px] text-text-muted">Overview & Live Stats</span>
                </div>
              ),
              onClick: () => openModal('stats'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content: (
                <div className="h-56 grid grid-cols-2 divide-x divide-border overflow-hidden">
                  {/* Overview column */}
                  <div className="divide-y divide-border">
                    <div className="px-3 py-1.5 bg-bg-subtle/50">
                      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Overview
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Total Requests</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {totalRequestsValue}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Total Tokens</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {totalTokensValue}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Requests Today</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {formatNumber(todayMetrics.requests, 0)}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Cost Today</span>
                      <span className="text-sm font-semibold text-info tabular-nums">
                        {formatCost(todayMetrics.totalCost, 4)}
                      </span>
                    </div>
                  </div>
                  {/* Live Window column */}
                  <div className="divide-y divide-border">
                    <div className="px-3 py-1.5 bg-bg-subtle/50">
                      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Live ({liveWindowMinutes}m)
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Requests</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {formatNumber(summary.requestCount, 0)}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Success Rate</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {successRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Tokens / Min</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {formatTokens(tokensPerMinute)}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted">Avg Latency</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {formatMs(avgLatency)}
                      </span>
                    </div>
                  </div>
                </div>
              ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // alerts: Active provider cooldowns and top provider activity
      case 'alerts':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Alerts & Providers',
              extra: (
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    size={15}
                    className={cooldowns.length > 0 ? 'text-warning' : 'text-text-muted'}
                  />
                  {cooldowns.length > 0 && isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearCooldowns();
                      }}
                      className="text-[11px] text-warning hover:text-warning/80 transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              ),
              onClick: () => openModal('stats'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content: (
                <div className="h-56 flex flex-col overflow-hidden">
                  {cooldowns.length > 0 && (
                    <div className="divide-y divide-border border-b border-warning/30 bg-warning/5 max-h-30 overflow-y-auto">
                      {Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
                        const [provider, model] = key.split(':');
                        const maxTime = Math.max(...modelCooldowns.map((c) => c.timeRemainingMs));
                        const representative = modelCooldowns.reduce((a, b) =>
                          a.timeRemainingMs >= b.timeRemainingMs ? a : b
                        );
                        const minutes = Math.ceil(maxTime / 60000);
                        return (
                          <CooldownRow
                            key={key}
                            provider={normalizeTelemetryLabel(provider) || 'Unknown'}
                            modelDisplay={model || 'all models'}
                            minutes={minutes}
                            consecutiveFailures={representative.consecutiveFailures}
                            lastError={representative.lastError}
                            expiryStr={new Date(representative.expiry).toLocaleString()}
                            onClear={() => handleClearSingleCooldown(provider, model)}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className="flex-1 divide-y divide-border overflow-y-auto">
                    {providerRows.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-text-muted">
                        No provider activity in the last {liveWindowMinutes} minutes.
                      </div>
                    ) : (
                      providerRows.map((row) => (
                        <div key={row.provider} className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-text">{row.provider}</span>
                            <span className="text-xs text-text-muted tabular-nums">
                              {formatNumber(row.requests, 0)} req
                            </span>
                          </div>
                          <div className="flex gap-3 mt-0.5 text-[11px] text-text-muted">
                            <span>{row.successRate.toFixed(1)}% ok</span>
                            <span>{formatMs(row.avgLatency)}</span>
                            <span className="text-info">{formatCost(row.totalCost, 6)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // velocity: LineChart showing minute-over-minute request rate changes
      // (the delta between consecutive minute buckets)
      case 'velocity':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Request Velocity (Last 5 Minutes)',
              extra: (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">Minute-over-minute delta</span>
                  <AnalyzeButton
                    cardType="velocity"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('velocity')}
                  />
                </div>
              ),
              onClick: () => openModal('velocity'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content:
                velocitySeries.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary">
                    No velocity data available
                  </div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={velocitySeries}
                        margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                        <XAxis
                          dataKey="time"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        />
                        <YAxis
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                          }}
                          labelStyle={{ color: 'var(--color-text)' }}
                          formatter={(value) => [formatNumber(Number(value || 0), 0), 'Velocity']}
                        />
                        <Line
                          type="monotone"
                          dataKey="velocity"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // provider: BarChart of top providers ranked by request count in the live window
      case 'provider':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Provider Pulse (5m)',
              extra: (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">Top 8 providers</span>
                  <AnalyzeButton
                    cardType="provider"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('provider')}
                  />
                </div>
              ),
              onClick: () => openModal('provider'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content:
                providerPulseRows.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary">
                    No provider traffic in the selected live window.
                  </div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={providerPulseRows.slice(0, 6)}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                        <XAxis
                          dataKey="label"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                          interval={0}
                          angle={-20}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                          }}
                          labelStyle={{ color: 'var(--color-text)' }}
                          formatter={(value) => [formatNumber(Number(value || 0), 0), 'Requests']}
                        />
                        <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // model: BarChart of top models ranked by request count in the live window
      case 'model':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Model Pulse (5m)',
              extra: (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">Top 8 models</span>
                  <AnalyzeButton
                    cardType="model"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('model')}
                  />
                </div>
              ),
              onClick: () => openModal('model'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content:
                modelPulseRows.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary">
                    No model traffic in the selected live window.
                  </div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={modelPulseRows.slice(0, 6)}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                        <XAxis
                          dataKey="label"
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                          interval={0}
                          angle={-20}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          stroke="var(--color-text-secondary)"
                          tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                          }}
                          labelStyle={{ color: 'var(--color-text)' }}
                          formatter={(value) => [formatNumber(Number(value || 0), 0), 'Requests']}
                        />
                        <Bar dataKey="requests" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // timeline: AreaChart showing requests, errors, and tokens over time
      // with dual Y-axes (left: request/error counts, right: token volume)
      case 'timeline':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Live Timeline',
              extra: (
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-primary" />
                  <AnalyzeButton
                    cardType="timeline"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('timeline')}
                  />
                </div>
              ),
              onClick: () => openModal('timeline'),
              style: { cursor: 'pointer' },
              className: 'min-w-0 hover:shadow-lg hover:border-primary/30 transition-all',
              content: loading ? (
                <div className="h-56 flex items-center justify-center text-text-secondary">
                  Loading...
                </div>
              ) : minuteSeries.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-text-secondary">
                  No requests in the last {liveWindowMinutes} minutes
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={minuteSeries}
                      margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="liveRequests" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
                        </linearGradient>
                        <linearGradient id="liveTokens" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                      <XAxis
                        dataKey="time"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="left"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'var(--color-text)' }}
                        formatter={(value, name) => {
                          if (name === 'tokens') {
                            return [formatTokens(Number(value || 0)), 'Tokens'];
                          }

                          return [
                            formatNumber(Number(value || 0), 0),
                            name === 'requests' ? 'Requests' : 'Errors',
                          ];
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="requests"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#liveRequests)"
                        strokeWidth={2}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="errors"
                        stroke="#ef4444"
                        fillOpacity={0.15}
                        fill="#ef4444"
                        strokeWidth={1.5}
                      />
                      <Area
                        yAxisId="right"
                        type="monotone"
                        dataKey="tokens"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#liveTokens)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // modelstack: ComposedChart with stacked bars for model request counts
      // and line overlays for avg TTFT (ms) and avg TPS runtime metrics
      case 'modelstack':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Model Stack',
              extra: (
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-primary" />
                  <AnalyzeButton
                    cardType="modelstack"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('modelstack')}
                  />
                </div>
              ),
              onClick: () => openModal('modelstack'),
              style: { cursor: 'pointer' },
              className: 'min-w-0 hover:shadow-lg hover:border-primary/30 transition-all',
              content: loading ? (
                <div className="h-56 flex items-center justify-center text-text-secondary">
                  Loading...
                </div>
              ) : modelTimeline.series.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-text-secondary">
                  No model stack data in the last {liveWindowMinutes} minutes
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={modelTimeline.data}
                      margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                      <XAxis
                        dataKey="time"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="left"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="var(--color-text-secondary)"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                        tickFormatter={(value) => formatNumber(Number(value || 0), 1)}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'var(--color-text)' }}
                        formatter={(value, name) => {
                          const numeric = Number(value || 0);
                          const label = modelTimeline.seriesLabelMap.get(String(name));
                          if (label) {
                            return [formatNumber(numeric, 0), label];
                          }

                          if (name === 'avgTtftMs') {
                            return [formatMs(numeric), 'Avg TTFT'];
                          }

                          if (name === 'avgTps') {
                            return [formatTPS(numeric), 'Avg TPS'];
                          }

                          return [formatNumber(numeric, 0), String(name)];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(value) =>
                          modelTimeline.seriesLabelMap.get(String(value)) || value
                        }
                      />
                      {modelTimeline.series.map((series) => (
                        <Bar
                          key={series.key}
                          yAxisId="left"
                          stackId="model-stack"
                          dataKey={series.key}
                          fill={series.color}
                        />
                      ))}
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="avgTtftMs"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="avgTps"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // requests: scrollable list of the 20 most recent individual requests
      // with provider, model, status badge, tokens, cost, latency, TTFT, and TPS
      case 'requests':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Latest Requests',
              onClick: () => openModal('requests'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              extra: (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-text-secondary mr-1">Latest 20</span>
                  <Button
                    size="sm"
                    variant={streamFilter === 'all' ? 'primary' : 'secondary'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setStreamFilter('all');
                    }}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={streamFilter === 'success' ? 'primary' : 'secondary'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setStreamFilter('success');
                    }}
                  >
                    Success
                  </Button>
                  <Button
                    size="sm"
                    variant={streamFilter === 'error' ? 'primary' : 'secondary'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setStreamFilter('error');
                    }}
                  >
                    Errors
                  </Button>
                  <AnalyzeButton
                    cardType="requests"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('requests')}
                  />
                </div>
              ),
              content:
                filteredLiveRequests.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary">
                    {liveRequests.length === 0
                      ? 'No requests observed yet.'
                      : 'No requests match the current filter.'}
                  </div>
                ) : (
                  <div className="h-56 space-y-2 overflow-y-auto pr-1">
                    {filteredLiveRequests.slice(0, 20).map((request) => {
                      const requestTimeSeconds = Math.max(
                        0,
                        Math.floor((Date.now() - new Date(request.date).getTime()) / 1000)
                      );
                      const status = (request.responseStatus || 'errored').toLowerCase();
                      const isSuccess = status.toLowerCase() === 'success';
                      const providerLabel = getProviderLabel(request);
                      const modelLabel = getModelLabel(request);

                      return (
                        <div
                          key={request.requestId}
                          className="rounded-md border border-border-glass bg-bg-glass p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-text font-medium">{providerLabel}</span>
                              <span className="text-xs text-text-secondary">{modelLabel}</span>
                              <span
                                className={
                                  isSuccess
                                    ? 'text-[11px] px-2 py-0.5 rounded-md text-success bg-emerald-500/15 border border-success/25'
                                    : 'text-[11px] px-2 py-0.5 rounded-md text-danger bg-red-500/15 border border-danger/30'
                                }
                              >
                                {status}
                              </span>
                            </div>
                            <span className="text-xs text-text-muted">
                              {formatTimeAgo(requestTimeSeconds)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
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
                            <span>Cost: {formatCost(Number(request.costTotal || 0), 6)}</span>
                            <span>Latency: {formatMs(Number(request.durationMs || 0))}</span>
                            <span>TTFT: {formatMs(Number(request.ttftMs || 0))}</span>
                            <span>TPS: {formatTPS(Number(request.tokensPerSec || 0))}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // concurrency: shows active in-flight request counts per provider,
      // auto-refreshes every 10 seconds via a separate polling loop
      case 'concurrency':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Concurrency',
              extra: (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Auto-refresh: 10s</span>
                  <AnalyzeButton
                    cardType="concurrency"
                    size="sm"
                    onClick={() => openDetailedUsageInModal('concurrency')}
                  />
                </div>
              ),
              onClick: () => openModal('concurrency'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content:
                concurrencyLoading && concurrencyHistory.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary text-sm">
                    Loading concurrency data...
                  </div>
                ) : concurrencyHistory.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-text-secondary text-sm">
                    Collecting concurrency data...
                  </div>
                ) : (
                  <div className="h-56">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-text-muted">In-Flight by Provider</span>
                      <span className="text-sm font-semibold text-text tabular-nums">
                        {formatNumber(totalConcurrentRequests, 0)}
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height="85%">
                      <AreaChart
                        data={concurrencyHistory}
                        margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                        <XAxis dataKey="time" stroke="var(--color-text-secondary)" />
                        <YAxis stroke="var(--color-text-secondary)" allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                          }}
                        />
                        {concurrencyProviders.map((provider, idx) => (
                          <Area
                            key={provider}
                            type="monotone"
                            dataKey={provider}
                            stackId="1"
                            stroke={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                            fill={CONCURRENCY_COLORS[idx % CONCURRENCY_COLORS.length]}
                            fillOpacity={0.6}
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      // stats: two-column layout showing aggregated provider and model statistics
      // (success rate, latency, cost, TPS) via EntityRow components
      case 'stats':
        return (
          <SortableCard
            key={'sortable-' + cardId}
            card={{
              id: cardId,
              title: 'Provider & Model Stats',
              extra: (
                <span className="text-xs text-text-secondary">
                  {activeProviderCount} providers, {activeModelCount} models
                </span>
              ),
              onClick: () => openModal('stats'),
              style: { cursor: 'pointer' },
              className: 'hover:shadow-lg hover:border-primary/30 transition-all',
              content: (
                <div className="h-56 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                      <Server size={16} className="text-primary" />
                      Top Providers
                    </h4>
                    {providerStats.length === 0 ? (
                      <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                        No provider activity in window
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-70 overflow-y-auto pr-1">
                        {providerStats.map((provider) => (
                          <EntityRow key={provider.name} entity={provider} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                      <Cpu size={16} className="text-secondary" />
                      Top Models
                    </h4>
                    {modelStats.length === 0 ? (
                      <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                        No model activity in window
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-70 overflow-y-auto pr-1">
                        {modelStats.map((model) => (
                          <EntityRow key={model.name} entity={model} isModel />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            }}
            index={index}
            isOverlay={isOverlay}
          />
        );
      default:
        return null;
    }
  };

  //
  // JSX RETURN -- Page Layout
  //

  /**
   * The component layout is structured in three major vertical sections:
   *
   * 1. **Header + Toolbar** -- Page title, connection badge, refresh button,
   *    and polling interval toggle buttons.
   *
   * 2. **Summary Panel** -- A 2-column grid with:
   *    - Left: Combined metrics card (overview totals + live window stats)
   *    - Right: Alerts (cooldowns) + top provider activity rows
   *
   * 3. **Draggable Card Grid** -- A 2-column responsive grid wrapped in
   *    DndContext/SortableContext for drag-and-drop reordering. Each card
   *    is rendered via renderDraggableCard(). A DragOverlay provides the
   *    floating preview during drag gestures.
   *
   * 4. **Modal** -- Rendered at the bottom of the tree, portalled to the
   *    viewport via fixed positioning. Shows either an expanded card view
   *    or an embedded DetailedUsage page.
   */
  return (
    <div className="p-6 transition-all duration-300">
      {/* ------- Page Header ------- */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="header-left">
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Live Metrics</h1>
        </div>

        <Badge
          status={isConnected && !isStale ? 'connected' : 'warning'}
          secondaryText={'Window: last ' + liveWindowMinutes + 'm'}
          style={{ minWidth: '210px' }}
        >
          {isConnected
            ? isStale
              ? 'Live Polling Delayed'
              : 'Live Polling Active'
            : 'Live Polling Reconnecting'}
        </Badge>
      </div>

      {/* ------- Deprecation Warning Banner ------- */}
      {showConfigWarning && (
        <div className="mb-6 p-4 border border-danger/30 rounded-lg bg-danger/10">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-danger mb-1">
                ADMIN_KEY Not Set as Environment Variable
              </h3>
              <p className="text-sm text-text-secondary mb-2">
                Plexus started using the adminKey from plexus.yaml because the ADMIN_KEY environment
                variable is not set.
              </p>
              <p className="text-sm text-text-secondary mb-2">
                <strong>Action Required:</strong> Set ADMIN_KEY as an environment variable before
                the next restart:
              </p>
              <p className="text-sm font-mono bg-bg-hover px-2 py-1 rounded mb-2">
                export ADMIN_KEY="your-admin-key"
              </p>
              <p className="text-sm text-text-secondary">
                Note: Your configuration has been imported to the database. The YAML file will not
                be re-read. Future changes must be made via the web UI or management API.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void loadData()}
          isLoading={isRefreshing}
        >
          <RefreshCw size={14} />
          Refresh Now
        </Button>
        {POLL_INTERVAL_OPTIONS.map((option) => {
          const label = String(Math.floor(option / 1000)) + 's';
          return (
            <Button
              key={option}
              size="sm"
              variant={pollIntervalMs === option ? 'primary' : 'secondary'}
              onClick={() => {
                setPollIntervalMs(option);
                onPollIntervalChange(option);
              }}
            >
              Poll {label}
            </Button>
          );
        })}
        <span className="text-xs text-text-secondary">|</span>
        {LIVE_WINDOW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={liveWindowMinutes === option.value ? 'primary' : 'secondary'}
            onClick={() => {
              setLiveWindowMinutes(option.value);
              onLiveWindowPeriodChange?.(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
        <span className="text-xs text-text-muted">
          {isVisible ? 'Tab active' : 'Tab hidden'} - data refresh resumes on focus.
        </span>
      </div>

      {/*
        DndContext: Top-level drag-and-drop context from @dnd-kit.
        Provides the drag sensor system and dispatches start/end/cancel events.

        SortableContext: Tells @dnd-kit which items are sortable and in what order.
        It uses `orderedCardIds` (the user's persisted order) as the items array.

        The grid uses CSS grid (2 columns on lg+) and iterates orderedCardIds,
        rendering each card via renderDraggableCard(). The key on the wrapping
        div is the cardId to ensure stable reconciliation during reorders.
      */}
      <DndContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={orderedCardIds}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {orderedCardIds.map((cardId, index) => (
              <div key={cardId}>{renderDraggableCard(cardId, index)}</div>
            ))}
          </div>
        </SortableContext>

        {/*
          DragOverlay renders a floating copy of the card being dragged.
          It is portal-rendered above all other content so it is not clipped
          by overflow containers. The card is rendered with isOverlay=true
          and a max-width constraint so it does not stretch full viewport width.
          When no drag is active (activeCardId === null), nothing is rendered.
        */}
        <DragOverlay>
          {activeCardId ? (
            <div className="w-[min(100%,720px)]">{renderDraggableCard(activeCardId, 0, true)}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/*
        The shared Modal instance. Its content is determined by getModalTitle()
        and renderModalContent(), which switch between expanded card views and
        the embedded DetailedUsage analytics page based on component state.
      */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={getModalTitle()}>
        {renderModalContent()}
      </Modal>
    </div>
  );
};
