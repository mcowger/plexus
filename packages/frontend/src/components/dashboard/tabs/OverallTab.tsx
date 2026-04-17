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
 *   - `getUsageSummary`    → aggregated totals for the selected time range plus
 *                             an embedded 7-day / today roll-up
 *   - `getUsageByProvider` → per-provider request + token totals
 *   - `getUsageByModel`    → per-model (alias) request + token totals
 *   - `getSelfQuota`       → quota progress for the caller's key, when assigned
 *
 * All calls fire in parallel inside a single `useEffect`. There is no polling;
 * a manual refresh is triggered by changing the time range.
 */

import { useEffect, useMemo, useState } from 'react';
import { Key, Layers, Boxes, Gauge, Activity, AlertTriangle } from 'lucide-react';
import { api, type PieChartDataPoint } from '../../../lib/api';
import { formatNumber, formatTokens, formatCost } from '../../../lib/format';
import { Card } from '../../ui/Card';
import { QuotaProgressBar } from '../../quota/QuotaProgressBar';
import { TimeRangeSelector } from '../TimeRangeSelector';
import type { QuotaStatus } from '../../../types/quota';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

interface SelfInfo {
  role: 'admin' | 'limited';
  keyName?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  quotaName?: string | null;
  comment?: string | null;
}

interface SummaryStats {
  range: TimeRange;
  totalRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  todayCost: number;
}

interface QuotaInfo {
  quotaName: string | null;
  allowed: boolean;
  currentUsage: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
  limitType: 'requests' | 'tokens' | 'cost' | null;
}

/**
 * Format an ISO resets-at timestamp as a short relative string, e.g.
 * "in 3h 20m". Falls back to an absolute date for far-future resets.
 */
function formatResetsIn(iso: string | null): string {
  if (!iso) return '—';
  const resetsAt = new Date(iso).getTime();
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return 'resetting now';
  const diffSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 7) return `on ${new Date(iso).toLocaleDateString()}`;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

/**
 * Map a quota utilization percentage onto the progress-bar status colors
 * used elsewhere in the UI. Kept in sync with `QuotaProgressBar`'s palette.
 */
function statusForPercent(pct: number): QuotaStatus {
  if (pct >= 100) return 'exhausted';
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'warning';
  return 'ok';
}

/**
 * Format a quota usage value based on its limitType. `tokens` and `requests`
 * reuse the compact number formatter; `cost` falls through to formatCost.
 */
function formatQuotaValue(value: number, limitType: QuotaInfo['limitType']): string {
  if (limitType === 'cost') return formatCost(value);
  return formatNumber(value, 1);
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
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [info, setInfo] = useState<SelfInfo | null>(null);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [providerData, setProviderData] = useState<PieChartDataPoint[]>([]);
  const [modelData, setModelData] = useState<PieChartDataPoint[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
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
          setQuota(data);
          setQuotaError(false);
        }
      })
      .catch(() => {
        // Distinguish fetch failure from "no quota assigned" so the card
        // doesn't tell a quota-gated user that they are unrestricted.
        if (!cancelled) {
          setQuota(null);
          setQuotaError(true);
        }
      });

    // Token + request totals for the selected range. The backend endpoint is
    // auto-scoped to the calling limited user.
    const summaryPromise = api.getUsageSummary(timeRange, true).then((res) => {
      if (cancelled || !res) return;
      // `stats` is a fixed 7-day window; to get totals for the selected range
      // we sum the per-bucket series instead.
      const totals = (res.series || []).reduce(
        (acc, p) => {
          acc.requests += p.requests || 0;
          acc.inputTokens += p.inputTokens || 0;
          acc.outputTokens += p.outputTokens || 0;
          acc.cachedTokens += p.cachedTokens || 0;
          acc.cacheWriteTokens += p.cacheWriteTokens || 0;
          return acc;
        },
        { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
      );
      setSummary({
        range: timeRange,
        totalRequests: totals.requests,
        totalTokens:
          totals.inputTokens + totals.outputTokens + totals.cachedTokens + totals.cacheWriteTokens,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedTokens: totals.cachedTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        todayCost: res.today?.totalCost ?? 0,
      });
    });

    const providerPromise = api.getUsageByProvider(timeRange, true).then((d) => {
      if (!cancelled) setProviderData(d);
    });
    const modelPromise = api.getUsageByModel(timeRange, true).then((d) => {
      if (!cancelled) setModelData(d);
    });

    Promise.allSettled([
      metaPromise,
      quotaPromise,
      summaryPromise,
      providerPromise,
      modelPromise,
    ]).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [timeRange]);

  // Derived progress percentage for the quota card. 0% when no limit is set
  // so the bar renders empty instead of NaN-width.
  const quotaPct = useMemo(() => {
    if (!quota || !quota.limit || quota.limit <= 0) return 0;
    return Math.min(100, (quota.currentUsage / quota.limit) * 100);
  }, [quota]);

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
            if (r !== 'custom' && r !== 'live') setTimeRange(r);
          }}
          options={['hour', 'day', 'week', 'month']}
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
              <dd className="text-text">{info?.quotaName || 'None assigned'}</dd>
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
          {loading && !quota && !quotaError ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : quotaError ? (
            <div className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Could not load quota status. If this key has a quota assigned, its current usage is
                not shown here — try refreshing.
              </span>
            </div>
          ) : !quota || !quota.quotaName ? (
            <p className="text-sm text-text-muted">
              No quota is assigned to this key — requests are unrestricted by quota policy.
            </p>
          ) : quota.limit == null ? (
            <div className="space-y-2">
              <p className="text-sm text-text">
                Assigned: <span className="font-medium">{quota.quotaName}</span>
              </p>
              <p className="text-xs text-text-muted">
                Quota definition not resolved yet; current status is unavailable.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <QuotaProgressBar
                label={`${quota.quotaName} (${quota.limitType ?? 'usage'})`}
                value={quota.currentUsage}
                max={quota.limit}
                displayValue={`${formatQuotaValue(quota.currentUsage, quota.limitType)} / ${formatQuotaValue(
                  quota.limit,
                  quota.limitType
                )}`}
                status={statusForPercent(quotaPct)}
                size="md"
              />
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                  Remaining:{' '}
                  <span className="text-text font-medium">
                    {quota.remaining != null
                      ? formatQuotaValue(quota.remaining, quota.limitType)
                      : '—'}
                  </span>
                </span>
                <span>Resets {formatResetsIn(quota.resetsAt)}</span>
              </div>
              {!quota.allowed && (
                <div className="flex items-center gap-2 text-xs text-danger">
                  <AlertTriangle size={14} />
                  <span>Quota exhausted — new requests will be rejected until it resets.</span>
                </div>
              )}
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
          <p className="text-sm text-text-muted">Loading…</p>
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
              value={formatCost(summary.todayCost)}
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
            <p className="text-sm text-text-muted">Loading…</p>
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
            <p className="text-sm text-text-muted">Loading…</p>
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
            <p className="text-sm text-text-muted">Loading…</p>
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
            <p className="text-sm text-text-muted">Loading…</p>
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
