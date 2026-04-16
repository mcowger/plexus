/**
 * @fileoverview UsageTab -- Usage Analytics dashboard tab with concurrency visualization.
 *
 * This tab renders a responsive grid of analytics cards covering:
 *   - Request and token time-series charts (pre-existing)
 *   - Pie chart breakdowns by model, provider, and API key (pre-existing)
 *   - **Concurrency charts** (added in this PR): stacked area chart by provider
 *     and stacked bar chart by model, showing how many concurrent requests were
 *     in-flight at each sampled timestamp.
 *
 * All data is fetched once when the component mounts or when the user changes the
 * selected `timeRange`. There is no periodic polling -- the fetch fires inside a
 * `useEffect` whose sole dependency is `timeRange`.
 */

import { useEffect, useMemo, useState } from 'react';
/**
 * `ConcurrencyData` is imported as a **type-only** import from the API layer.
 * Its shape is:
 * ```ts
 * interface ConcurrencyData {
 *   provider: string;   // e.g. "openai", "anthropic"
 *   model: string;      // e.g. "gpt-4o", "claude-opus-4-20250514"
 *   count: number;      // number of concurrent requests at this sample point
 *   timestamp: number;  // Unix-epoch millisecond timestamp of the sample
 * }
 * ```
 * Each record represents a single (provider, model, timestamp) data point returned
 * from the `GET /v0/management/concurrency?timeRange=...` endpoint.
 */
import { api, UsageData, PieChartDataPoint, type ConcurrencyData } from '../../../lib/api';
import { formatNumber, formatTokens } from '../../../lib/format';
import { Card } from '../../ui/Card';
import { TotalEnergyComparison } from '../../TotalEnergyComparison';
import { TimeRangeSelector } from '../TimeRangeSelector';
import type { CustomDateRange } from '../../../lib/date';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

/** Supported time windows for usage and concurrency queries. */
type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'custom';

/**
 * Props accepted by the {@link UsageTab} component.
 *
 * @property timeRange        - The currently selected time window. Drives all
 *                              data-fetching calls (usage **and** concurrency).
 * @property onTimeRangeChange - Callback invoked when the user selects a
 *                              different time range from the `TimeRangeSelector`.
 * @property customDateRange  - Optional custom date range when timeRange is 'custom'
 * @property onCustomDateRangeChange - Callback when custom date range changes
 */
interface UsageTabProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  customDateRange?: CustomDateRange | null;
  onCustomDateRangeChange?: (range: CustomDateRange | null) => void;
}

/**
 * UsageTab renders the full Usage Analytics page, including all usage charts and
 * the concurrency visualization cards added in this PR.
 *
 * **Data lifecycle:**
 * 1. On mount (and whenever `timeRange` changes), a single `useEffect` fires five
 *    parallel API calls -- four pre-existing usage endpoints plus the new
 *    `getConcurrencyData` endpoint.
 * 2. Raw `ConcurrencyData[]` records are then reshaped by three `useMemo` hooks
 *    (`providerKeys`, `modelKeys`, and the two timeline builders) into the
 *    chart-ready data structures consumed by Recharts.
 * 3. Two new `<Card>` elements ("Concurrency by Provider" and "Concurrency by
 *    Model") are inserted into the existing responsive grid layout between the
 *    "Requests over Time" card and the "Token Usage" card.
 */
export const UsageTab: React.FC<UsageTabProps> = ({
  timeRange,
  onTimeRangeChange,
  customDateRange,
  onCustomDateRangeChange: _onCustomDateRangeChange,
}) => {
  // ---------------------------------------------------------------------------
  // State -- pre-existing usage data
  // ---------------------------------------------------------------------------
  const [data, setData] = useState<UsageData[]>([]);
  const [modelData, setModelData] = useState<PieChartDataPoint[]>([]);
  const [providerData, setProviderData] = useState<PieChartDataPoint[]>([]);
  const [keyData, setKeyData] = useState<PieChartDataPoint[]>([]);

  // ---------------------------------------------------------------------------
  // State -- concurrency data (new in this PR)
  // ---------------------------------------------------------------------------
  /**
   * Raw concurrency records fetched from the management API.
   * Separate arrays for provider and model groupings to avoid Cartesian explosion.
   * Each record is a (provider, count, timestamp) or (model, count, timestamp) tuple.
   */
  const [concurrencyByProvider, setConcurrencyByProvider] = useState<ConcurrencyData[]>([]);
  const [concurrencyByModel, setConcurrencyByModel] = useState<ConcurrencyData[]>([]);
  const [energySummary, setEnergySummary] = useState<{
    totalKwhUsed: number;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  /**
   * Fetches all dashboard data whenever the selected time range changes.
   *
   * All five calls fire in parallel (no `await` chaining) so the network
   * requests overlap. Each `.then()` independently updates its own state slice,
   * meaning cards render progressively as responses arrive rather than waiting
   * for the slowest endpoint.
   *
   * **Concurrency fetch (`getConcurrencyData`):** hits the
   * `GET /v0/management/concurrency?timeRange=<range>` endpoint and returns an
   * array of `ConcurrencyData` records. On failure the API helper returns `[]`,
   * so the concurrency cards gracefully show "No concurrency data available".
   *
   * There is **no polling interval** -- data is fetched once per `timeRange`
   * change. If real-time updates are needed in the future, a polling or
   * WebSocket strategy should be added here.
   */
  useEffect(() => {
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (timeRange === 'custom' && customDateRange) {
      startDate = customDateRange.start.toISOString();
      endDate = customDateRange.end.toISOString();
    } else {
      // Calculate date range for non-custom time ranges
      const now = new Date();
      const rangeStart = new Date(now);

      switch (timeRange) {
        case 'hour':
          rangeStart.setHours(rangeStart.getHours() - 1);
          break;
        case 'day':
          rangeStart.setHours(rangeStart.getHours() - 24);
          break;
        case 'week':
          rangeStart.setDate(rangeStart.getDate() - 7);
          break;
        case 'month':
          rangeStart.setDate(rangeStart.getDate() - 30);
          break;
      }

      startDate = rangeStart.toISOString();
      endDate = now.toISOString();
    }

    // Use summary endpoint for time-series data (much more efficient)
    api.getSummaryData(timeRange, true, startDate, endDate).then(setData);
    api.getUsageByModel(timeRange, true, startDate, endDate).then(setModelData);
    api.getUsageByProvider(timeRange, true, startDate, endDate).then(setProviderData);
    api.getUsageByKey(timeRange, true, startDate, endDate).then(setKeyData);
    // Make two separate calls for provider and model concurrency data
    api
      .getConcurrencyData(timeRange, 'timeline', 'provider', startDate, endDate)
      .then(setConcurrencyByProvider);
    api
      .getConcurrencyData(timeRange, 'timeline', 'model', startDate, endDate)
      .then(setConcurrencyByModel);
    api
      .getEnergySummary(timeRange, true, startDate, endDate)
      .then((summary) => setEnergySummary(summary));
  }, [timeRange, customDateRange]);

  // ---------------------------------------------------------------------------
  // Shared chart palette
  // ---------------------------------------------------------------------------
  /**
   * Ordered color palette shared across all pie charts and the concurrency
   * stacked charts. Colors cycle via `COLORS[index % COLORS.length]` so the
   * palette gracefully wraps when there are more series than colors.
   */
  const COLORS = [
    '#8b5cf6',
    '#06b6d4',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#6366f1',
    '#ec4899',
    '#f97316',
  ];

  // ---------------------------------------------------------------------------
  // Concurrency data derivations (new in this PR)
  // ---------------------------------------------------------------------------

  /**
   * Unique provider names extracted from the raw concurrency data.
   *
   * Used as the set of data-key series for the "Concurrency by Provider"
   * stacked area chart. The order of the returned array determines the
   * stacking order (bottom to top) in the chart.
   *
   * Records with a falsy `provider` field are bucketed under `'unknown'`.
   */
  const providerKeys = useMemo(() => {
    const providers = new Set<string>();
    for (const item of concurrencyByProvider) {
      providers.add(item.provider || 'unknown');
    }
    return Array.from(providers);
  }, [concurrencyByProvider]);

  /**
   * Top-8 model names ranked by total concurrent-request count across all
   * timestamps.
   *
   * The "Concurrency by Model" bar chart is limited to eight series to keep
   * the legend readable and the color palette distinct. Models outside the
   * top 8 are **excluded** from the chart entirely (they are not rolled up
   * into an "Other" bucket -- a future enhancement could add that).
   *
   * Sorting is descending by aggregate `count` so the highest-traffic models
   * appear first in the legend and dominate the bottom of the stacked bars.
   */
  const modelKeys = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of concurrencyByModel) {
      const model = item.model || 'unknown';
      totals.set(model, (totals.get(model) || 0) + item.count);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([model]) => model);
  }, [concurrencyByModel]);

  /**
   * Pivots flat `ConcurrencyData[]` into a timeline array suitable for
   * Recharts' `<AreaChart>`, grouped by **provider**.
   *
   * Each element in the returned array represents a single timestamp and looks
   * like:
   * ```ts
   * {
   *   timestamp: 1700000000000,       // raw epoch ms (used for sorting)
   *   label: "14:30",                 // human-readable x-axis tick label
   *   openai: 12,                     // concurrent requests for this provider
   *   anthropic: 7,                   // ...etc
   * }
   * ```
   *
   * Multiple raw records that share the same `timestamp` **and** `provider`
   * are summed together (the `+= item.count` accumulation). This handles the
   * case where the backend returns per-model granularity but the chart only
   * cares about the provider dimension.
   *
   * The resulting array is sorted chronologically so the area chart renders
   * left-to-right in time order.
   */
  const concurrencyByProviderTimeline = useMemo(() => {
    if (!concurrencyByProvider.length) return [] as Array<Record<string, number | string>>;

    const grouped = new Map<number, Record<string, number | string>>();
    for (const item of concurrencyByProvider) {
      const ts = item.timestamp;
      const provider = item.provider || 'unknown';
      if (!grouped.has(ts)) {
        grouped.set(ts, {
          timestamp: ts,
          label: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }
      const entry = grouped.get(ts)!;
      entry[provider] = ((entry[provider] as number) || 0) + item.count;
    }

    return Array.from(grouped.values()).sort(
      (a, b) => (a.timestamp as number) - (b.timestamp as number)
    );
  }, [concurrencyByProvider]);

  /**
   * Pivots flat `ConcurrencyData[]` into a timeline array suitable for
   * Recharts' `<BarChart>`, grouped by **model** (top 8 only).
   *
   * This is structurally identical to {@link concurrencyByProviderTimeline}
   * except:
   *   - The grouping key is `item.model` instead of `item.provider`.
   *   - Records whose model is **not** in the top-8 `modelKeys` set are
   *     skipped entirely (`if (!allowedModels.has(model)) continue`).
   *   - The dependency array includes `modelKeys` so that the memo
   *     recomputes whenever the top-8 ranking changes.
   *
   * The output shape per element is:
   * ```ts
   * { timestamp: number; label: string; [modelName: string]: number }
   * ```
   */
  const concurrencyByModelTimeline = useMemo(() => {
    if (!concurrencyByModel.length || !modelKeys.length)
      return [] as Array<Record<string, number | string>>;

    const allowedModels = new Set(modelKeys);
    const grouped = new Map<number, Record<string, number | string>>();
    for (const item of concurrencyByModel) {
      const model = item.model || 'unknown';
      if (!allowedModels.has(model)) continue;
      const ts = item.timestamp;

      if (!grouped.has(ts)) {
        grouped.set(ts, {
          timestamp: ts,
          label: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }
      const entry = grouped.get(ts)!;
      entry[model] = ((entry[model] as number) || 0) + item.count;
    }

    return Array.from(grouped.values()).sort(
      (a, b) => (a.timestamp as number) - (b.timestamp as number)
    );
  }, [concurrencyByModel, modelKeys]);

  // ---------------------------------------------------------------------------
  // Pie chart helper (pre-existing)
  // ---------------------------------------------------------------------------

  /**
   * Renders a reusable `<PieChart>` with a custom dark-themed tooltip and a
   * percentage-annotated legend.
   *
   * @param dataKey - Which numeric field from `PieChartDataPoint` to visualize
   *                  (`'requests'` or `'tokens'`).
   * @param data    - Array of pie slices, each with a `name` and numeric values.
   */
  const renderPieChart = (dataKey: 'requests' | 'tokens', data: PieChartDataPoint[]) => {
    const CustomTooltip = ({ active, payload }: any) => {
      if (active && payload && payload.length) {
        const value = payload[0].value;
        const label = payload[0].name;
        const formattedValue = dataKey === 'requests' ? formatNumber(value) : formatTokens(value);
        return (
          <div
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              padding: '8px 12px',
              borderRadius: '4px',
              border: '1px solid var(--color-border)',
            }}
          >
            <p style={{ margin: 0, color: '#ffffff', fontSize: '14px' }}>
              <strong>{label}</strong>
            </p>
            <p style={{ margin: '4px 0 0 0', color: '#ffffff', fontSize: '13px' }}>
              {dataKey === 'requests' ? 'Requests' : 'Tokens'}: {formattedValue}
            </p>
          </div>
        );
      }
      return null;
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="30%"
            labelLine={false}
            outerRadius={50}
            fill="#8884d8"
            dataKey={dataKey}
            nameKey="name"
          >
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            align="left"
            height={36}
            formatter={(value) => {
              const item = data.find((d) => d.name === value);
              if (!item) return value;
              const itemValue = item[dataKey as keyof PieChartDataPoint] as number;
              const total = data.reduce(
                (sum, d) => sum + (d[dataKey as keyof PieChartDataPoint] as number),
                0
              );
              const percent = total > 0 ? ((itemValue / total) * 100).toFixed(0) : 0;
              return `${value} (${percent}%)`;
            }}
          />
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="p-6 transition-all duration-300">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Usage Analytics</h1>
        <p className="text-[15px] text-text-secondary m-0">
          Token usage and request statistics over time.
        </p>
      </div>

      <div className="mb-4">
        <TimeRangeSelector value={timeRange} onChange={(r) => onTimeRangeChange(r as TimeRange)} />
      </div>

      {/* All Charts in 4-Column Grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))' }}
      >
        {/* Time Series - Requests */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Requests over Time">
          <div style={{ height: 300, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                  formatter={(value) => formatNumber(value as number)}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="var(--color-primary)"
                  fill="var(--color-glow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ------------------------------------------------------------------ */}
        {/* Concurrency Cards (new in this PR)                                 */}
        {/*                                                                    */}
        {/* These two cards are placed immediately after "Requests over Time"   */}
        {/* so that concurrency metrics sit next to the request volume chart,   */}
        {/* giving operators a side-by-side view of "how many requests" vs.     */}
        {/* "how many were in-flight simultaneously".                           */}
        {/*                                                                    */}
        {/* Both cards share the same empty-state pattern: when the timeline    */}
        {/* array is empty (API returned no data or errored), a centered        */}
        {/* placeholder message is shown instead of an empty chart.             */}
        {/* ------------------------------------------------------------------ */}

        {/*
         * Concurrency by Provider -- Stacked Area Chart
         *
         * Visualizes concurrent in-flight requests over time, broken down by
         * LLM provider (e.g. "openai", "anthropic"). Each provider gets its
         * own colored area, and all areas share `stackId="providers"` so they
         * stack on top of each other, making the total height at any x-tick
         * equal to the aggregate concurrency across all providers.
         *
         * The x-axis uses the pre-formatted `label` field ("HH:MM") rather
         * than raw timestamps to keep tick labels compact.
         */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Concurrency by Provider">
          <div style={{ height: 300, marginTop: '12px' }}>
            {concurrencyByProviderTimeline.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                No concurrency data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={concurrencyByProviderTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis dataKey="label" stroke="var(--color-text-secondary)" />
                  <YAxis
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => formatNumber(Number(value || 0), 0)}
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  {providerKeys.map((provider, index) => (
                    <Area
                      key={provider}
                      type="monotone"
                      dataKey={provider}
                      stackId="providers"
                      stroke={COLORS[index % COLORS.length]}
                      fill={COLORS[index % COLORS.length]}
                      fillOpacity={0.45}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/*
         * Concurrency by Model -- Stacked Bar Chart
         *
         * Visualizes concurrent in-flight requests over time, broken down by
         * model name (limited to the top 8 by total request count -- see
         * `modelKeys`). A bar chart is used (instead of an area chart) to
         * make it easier to read discrete per-timestamp values when many
         * models are present.
         *
         * Bars share `stackId="models"` so they stack vertically, with the
         * highest-traffic model at the bottom of the stack (matching the
         * sort order from `modelKeys`).
         */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Concurrency by Model">
          <div style={{ height: 300, marginTop: '12px' }}>
            {concurrencyByModelTimeline.length === 0 ? (
              <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                No concurrency data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={concurrencyByModelTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                  <XAxis dataKey="label" stroke="var(--color-text-secondary)" />
                  <YAxis
                    stroke="var(--color-text-secondary)"
                    tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => formatNumber(Number(value || 0), 0)}
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  {modelKeys.map((model, index) => (
                    <Bar
                      key={model}
                      dataKey={model}
                      stackId="models"
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Time Series - Tokens */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Token Usage">
          <div style={{ height: 300, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatTokens} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                  formatter={(value) => formatTokens(value as number)}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  name="Total Tokens"
                  stroke="var(--color-primary)"
                  fill="var(--color-glow)"
                  fillOpacity={0.1}
                />
                <Area
                  type="monotone"
                  dataKey="inputTokens"
                  name="Input"
                  stroke="#82ca9d"
                  fill="#82ca9d"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="outputTokens"
                  name="Output"
                  stroke="#ffc658"
                  fill="#ffc658"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="cachedTokens"
                  name="Cached"
                  stroke="#ff7300"
                  fill="#ff7300"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="cacheWriteTokens"
                  name="Cache Write"
                  stroke="#a855f7"
                  fill="#a855f7"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Model Distribution - Requests */}
        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Usage by Model Alias (Requests)"
        >
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', modelData)}
          </div>
        </Card>

        {/* Model Distribution - Tokens */}
        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Usage by Model Alias (Tokens)"
        >
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('tokens', modelData)}
          </div>
        </Card>

        {/* Provider Distribution - Requests */}
        <Card
          className="min-w-0"
          style={{ minWidth: '350px' }}
          title="Usage by Provider (Requests)"
        >
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', providerData)}
          </div>
        </Card>

        {/* Provider Distribution - Tokens */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Usage by Provider (Tokens)">
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('tokens', providerData)}
          </div>
        </Card>

        {/* API Key Distribution - Requests */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Usage by API Key (Requests)">
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', keyData)}
          </div>
        </Card>

        {/* API Key Distribution - Tokens */}
        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Usage by API Key (Tokens)">
          <div style={{ height: 300, marginTop: '12px' }}>{renderPieChart('tokens', keyData)}</div>
        </Card>

        <Card className="min-w-0" style={{ minWidth: '350px' }} title="Energy Comparisons">
          <div style={{ marginTop: '12px', height: 300 }}>
            <TotalEnergyComparison totalKwh={energySummary?.totalKwhUsed} />
          </div>
        </Card>
      </div>
    </div>
  );
};
