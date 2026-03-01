/**
 * DetailedUsage Page
 * ===================
 * The advanced analytics drill-down page for Plexus LLM gateway usage data.
 * This component provides customizable charts, grouping, and filtering for
 * deep analysis of request patterns, costs, performance, and errors.
 *
 * ## Dual-mode rendering
 *
 * This page supports two rendering modes:
 *
 * 1. **Standalone mode** (default): Rendered as a full page at `/ui/detailed-usage`.
 *    Includes full page chrome (gradient background, padding, navigation back to
 *    Live Metrics via browser navigation). Query parameters are read from the
 *    browser URL (`window.location.search`).
 *
 * 2. **Embedded mode** (`embedded={true}`): Rendered inside a modal dialog,
 *    typically opened from a Live Metrics card via AnalyzeButton. Page chrome is
 *    stripped (minimal padding, flat background). A "Back to Live Card" button
 *    appears that calls the `onBack` callback to close the modal. Query parameters
 *    are passed directly via the `initialQueryString` prop rather than reading
 *    from the URL, allowing the parent (LiveTab) to configure filters
 *    programmatically.
 *
 * ## Data flow
 *
 *    URL params / initialQueryString
 *         |
 *         v
 *    parsePresetFromQuery() --> initial state (timeRange, chartType, groupBy, etc.)
 *         |
 *         v
 *    loadData() --> api.getLogs(startDate based on timeRange)
 *         |
 *         v
 *    records[] (raw UsageRecord array)
 *         |
 *         v
 *    aggregateByTime() or aggregateByGroup() --> aggregatedData[]
 *         |
 *         v
 *    renderTimeSeriesChart() / renderPieChart() / list table
 *
 * ## Auto-refresh
 *
 * Data is automatically refreshed every 30 seconds via `setInterval` in a
 * `useEffect` hook. The interval is reset whenever `timeRange` changes (since
 * `loadData` depends on `timeRange` via `useCallback`). A manual "Refresh"
 * button is also available in the chart card header.
 *
 * ## Query parameter contract (consumed by parsePresetFromQuery)
 *
 * | Param           | Values                                    | Default     |
 * |-----------------|-------------------------------------------|-------------|
 * | `range`         | live, hour, day, week, month              | day         |
 * | `chartType`     | line, bar, area, pie, composed             | area        |
 * | `groupBy`       | time, provider, model, apiKey, status      | time        |
 * | `viewMode`      | chart, list                               | chart       |
 * | `metrics`       | comma-separated metric keys               | requests,tokens,cost |
 * | `metric`        | single metric key (fallback for `metrics`) | (none)      |
 * | `filterProvider`| provider name string                      | (none)      |
 * | `filterModel`   | model name string                         | (none)      |
 * | `filterStatus`  | status string (e.g., "error")             | (none)      |
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api, type UsageRecord } from '../lib/api';
import { formatCost, formatMs, formatNumber, formatTokens, formatTimeAgo } from '../lib/format';
import {
  Activity,
  BarChart3,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  TrendingUp,
  Clock,
  DollarSign,
  Database,
  List,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
} from 'recharts';

// ---------------------------------------------------------------------------
// Type definitions for the configurable analytics controls
// ---------------------------------------------------------------------------

/** Time window for data fetching. 'live' = 5-minute rolling window. */
type TimeRange = 'live' | 'hour' | 'day' | 'week' | 'month';

/** Chart visualization type. 'composed' overlays bars + lines for multi-metric views. */
type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'composed';

/** Dimension to aggregate data by. 'time' produces time-series; others produce categorical groupings. */
type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';

/** Toggle between chart visualization and raw request log table. */
type ViewMode = 'chart' | 'list';

/**
 * Props for the DetailedUsage component.
 *
 * All props are optional -- when none are provided, the component runs in
 * standalone page mode, reading configuration from `window.location.search`.
 */
interface DetailedUsageProps {
  /**
   * When `true`, the component renders in embedded/modal mode:
   * - Removes the full-page gradient background and large padding
   * - Uses a compact `h-full p-2 bg-bg-card` layout suitable for modal containers
   * - Shows a "Back to Live Card" button (if `onBack` is also provided)
   *
   * When `false` or omitted, renders as a full standalone page with
   * `min-h-screen` and gradient background.
   */
  embedded?: boolean;

  /**
   * Pre-configured query string to initialize the page state from.
   * Used in embedded mode so the parent (LiveTab) can pass filter configuration
   * directly without relying on `window.location.search`.
   *
   * This string should NOT include a leading '?' -- it is passed directly to
   * `URLSearchParams`. Typically generated by `buildQueryString()` from
   * AnalyzeButton.
   *
   * Example: `"range=live&groupBy=provider&chartType=pie&metric=requests"`
   *
   * When omitted (standalone mode), the component falls back to reading
   * `window.location.search` for its initial configuration.
   */
  initialQueryString?: string;

  /**
   * Callback invoked when the user clicks the "Back to Live Card" button
   * in embedded mode. The parent component (usually the modal container)
   * should use this to close the modal and return to the Live Metrics card.
   *
   * When omitted in non-embedded mode, the back button navigates to
   * `/ui/live-metrics` via `window.location.href` instead.
   */
  onBack?: () => void;
}

/**
 * Configuration for a single selectable metric in the chart.
 * Each metric can be toggled on/off and is rendered as a separate
 * series (line, bar, or area) in the chart with its own color and Y-axis.
 */
interface MetricConfig {
  /** Metric key matching the property name on AggregatedPoint (e.g., 'requests', 'tokens') */
  key: string;
  /** Human-readable label shown in chart legends and metric toggle buttons */
  label: string;
  /** Hex color for the chart series */
  color: string;
  /** Which Y-axis to plot on: 'left' for counts, 'right' for rates/costs/durations */
  yAxisId?: 'left' | 'right';
  /** Formatter function for tooltip and axis tick values */
  format: (value: number) => string;
}

/**
 * A single data point in the aggregated chart dataset.
 *
 * When groupBy='time', `name` is a formatted time bucket label (e.g., "14:30").
 * When groupBy is a categorical dimension, `name` is the group key (e.g., "openai", "gpt-4").
 *
 * Numeric fields are aggregated from raw UsageRecord values:
 * - `requests`, `errors`, `tokens`, `cost` are summed totals for the bucket/group.
 * - `duration`, `ttft`, `tps` are averaged across records in the bucket/group.
 * - `successRate` is derived: ((requests - errors) / requests) * 100.
 * - `velocity` is computed post-aggregation as the delta in requests between adjacent time buckets.
 * - `fill` is a deterministic color derived from the group name (for pie chart slices).
 */
interface AggregatedPoint {
  name: string;
  requests: number;
  errors: number;
  tokens: number;
  cost: number;
  duration: number;
  ttft: number;
  tps: number;
  successRate: number;
  velocity?: number;
  fill?: string;
}

/**
 * Available metrics that can be toggled on/off in the chart.
 * Count-based metrics (requests, errors) use the left Y-axis;
 * rate/cost/duration metrics use the right Y-axis to avoid scale conflicts.
 */
const METRICS: MetricConfig[] = [
  {
    key: 'requests',
    label: 'Requests',
    color: '#3b82f6',
    yAxisId: 'left',
    format: (v) => formatNumber(v, 0),
  },
  {
    key: 'tokens',
    label: 'Tokens',
    color: '#10b981',
    yAxisId: 'right',
    format: (v) => formatTokens(v),
  },
  {
    key: 'cost',
    label: 'Cost',
    color: '#f59e0b',
    yAxisId: 'right',
    format: (v) => formatCost(v, 4),
  },
  {
    key: 'duration',
    label: 'Duration',
    color: '#8b5cf6',
    yAxisId: 'right',
    format: (v) => formatMs(v),
  },
  { key: 'ttft', label: 'TTFT', color: '#ec4899', yAxisId: 'right', format: (v) => formatMs(v) },
  {
    key: 'tps',
    label: 'TPS',
    color: '#06b6d4',
    yAxisId: 'right',
    format: (v) => formatNumber(v, 1),
  },
  {
    key: 'errors',
    label: 'Errors',
    color: '#ef4444',
    yAxisId: 'left',
    format: (v) => formatNumber(v, 0),
  },
];

/** Color palette for pie chart slices and categorical group assignments. */
const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
];

/** Duration of the 'live' time range window in minutes. */
const LIVE_WINDOW_MINUTES = 5;

// ---------------------------------------------------------------------------
// Validation allowlists for query parameter parsing.
// Unknown values are replaced with safe defaults (see parsePresetFromQuery).
// ---------------------------------------------------------------------------
const ALLOWED_TIME_RANGES: TimeRange[] = ['live', 'hour', 'day', 'week', 'month'];
const ALLOWED_CHART_TYPES: ChartType[] = ['line', 'bar', 'area', 'pie', 'composed'];
const ALLOWED_GROUP_BY: GroupBy[] = ['time', 'provider', 'model', 'apiKey', 'status'];
const ALLOWED_VIEW_MODES: ViewMode[] = ['chart', 'list'];

/**
 * Parse a query string into validated preset values for all configurable controls.
 *
 * Each parameter is validated against its allowlist. Invalid or missing values
 * fall back to sensible defaults:
 *   - timeRange: 'day'
 *   - chartType: 'area'
 *   - groupBy: 'time'
 *   - viewMode: 'chart'
 *   - selectedMetrics: ['requests', 'tokens', 'cost']
 *
 * Metrics can be specified as either:
 *   - `metrics=requests,velocity,errors` (comma-separated, used by velocity/timeline cards)
 *   - `metric=requests` (single metric, used by provider/model cards)
 *
 * @param query - Raw query string without leading '?'
 * @returns Validated preset object ready to initialize component state
 */
const parsePresetFromQuery = (
  query: string
): {
  timeRange: TimeRange;
  chartType: ChartType;
  groupBy: GroupBy;
  viewMode: ViewMode;
  selectedMetrics: string[];
} => {
  const params = new URLSearchParams(query);

  const range = params.get('range');
  const chartType = params.get('chartType');
  const groupBy = params.get('groupBy');
  const viewMode = params.get('viewMode');
  const metrics = params.get('metrics');
  const metric = params.get('metric');

  const parsedMetrics = (
    metrics ? metrics.split(',') : metric ? [metric] : ['requests', 'tokens', 'cost']
  )
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    timeRange: ALLOWED_TIME_RANGES.includes(range as TimeRange) ? (range as TimeRange) : 'day',
    chartType: ALLOWED_CHART_TYPES.includes(chartType as ChartType)
      ? (chartType as ChartType)
      : 'area',
    groupBy: ALLOWED_GROUP_BY.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : 'time',
    viewMode: ALLOWED_VIEW_MODES.includes(viewMode as ViewMode) ? (viewMode as ViewMode) : 'chart',
    selectedMetrics: parsedMetrics.length > 0 ? parsedMetrics : ['requests', 'tokens', 'cost'],
  };
};

/**
 * Get the time window size and bucketing function for a given time range.
 *
 * The `minutes` value determines how far back to fetch data from the API.
 * The `bucketFn` truncates a Date to the appropriate granularity for grouping:
 *   - live/hour: truncate to the nearest minute (second-level precision removed)
 *   - day: truncate to the nearest hour
 *   - week/month: truncate to the nearest day
 *
 * @param range - The selected time range
 * @returns Object with `minutes` (window size) and `bucketFn` (date truncation)
 */
const getRangeConfig = (range: TimeRange): { minutes: number; bucketFn: (d: Date) => void } => {
  switch (range) {
    case 'live':
      return { minutes: LIVE_WINDOW_MINUTES, bucketFn: (d) => d.setSeconds(0, 0) };
    case 'hour':
      return { minutes: 60, bucketFn: (d) => d.setSeconds(0, 0) };
    case 'day':
      return { minutes: 1440, bucketFn: (d) => d.setMinutes(0, 0, 0) };
    case 'week':
      return { minutes: 10080, bucketFn: (d) => d.setHours(0, 0, 0, 0) };
    case 'month':
      return { minutes: 43200, bucketFn: (d) => d.setHours(0, 0, 0, 0) };
  }
};

/**
 * Format a time bucket timestamp into a human-readable X-axis label.
 * Short ranges (live, hour, day) show time-of-day; longer ranges show date.
 */
const formatBucketLabel = (range: TimeRange, ms: number) => {
  const d = new Date(ms);
  return range === 'live' || range === 'hour' || range === 'day'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
};

/**
 * Compute velocity (request count delta) between adjacent time buckets.
 * Velocity at index 0 is always 0 (no previous bucket to compare against).
 * This is only meaningful for time-series data (groupBy='time').
 */
const calcVelocity = (data: AggregatedPoint[]): AggregatedPoint[] => {
  return data.map((point, i, arr) => ({
    ...point,
    velocity: i === 0 ? 0 : point.requests - arr[i - 1].requests,
  }));
};

/**
 * Aggregate raw usage records into time-series buckets for chart rendering.
 *
 * Process:
 * 1. Each record's date is truncated to its time bucket via `bucketFn`
 * 2. Records falling into the same bucket are summed (requests, errors, tokens, cost)
 *    or averaged (duration, ttft, tps)
 * 3. Buckets are sorted chronologically
 * 4. Velocity is computed as the delta between adjacent buckets
 *
 * @param records - Raw usage records from the API
 * @param range   - Current time range (determines bucket granularity)
 * @returns Sorted array of aggregated data points with velocity computed
 */
const aggregateByTime = (records: UsageRecord[], range: TimeRange): AggregatedPoint[] => {
  const { bucketFn } = getRangeConfig(range);
  const grouped = new Map<
    number,
    {
      requests: number;
      errors: number;
      tokens: number;
      cost: number;
      duration: number;
      ttft: number;
      tps: number;
      count: number;
    }
  >();

  records.forEach((r) => {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) return;
    bucketFn(d);
    const ms = d.getTime();
    const ex = grouped.get(ms) || {
      requests: 0,
      errors: 0,
      tokens: 0,
      cost: 0,
      duration: 0,
      ttft: 0,
      tps: 0,
      count: 0,
    };
    ex.requests++;
    if (r.responseStatus !== 'success') ex.errors++;
    ex.tokens +=
      (r.tokensInput || 0) +
      (r.tokensOutput || 0) +
      (r.tokensReasoning || 0) +
      (r.tokensCached || 0);
    ex.cost += r.costTotal || 0;
    ex.duration += r.durationMs || 0;
    ex.ttft += r.ttftMs || 0;
    ex.tps += r.tokensPerSec || 0;
    ex.count++;
    grouped.set(ms, ex);
  });

  const data = Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ms, v]) => ({
      name: formatBucketLabel(range, ms),
      requests: v.requests,
      errors: v.errors,
      tokens: v.tokens,
      cost: v.cost,
      duration: v.count > 0 ? v.duration / v.count : 0,
      ttft: v.count > 0 ? v.ttft / v.count : 0,
      tps: v.count > 0 ? v.tps / v.count : 0,
      successRate: v.requests > 0 ? ((v.requests - v.errors) / v.requests) * 100 : 0,
    }));

  return calcVelocity(data);
};

/**
 * Aggregate raw usage records into categorical groups (provider, model, apiKey, status).
 *
 * Unlike time-series aggregation, this produces one data point per unique group value.
 * Results are sorted by request count (descending) and capped at 10 groups to keep
 * pie charts and tables readable. Each group is assigned a deterministic color based
 * on a hash of its name string.
 *
 * @param records - Raw usage records from the API
 * @param groupBy - The categorical dimension to group by
 * @returns Array of aggregated data points, max 10, sorted by request count descending
 */
const aggregateByGroup = (records: UsageRecord[], groupBy: GroupBy): AggregatedPoint[] => {
  const grouped = new Map<
    string,
    {
      requests: number;
      errors: number;
      tokens: number;
      cost: number;
      duration: number;
      ttft: number;
      tps: number;
      count: number;
    }
  >();

  records.forEach((r) => {
    let key: string;
    switch (groupBy) {
      case 'provider':
        key = r.provider || 'unknown';
        break;
      case 'model':
        key = r.incomingModelAlias || r.selectedModelName || 'unknown';
        break;
      case 'apiKey':
        key = r.apiKey ? `${r.apiKey.slice(0, 8)}...` : 'unknown';
        break;
      case 'status':
        key = r.responseStatus || 'unknown';
        break;
      default:
        key = 'unknown';
    }

    const ex = grouped.get(key) || {
      requests: 0,
      errors: 0,
      tokens: 0,
      cost: 0,
      duration: 0,
      ttft: 0,
      tps: 0,
      count: 0,
    };
    ex.requests++;
    if (r.responseStatus !== 'success') ex.errors++;
    ex.tokens +=
      (r.tokensInput || 0) +
      (r.tokensOutput || 0) +
      (r.tokensReasoning || 0) +
      (r.tokensCached || 0);
    ex.cost += r.costTotal || 0;
    ex.duration += r.durationMs || 0;
    ex.ttft += r.ttftMs || 0;
    ex.tps += r.tokensPerSec || 0;
    ex.count++;
    grouped.set(key, ex);
  });

  return Array.from(grouped.entries())
    .map(([name, v]) => ({
      name,
      requests: v.requests,
      errors: v.errors,
      tokens: v.tokens,
      cost: v.cost,
      duration: v.count > 0 ? v.duration / v.count : 0,
      ttft: v.count > 0 ? v.ttft / v.count : 0,
      tps: v.count > 0 ? v.tps / v.count : 0,
      successRate: v.requests > 0 ? ((v.requests - v.errors) / v.requests) * 100 : 0,
      fill: COLORS[
        Math.abs(name.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % COLORS.length
      ],
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);
};

/**
 * Render a time-series chart (area, line, bar, or composed) using Recharts.
 *
 * Chart type behavior:
 * - **area**: Each selected metric is rendered as a filled Area with 30% opacity.
 * - **line**: Each metric is rendered as a Line with dot markers at each data point.
 * - **bar**: Each metric is rendered as a Bar with rounded top corners.
 * - **composed**: A mixed chart where the first 2 selected metrics render as Bars
 *   and remaining metrics render as Lines overlaid on top. This is useful for
 *   showing volume (bars) alongside rate metrics (lines) simultaneously.
 *
 * All chart types use dual Y-axes: 'left' for count-based metrics (requests, errors)
 * and 'right' for rate/cost/duration metrics (tokens, cost, duration, ttft, tps).
 *
 * @param data            - Aggregated time-series data points
 * @param chartType       - Which chart visualization to render
 * @param selectedMetrics - Array of metric keys currently toggled on
 * @returns JSX element containing the Recharts ResponsiveContainer and chart
 */
const renderTimeSeriesChart = (
  data: AggregatedPoint[],
  chartType: ChartType,
  selectedMetrics: string[]
) => {
  // Select the appropriate Recharts container component based on chart type.
  // ComposedChart is special: it can contain both Bar and Line children.
  const ChartComponent =
    chartType === 'composed'
      ? ComposedChart
      : chartType === 'bar'
        ? BarChart
        : chartType === 'line'
          ? LineChart
          : AreaChart;
  const isComposed = chartType === 'composed';
  // In composed mode, the first 2 metrics are rendered as bars, the rest as lines.
  const barMetrics = selectedMetrics.slice(0, 2);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ChartComponent data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
        <XAxis
          dataKey="name"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
        />
        <YAxis
          yAxisId="left"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="var(--color-text-secondary)"
          tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
          labelStyle={{ color: 'var(--color-text)' }}
        />
        <Legend />
        {selectedMetrics.map((metricKey) => {
          const metric = METRICS.find((m) => m.key === metricKey);
          if (!metric) return null;
          const isBar = isComposed ? barMetrics.includes(metricKey) : chartType === 'bar';
          const yAxisId = metric.yAxisId || 'left';

          if (isComposed && isBar) {
            return (
              <Bar
                key={metricKey}
                yAxisId={yAxisId}
                dataKey={metricKey}
                name={metric.label}
                fill={metric.color}
                radius={[4, 4, 0, 0]}
              />
            );
          }
          if (isComposed && !isBar) {
            return (
              <Line
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={2}
                dot={false}
              />
            );
          }
          if (chartType === 'area') {
            return (
              <Area
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                fill={metric.color}
                fillOpacity={0.3}
              />
            );
          }
          if (chartType === 'line') {
            return (
              <Line
                key={metricKey}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={metricKey}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            );
          }
          return (
            <Bar
              key={metricKey}
              yAxisId={yAxisId}
              dataKey={metricKey}
              name={metric.label}
              fill={metric.color}
              radius={[4, 4, 0, 0]}
            />
          );
        })}
      </ChartComponent>
    </ResponsiveContainer>
  );
};

/**
 * Render a pie chart for categorical data (groupBy != 'time').
 *
 * Only the first selected metric is used for the pie slices (since a pie chart
 * can only represent one dimension). Zero-value entries are filtered out to
 * avoid rendering invisible slices. Each slice color is taken from the
 * `fill` property set during categorical aggregation, or falls back to the
 * COLORS palette by index.
 *
 * Labels show the group name and percentage (e.g., "openai: 45%").
 *
 * @param data      - Categorically aggregated data points
 * @param metricKey - Which metric to use for slice values (e.g., 'requests')
 * @returns JSX element containing the Recharts PieChart
 */
const renderPieChart = (data: AggregatedPoint[], metricKey: string) => {
  const pieData = data
    .map((item, index) => ({
      name: item.name,
      value: (item[metricKey as keyof AggregatedPoint] as number) || 0,
      fill: item.fill || COLORS[index % COLORS.length],
    }))
    .filter((item) => item.value > 0);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
          outerRadius={120}
          dataKey="value"
        >
          {pieData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

/**
 * DetailedUsage -- the main analytics drill-down component.
 *
 * Can operate in two modes (see DetailedUsageProps for details):
 * - Standalone page: reads query params from the URL, full page chrome
 * - Embedded in modal: receives query params via props, minimal chrome
 *
 * @see AnalyzeButton - the entry point that builds the query string and triggers navigation
 */
export const DetailedUsage: React.FC<DetailedUsageProps> = ({
  embedded = false,
  initialQueryString,
  onBack,
}) => {
  // ---------------------------------------------------------------------------
  // Query string resolution: prefer initialQueryString prop (embedded mode),
  // fall back to window.location.search (standalone mode).
  // ---------------------------------------------------------------------------
  const resolvedQuery = useMemo(() => {
    if (typeof initialQueryString === 'string') {
      return initialQueryString;
    }
    if (typeof window !== 'undefined') {
      return window.location.search.replace(/^\?/, '');
    }
    return '';
  }, [initialQueryString]);

  /** Parse the resolved query string into validated preset values. */
  const preset = useMemo(() => parsePresetFromQuery(resolvedQuery), [resolvedQuery]);

  // ---------------------------------------------------------------------------
  // Component state -- initialized from the parsed query string presets.
  // Users can change these via the Chart Configuration controls; the chart
  // and data fetching react to state changes automatically.
  // ---------------------------------------------------------------------------

  /** Raw usage records fetched from the API. */
  const [records, setRecords] = useState<UsageRecord[]>([]);
  /** Whether a data fetch is currently in progress (shows loading spinner on Refresh button). */
  const [loading, setLoading] = useState(false);
  /** Selected time window -- controls how far back data is fetched and bucket granularity. */
  const [timeRange, setTimeRange] = useState<TimeRange>(preset.timeRange);
  /** Selected chart visualization type. */
  const [chartType, setChartType] = useState<ChartType>(preset.chartType);
  /** Selected grouping dimension. Changing this switches between time-series and categorical views. */
  const [groupBy, setGroupBy] = useState<GroupBy>(preset.groupBy);
  /** Toggle between chart visualization and raw request log table. */
  const [viewMode, setViewMode] = useState<ViewMode>(preset.viewMode);
  /** Which metrics are currently toggled on and rendered in the chart. */
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(preset.selectedMetrics);
  /** Timestamp of the last successful data fetch, shown in the "Live Data" badge. */
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  /**
   * Sync component state whenever the preset changes (e.g., when the parent
   * component passes a new initialQueryString to reconfigure the view).
   * This ensures the UI controls reflect the new preset values.
   */
  useEffect(() => {
    setTimeRange(preset.timeRange);
    setChartType(preset.chartType);
    setGroupBy(preset.groupBy);
    setViewMode(preset.viewMode);
    setSelectedMetrics(preset.selectedMetrics);
  }, [preset]);

  /**
   * Fetch usage data from the API for the currently selected time range.
   *
   * Calculates the start date by subtracting the range's minute count from now,
   * then requests up to 5000 log records starting from that date. The callback
   * is memoized on `timeRange` so it re-creates when the user changes the
   * time window, which also resets the auto-refresh interval (see below).
   */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { minutes } = getRangeConfig(timeRange);
      const startDate = new Date(Date.now() - minutes * 60000);

      const logsResponse = await api.getLogs(5000, 0, { startDate: startDate.toISOString() });

      setRecords(logsResponse.data || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to load usage data', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  /**
   * Auto-refresh mechanism: fetch data immediately on mount and whenever
   * loadData changes (i.e., when timeRange changes), then set up a 30-second
   * polling interval for live data updates. The interval is cleaned up on
   * unmount or when loadData changes to prevent stale timers.
   */
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  /**
   * Derived aggregated data: re-computed whenever raw records, groupBy dimension,
   * or timeRange changes. Routes to time-series aggregation (buckets) when
   * groupBy='time', or categorical aggregation (provider/model/status groups) otherwise.
   */
  const aggregatedData = useMemo(() => {
    if (groupBy === 'time') return aggregateByTime(records, timeRange);
    return aggregateByGroup(records, groupBy);
  }, [records, groupBy, timeRange]);

  /**
   * Summary statistics computed from all raw records in the current time window.
   * These are displayed as KPI cards at the top of the page, providing an
   * at-a-glance overview: total requests, errors, tokens, cost, and averages
   * for duration, TTFT (time to first token), TPS (tokens per second), and success rate.
   */
  const stats = useMemo(() => {
    const total = records.length;
    const errors = records.filter((r) => r.responseStatus !== 'success').length;
    const tokens = records.reduce(
      (acc, r) =>
        acc +
        (r.tokensInput || 0) +
        (r.tokensOutput || 0) +
        (r.tokensReasoning || 0) +
        (r.tokensCached || 0),
      0
    );
    const cost = records.reduce((acc, r) => acc + (r.costTotal || 0), 0);
    const avgDuration =
      total > 0 ? records.reduce((acc, r) => acc + (r.durationMs || 0), 0) / total : 0;
    const avgTtft = total > 0 ? records.reduce((acc, r) => acc + (r.ttftMs || 0), 0) / total : 0;
    const avgTps =
      total > 0 ? records.reduce((acc, r) => acc + (r.tokensPerSec || 0), 0) / total : 0;
    const successRate = total > 0 ? ((total - errors) / total) * 100 : 0;

    return [
      { label: 'Requests', value: formatNumber(total, 0), icon: Activity },
      {
        label: 'Errors',
        value: formatNumber(errors, 0),
        icon: AlertTriangle,
        color: errors > 0 ? 'text-red-500' : '',
      },
      { label: 'Tokens', value: formatTokens(tokens), icon: Database },
      { label: 'Cost', value: formatCost(cost, 4), icon: DollarSign },
      { label: 'Avg Duration', value: formatMs(avgDuration), icon: Clock },
      { label: 'Avg TTFT', value: formatMs(avgTtft), icon: Clock },
      { label: 'Avg TPS', value: formatNumber(avgTps, 1), icon: TrendingUp },
      { label: 'Success Rate', value: `${successRate.toFixed(1)}%`, icon: TrendingUp },
    ];
  }, [records]);

  /** Toggle a metric on or off in the chart. Removes it if already selected, adds it otherwise. */
  const toggleMetric = (key: string) =>
    setSelectedMetrics((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div
      className={
        embedded
          ? 'h-full p-2 bg-bg-card'
          : 'min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface'
      }
    >
      {/* -------------------------------------------------------------------
          Page Header Section
          - Title and subtitle
          - Back button: in embedded mode calls onBack(); in standalone mode
            navigates to /ui/live-metrics. Hidden when embedded=true and no
            onBack callback is provided.
          - "Live Data" badge showing time since last auto-refresh
      ------------------------------------------------------------------- */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Detailed Usage</h1>
            <p className="text-text-secondary">Advanced analytics with customizable chart types</p>
          </div>
          <div className="flex items-center gap-3">
            {(onBack || !embedded) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => (onBack ? onBack() : (window.location.href = '/ui/live-metrics'))}
              >
                <ArrowLeft size={16} className="mr-1" />
                {onBack ? 'Back to Live Card' : 'Return to Live Metrics'}
              </Button>
            )}
            <Badge
              status="connected"
              secondaryText={`Last updated: ${formatTimeAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))}`}
            >
              Live Data
            </Badge>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------------
          KPI Summary Cards Section
          A responsive grid of 8 summary statistics computed from all records
          in the current time window. Each card shows a label, value, and icon.
          Errors are highlighted in red when count > 0.
      ------------------------------------------------------------------- */}
      <div
        className="mb-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '12px',
        }}
      >
        {stats.map((stat, i) => (
          <div key={i} className="glass-bg rounded-lg p-3 flex flex-col gap-1">
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
                {stat.label}
              </span>
              <stat.icon size={16} className={`text-text-secondary ${stat.color || ''}`} />
            </div>
            <div className={`font-heading text-xl font-bold ${stat.color || 'text-text'}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* -------------------------------------------------------------------
          Chart Configuration Panel
          Contains all user-adjustable controls organized in horizontal groups:
          1. Time Range selector: live (5m), hour, day, week, month
          2. Group By selector: time, provider, model, status
          3. Chart Type picker: area, line, bar, mixed (composed), pie
             -- Non-pie types are disabled when groupBy is not 'time'
          4. View Mode toggle: chart vs. list (raw request log table)
          5. Metric toggles: show/hide individual metrics on the chart
             -- Only visible when groupBy='time' (categorical views use pie)
      ------------------------------------------------------------------- */}
      <Card className="mb-6" title="Chart Configuration">
        <div className="flex flex-wrap gap-4">
          {/* --- Time Range Selector --- */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Time Range</span>
            <div className="flex gap-2">
              {(['live', 'hour', 'day', 'week', 'month'] as TimeRange[]).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={timeRange === r ? 'primary' : 'secondary'}
                  onClick={() => setTimeRange(r)}
                >
                  {r === 'live' ? '5m' : r.charAt(0).toUpperCase() + r.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* --- Group By Selector --- */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Group By</span>
            <div className="flex gap-2">
              {[
                { k: 'time', l: 'Time' },
                { k: 'provider', l: 'Provider' },
                { k: 'model', l: 'Model' },
                { k: 'status', l: 'Status' },
              ].map((o) => (
                <Button
                  key={o.k}
                  size="sm"
                  variant={groupBy === o.k ? 'primary' : 'secondary'}
                  onClick={() => setGroupBy(o.k as GroupBy)}
                >
                  {o.l}
                </Button>
              ))}
            </div>
          </div>

          {/* --- Chart Type Picker --- */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">Chart Type</span>
            <div className="flex gap-2">
              {[
                { k: 'area', i: LineChartIcon, l: 'Area' },
                { k: 'line', i: LineChartIcon, l: 'Line' },
                { k: 'bar', i: BarChart3, l: 'Bar' },
                { k: 'composed', i: BarChart3, l: 'Mixed' },
                { k: 'pie', i: PieChartIcon, l: 'Pie' },
              ].map((t) => (
                <Button
                  key={t.k}
                  size="sm"
                  variant={chartType === t.k ? 'primary' : 'secondary'}
                  onClick={() => setChartType(t.k as ChartType)}
                  disabled={groupBy !== 'time' && t.k !== 'pie'}
                >
                  <t.i size={14} className="mr-1" />
                  {t.l}
                </Button>
              ))}
            </div>
          </div>

          {/* --- View Mode Toggle (Chart vs List) --- */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase">View</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={viewMode === 'chart' ? 'primary' : 'secondary'}
                onClick={() => setViewMode('chart')}
              >
                <LineChartIcon size={14} className="mr-1" />
                Chart
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                onClick={() => setViewMode('list')}
              >
                <List size={14} className="mr-1" />
                List
              </Button>
            </div>
          </div>

          {/* --- Metric Toggles (only shown for time-series grouping) ---
              Each metric can be individually toggled on/off. Active metrics
              are rendered as separate series in the chart. */}
          {groupBy === 'time' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-muted uppercase">Metrics</span>
              <div className="flex gap-2 flex-wrap">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => toggleMetric(m.key)}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${selectedMetrics.includes(m.key) ? 'bg-primary text-white' : 'bg-bg-hover text-text-secondary'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* -------------------------------------------------------------------
          Main Content Area: Chart View or List View
          - Chart view: renders the selected chart type (area, line, bar,
            composed, or pie) based on aggregatedData. Pie charts are used
            for categorical grouping; time-series charts for groupBy='time'.
          - List view: renders a scrollable table of the most recent 100
            raw request records with per-request details.
      ------------------------------------------------------------------- */}
      {viewMode === 'chart' ? (
        <Card
          title={`Usage by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`}
          extra={
            <Button size="sm" variant="secondary" onClick={loadData} isLoading={loading}>
              Refresh
            </Button>
          }
        >
          {aggregatedData.length === 0 ? (
            <div className="h-96 flex items-center justify-center text-text-secondary">
              No data available
            </div>
          ) : chartType === 'pie' ? (
            renderPieChart(aggregatedData, selectedMetrics[0] || 'requests')
          ) : (
            renderTimeSeriesChart(aggregatedData, chartType, selectedMetrics)
          )}
        </Card>
      ) : (
        <Card
          title="Raw Request Log"
          extra={<span className="text-xs text-text-secondary">{records.length} requests</span>}
        >
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="text-left border-b border-border-glass text-text-secondary">
                  {[
                    'Time',
                    'Provider',
                    'Model',
                    'Status',
                    'Tokens',
                    'Cost',
                    'Duration',
                    'TTFT',
                    'TPS',
                  ].map((h) => (
                    <th key={h} className="py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-border-glass/50">
                    <td className="py-2 pr-3 text-xs">{new Date(r.date).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3">{r.provider || 'unknown'}</td>
                    <td className="py-2 pr-3 text-xs">
                      {r.incomingModelAlias || r.selectedModelName || 'unknown'}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-xs ${r.responseStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {r.responseStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {formatTokens((r.tokensInput || 0) + (r.tokensOutput || 0))}
                    </td>
                    <td className="py-2 pr-3">{formatCost(r.costTotal || 0, 4)}</td>
                    <td className="py-2 pr-3">{formatMs(r.durationMs || 0)}</td>
                    <td className="py-2 pr-3">{formatMs(r.ttftMs || 0)}</td>
                    <td className="py-2 pr-3">{formatNumber(r.tokensPerSec || 0, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* -------------------------------------------------------------------
          Detailed Breakdown Table (categorical grouping only)
          Shown below the chart when groupBy is provider, model, apiKey, or status.
          Displays a tabular view of the aggregated data with all metric columns
          for precise numeric comparison across groups.
      ------------------------------------------------------------------- */}
      {groupBy !== 'time' && aggregatedData.length > 0 && (
        <Card className="mt-6" title="Detailed Breakdown">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border-glass text-text-secondary">
                  <th className="py-3 pr-4">
                    {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                  </th>
                  {[
                    'Requests',
                    'Errors',
                    'Success %',
                    'Tokens',
                    'Cost',
                    'Avg Duration',
                    'Avg TTFT',
                    'Avg TPS',
                  ].map((h) => (
                    <th key={h} className="py-3 pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aggregatedData.map((row, i) => (
                  <tr key={i} className="border-b border-border-glass/50">
                    <td className="py-3 pr-4 font-medium">{row.name}</td>
                    <td className="py-3 pr-4">{formatNumber(row.requests, 0)}</td>
                    <td className="py-3 pr-4 text-red-500">{formatNumber(row.errors, 0)}</td>
                    <td className="py-3 pr-4 text-green-500">{row.successRate.toFixed(1)}%</td>
                    <td className="py-3 pr-4">{formatTokens(row.tokens)}</td>
                    <td className="py-3 pr-4">{formatCost(row.cost, 6)}</td>
                    <td className="py-3 pr-4">{formatMs(row.duration)}</td>
                    <td className="py-3 pr-4">{formatMs(row.ttft)}</td>
                    <td className="py-3 pr-4">{formatNumber(row.tps, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
