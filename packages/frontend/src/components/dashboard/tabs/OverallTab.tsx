/**
 * @fileoverview OverallTab -- Dashboard overview for limited (api-key) users.
 *
 * This tab is only rendered for `isLimited` principals; admins have the full
 * Live / Usage / Performance tab set. It rolls the most useful per-key numbers
 * onto a single page so an api-key holder can answer "what am I allowed to use
 * and how much have I used?" without clicking between tabs.
 *
 * Data sources (all already force-scoped to the caller's key on the backend):
 *   - `getSelfMe`          → identity (key name, allowedProviders, allowedModels,
 *                             quota assignment, comment)
 *   - `getUsageSummary`    → aggregated totals and optional provider/model
 *                             breakdowns for the selected time range
 *   - `getSelfQuota`       → per-quota progress for the caller's key
 *                             (`quotas[]`, most-constrained rendered first)
 *
 * All calls fire in parallel inside a single `useEffect`. There is no polling;
 * a manual refresh is triggered by changing the time range.
 */

import { useEffect, useState } from 'react';
import { Key, Layers, Boxes, Gauge, Activity, AlertTriangle } from 'lucide-react';
import { api, type PieChartDataPoint, type QuotaStatusEntry } from '../../../lib/api';
import { formatNumber, formatTokens, formatCostIn } from '../../../lib/format';
import { useCurrency } from '../../../lib/CurrencyContext';
import { Card } from '../../ui/Card';
import { QuotaStatusCard } from '../../quota';
import { TimeRangeSelector } from '../TimeRangeSelector';
import { sortMostConstrainedFirst } from '../../../lib/quota';
import type { CustomDateRange } from '../../../lib/date';
import { Skeleton } from '../../ui/Skeleton';

type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'custom';

interface SelfInfo {
  role: 'admin' | 'limited';
  keyName?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  quotaNames?: string[];
  quotaName?: string | null;
  comment?: string | null;
}

interface SummaryStats {
  range: TimeRange;
  totalRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  todayCost: number;
}

/**
 * Small helper to render a labeled metric "tile". Used throughout the token
 * summary card so each value has a consistent, glanceable layout.
 */
const Metric: React.FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
    <span className="text-2xl font-semibold text-text leading-none">{value}</span>
    {sub && <span className="text-xs text-text-muted">{sub}</span>}
  </div>
);

/**
 * Simple two-column list used for the provider/model breakdown cards. We
 * deliberately avoid a chart here because the Usage Analytics tab already has
 * pie charts — this tab's job is to give a dense, table-like roll-up.
 */
const BreakdownList: React.FC<{
  data: PieChartDataPoint[];
  emptyLabel: string;
  metric: 'requests' | 'tokens';
}> = ({ data, emptyLabel, metric }) => {
  if (!data.length) {
    return <p className="text-sm text-text-muted">{emptyLabel}</p>;
  }
  const total = data.reduce((sum, d) => sum + ((d[metric] as number) || 0), 0);
  const sorted = [...data].sort(
    (a, b) => ((b[metric] as number) || 0) - ((a[metric] as number) || 0)
  );
  return (
    <div className="space-y-2">
      {sorted.map((row) => {
        const value = (row[metric] as number) || 0;
        const pct = total > 0 ? (value / total) * 100 : 0;
        const display = metric === 'tokens' ? formatTokens(value) : formatNumber(value, 0);
        return (
          <div key={row.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text font-medium truncate" title={row.name}>
                {row.name}
              </span>
              <span className="text-text-muted tabular-nums">
                {display}
                <span className="ml-2 text-xs text-text-muted">({pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="mt-1 h-1 w-full bg-bg-hover rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const OverallTab: React.FC = () => {
  const { currency, rate, symbol } = useCurrency();
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(null);
  const [info, setInfo] = useState<SelfInfo | null>(null);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [providerData, setProviderData] = useState<PieChartDataPoint[]>([]);
  const [modelData, setModelData] = useState<PieChartDataPoint[]>([]);
  const [quotas, setQuotas] = useState<QuotaStatusEntry[] | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (timeRange === 'custom') {
      if (!customDateRange) return;
      startDate = customDateRange.start.toISOString();
      endDate = customDateRange.end.toISOString();
    }

    setLoading(true);
    // Clear per-range data so switching time ranges doesn't render stale
    // totals/breakdowns under the new range's label while requests are
    // still in flight.
    setSummary(null);
    setProviderData([]);
    setModelData([]);
    setQuotaError(false);

    // Each call settles independently so a single slow endpoint doesn't block
    // the whole tab from rendering useful data.
    const metaPromise = api.getSelfMe().then((data) => {
      if (!cancelled) setInfo(data as SelfInfo);
    });

    const quotaPromise = api
      .getSelfQuota()
      .then((data) => {
        if (!cancelled) {
          setQuotas(data.quotas);
          setQuotaError(false);
        }
      })
      .catch(() => {
        // Distinguish fetch failure from "no quota assigned" so the card
        // doesn't tell a quota-gated user that they are unrestricted.
        if (!cancelled) {
          setQuotas(null);
          setQuotaError(true);
        }
      });

    // Token + request totals for the selected range. The backend endpoint is
    // auto-scoped to the calling limited user.
    const summaryPromise = api
      .getUsageSummary(timeRange, true, startDate, endDate, ['provider', 'modelAlias'], 10, [
        'directModels',
        'probe',
      ])
      .then((res) => {
        if (cancelled || !res) return;
        const stats = res.stats;
        setSummary({
          range: timeRange,
          totalRequests: stats.totalRequests,
          totalTokens: stats.totalTokens,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          reasoningTokens: stats.reasoningTokens,
          cachedTokens: stats.cachedTokens,
          cacheWriteTokens: stats.cacheWriteTokens,
          todayCost: res.today?.totalCost ?? 0,
        });
        setProviderData(
          (res.grouped?.provider?.items ?? []).map((item) => ({
            name: item.name,
            requests: item.requests,
            tokens: item.totalTokens,
          }))
        );
        setModelData(
          (res.grouped?.modelAlias?.items ?? [])
            .filter((item) => !item.name.startsWith('direct/'))
            .map((item) => ({
              name: item.name,
              requests: item.requests,
              tokens: item.totalTokens,
            }))
        );
      });

    Promise.allSettled([metaPromise, quotaPromise, summaryPromise]).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [timeRange, customDateRange]);

  const allowedProviders = info?.allowedProviders ?? [];
  const allowedModels = info?.allowedModels ?? [];

  return (
    <div className="p-6 transition-all duration-300 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Overall</h1>
          <p className="text-[15px] text-text-secondary m-0">
            Access, usage, and quota summary for your API key.
          </p>
        </div>
        <TimeRangeSelector
          value={timeRange}
          onChange={(r) => {
            if (r !== 'live') {
              setTimeRange(r);
              if (r !== 'custom') setCustomDateRange(null);
            }
          }}
          customRange={customDateRange}
          onCustomRangeChange={setCustomDateRange}
          options={['hour', 'day', 'week', 'month', 'custom']}
        />
      </header>

      {/* -------- Row 1: Identity + Quota ------------------------------- */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
      >
        <Card title="Key" extra={<Key size={16} className="text-text-muted" />} className="min-w-0">
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div className="flex">
              <dt className="w-32 text-text-muted">Name</dt>
              <dd className="font-mono text-text break-all">{info?.keyName || '—'}</dd>
            </div>
            <div className="flex">
              <dt className="w-32 text-text-muted">Quota</dt>
              <dd className="text-text">
                {info?.quotaNames && info.quotaNames.length > 0
                  ? info.quotaNames.join(', ')
                  : info?.quotaName || 'None assigned'}
              </dd>
            </div>
            {info?.comment && (
              <div className="flex">
                <dt className="w-32 text-text-muted">Comment</dt>
                <dd className="text-text">{info.comment}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card
          title="Quota"
          extra={<Gauge size={16} className="text-text-muted" />}
          className="min-w-0"
        >
          {loading && !quotas && !quotaError ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : quotaError ? (
            <div className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Could not load quota status. If this key has a quota assigned, its current usage is
                not shown here — try refreshing.
              </span>
            </div>
          ) : !quotas || quotas.length === 0 ? (
            <p className="text-sm text-text-muted">
              No quota is assigned to this key — requests are unrestricted by quota policy.
            </p>
          ) : (
            <div className="space-y-4">
              {sortMostConstrainedFirst(quotas).map((q) => (
                <QuotaStatusCard key={q.name} entry={q} resetsAtFormat="relative" />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* -------- Row 2: Access (providers / models) -------------------- */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
      >
        <Card
          title="Allowed providers"
          extra={<Layers size={16} className="text-text-muted" />}
          className="min-w-0"
        >
          {allowedProviders.length === 0 ? (
            <p className="text-sm text-text-muted">
              Any provider (unrestricted) — this key can route to every provider the gateway knows.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allowedProviders.map((p) => (
                <span
                  key={p}
                  className="px-2 py-1 text-xs font-mono rounded-md bg-bg-hover border border-border text-text"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Allowed models"
          extra={<Boxes size={16} className="text-text-muted" />}
          className="min-w-0"
        >
          {allowedModels.length === 0 ? (
            <p className="text-sm text-text-muted">
              Any model (unrestricted) — this key can request every model alias configured on the
              gateway.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allowedModels.map((m) => (
                <span
                  key={m}
                  className="px-2 py-1 text-xs font-mono rounded-md bg-bg-hover border border-border text-text"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* -------- Row 3: Token + request totals for selected range ------ */}
      <Card
        title={`Totals (${timeRange})`}
        extra={<Activity size={16} className="text-text-muted" />}
      >
        {loading && !summary ? (
          <Skeleton height={120} className="w-full" />
        ) : !summary ? (
          <p className="text-sm text-text-muted">No usage recorded in this range.</p>
        ) : (
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}
          >
            <Metric label="Requests" value={formatNumber(summary.totalRequests, 0)} />
            <Metric label="Total tokens" value={formatTokens(summary.totalTokens)} />
            <Metric label="Input" value={formatTokens(summary.inputTokens)} />
            <Metric label="Output" value={formatTokens(summary.outputTokens)} />
            <Metric
              label="Cached"
              value={formatTokens(summary.cachedTokens)}
              sub="reads from cache"
            />
            <Metric
              label="Cache write"
              value={formatTokens(summary.cacheWriteTokens)}
              sub="new cache entries"
            />
            <Metric
              label="Cost (today)"
              value={formatCostIn(summary.todayCost, { currency, rate, symbol, decimals: 4 })}
              sub="attributed to this key"
            />
          </div>
        )}
      </Card>

      {/* -------- Row 4: Per-provider + per-model breakdown ------------- */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
      >
        <Card title="Requests by provider" className="min-w-0">
          {loading && !providerData.length ? (
            <Skeleton height={180} className="w-full" />
          ) : (
            <BreakdownList
              data={providerData}
              emptyLabel="No requests recorded for any provider in this range."
              metric="requests"
            />
          )}
        </Card>

        <Card title="Tokens by provider" className="min-w-0">
          {loading && !providerData.length ? (
            <Skeleton height={180} className="w-full" />
          ) : (
            <BreakdownList
              data={providerData}
              emptyLabel="No tokens recorded for any provider in this range."
              metric="tokens"
            />
          )}
        </Card>

        <Card title="Requests by model alias" className="min-w-0">
          {loading && !modelData.length ? (
            <Skeleton height={180} className="w-full" />
          ) : (
            <BreakdownList
              data={modelData}
              emptyLabel="No requests recorded for any model alias in this range."
              metric="requests"
            />
          )}
        </Card>

        <Card title="Tokens by model alias" className="min-w-0">
          {loading && !modelData.length ? (
            <Skeleton height={180} className="w-full" />
          ) : (
            <BreakdownList
              data={modelData}
              emptyLabel="No tokens recorded for any model alias in this range."
              metric="tokens"
            />
          )}
        </Card>
      </div>
    </div>
  );
};
