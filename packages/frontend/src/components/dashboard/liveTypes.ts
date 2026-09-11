/**
 * @file liveTypes.ts
 *
 * Types, interfaces, and constants for the Live Metrics dashboard.
 */

/**
 * A single minute-resolution bucket for the timeline area chart.
 * Each bucket aggregates all requests that fall within that calendar minute.
 */
export type MinuteBucket = {
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
export type ModelTimelineSeries = {
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
export type ModelTimelineBucket = Record<string, string | number> & {
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
export type StreamFilter = 'all' | 'success' | 'error';

/** Card IDs that support an expanded modal view */
export type ModalCardId =
  | 'velocity'
  | 'provider'
  | 'model'
  | 'timeline'
  | 'modelstack'
  | 'requests'
  | 'concurrency'
  | 'stats';

/** Available live window periods in minutes */
export const LIVE_WINDOW_OPTIONS = [
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 1440, label: '1d' },
  { value: 10080, label: '7d' },
  { value: 43200, label: '30d' },
] as const;

/** Available polling intervals shown as toggle buttons in the toolbar */
export const POLL_INTERVAL_OPTIONS = [5000, 10000, 30000] as const;

/** Maximum number of distinct models shown in the model-stack chart */
export const MODEL_TIMELINE_MAX_SERIES = 5;

/** Colour palette for the stacked model bars (cycles if more than 5 models) */
export const MODEL_TIMELINE_COLORS = [
  '#3b82f6',
  '#14b8a6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
] as const;

/** Colour palette for concurrency provider lines */
export const CONCURRENCY_COLORS = [
  '#3b82f6',
  '#14b8a6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
] as const;

/**
 * Telemetry labels that are treated as "unset". Providers and models sometimes
 * report placeholder strings instead of null, so we normalise these away.
 */
export const PLACEHOLDER_LABELS: Record<string, true> = {
  unknown: true,
  'n/a': true,
  na: true,
  none: true,
  null: true,
  undefined: true,
};
export const EXCLUDED_PROVIDER_LABELS = ['Failed Request', 'Unresolved Provider'];

/**
 * Aggregated statistics for a single entity (provider or model).
 * Used by the "stats" card and its expanded modal view.
 */
export interface EntityStats {
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
