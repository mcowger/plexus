/**
 * @fileoverview Prometheus metrics endpoint for Plexus.
 *
 * Exposes a Prometheus text-format scrape endpoint at
 * GET /v0/management/metrics (protected by X-Admin-Key, same as all
 * other management routes).
 *
 * All metrics are computed in parallel from three sources:
 *   1. The request_usage table (cumulative counters, per-dimension breakdowns,
 *      today's totals, in-flight concurrency counts).
 *   2. CooldownManager (active provider cooldowns – in-memory, no DB query).
 *   3. UsageStorageService.getProviderPerformance() (TTFT / throughput
 *      aggregates from the provider_performance table).
 *
 * The output format is Prometheus text exposition 0.0.4.
 *
 * See GRAFANA.md at the repo root for how to recreate every dashboard card
 * from these metrics using PromQL.
 */

import { FastifyInstance } from 'fastify';
import { and, gte, lte, isNull, isNotNull, sql } from 'drizzle-orm';
import { getSchema } from '../../db/client';
import { UsageStorageService } from '../../services/usage-storage';
import { CooldownManager } from '../../services/cooldown-manager';

// ---------------------------------------------------------------------------
// Prometheus text-format helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a label value per Prometheus text format spec:
 * backslash, double-quote, and newline must be escaped.
 */
function escLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Renders a set of label key=value pairs into the `{k="v",...}` syntax.
 * Returns an empty string when `labels` is empty.
 */
function renderLabels(labels: Record<string, string>): string {
  const pairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${escLabel(v)}"`)
    .join(',');
  return pairs ? `{${pairs}}` : '';
}

/**
 * Formats a single metric line (optionally with labels and a timestamp).
 * We omit timestamps intentionally so Prometheus uses its own scrape clock.
 */
function line(name: string, labels: Record<string, string>, value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return `${name}${renderLabels(labels)} ${v}`;
}

type MetricType = 'counter' | 'gauge';

/**
 * Builds a HELP + TYPE header block followed by one or more metric lines.
 */
function metricBlock(
  name: string,
  type: MetricType,
  help: string,
  rows: { labels: Record<string, string>; value: number }[]
): string {
  const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const row of rows) {
    lines.push(line(name, row.labels, row.value));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Result cache
// ---------------------------------------------------------------------------

/**
 * Cache TTL in milliseconds. Prometheus typically scrapes every 15–60 seconds;
 * caching for the same window means the DB is queried at most once per scrape
 * cycle even if multiple scrapers or alerting storms fire simultaneously.
 *
 * Can be overridden with the PLEXUS_METRICS_CACHE_TTL_MS environment variable.
 */
function getCacheTtlMs(): number {
  const env = process.env.PLEXUS_METRICS_CACHE_TTL_MS;
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

let cachedMetricsBody: string | null = null;
let cacheExpiresAt = 0;

// ---------------------------------------------------------------------------
// Session-based active time calculation
// ---------------------------------------------------------------------------

/**
 * Default gap threshold for session grouping (15 minutes),
 * matching Google Analytics' session timeout model.
 */
const DEFAULT_SESSION_GAP_MS = 15 * 60 * 1000;

/**
 * A single request's time window used by {@link computeActiveTimeMs}.
 */
interface RequestTimeWindow {
  startTime: number;
  durationMs: number;
}

/**
 * Compute total active time in milliseconds from a list of request time windows.
 *
 * Groups requests into "sessions" where consecutive requests have gaps shorter
 * than `sessionGapMs`. The total active time is the sum of each session's span
 * (first start → last end). Mirrors Google Analytics' session timeout model.
 *
 * @param requests  - Sorted by `startTime` ascending. Each entry must have
 *                    non-negative `startTime` and `durationMs` values.
 * @param sessionGapMs - Gap threshold in ms that splits sessions. Defaults to
 *                    15 minutes (900 000 ms).
 * @returns Total active time in milliseconds across all sessions.
 */
export function computeActiveTimeMs(
  requests: RequestTimeWindow[],
  sessionGapMs: number = DEFAULT_SESSION_GAP_MS
): number {
  if (requests.length === 0) return 0;

  let totalActiveMs = 0;
  let sessionStart = requests[0]!.startTime;
  let sessionEnd = sessionStart + requests[0]!.durationMs;

  for (let i = 1; i < requests.length; i++) {
    const req = requests[i]!;
    const reqEnd = req.startTime + req.durationMs;
    const gap = req.startTime - sessionEnd;

    if (gap > sessionGapMs) {
      totalActiveMs += sessionEnd - sessionStart;
      sessionStart = req.startTime;
    }
    sessionEnd = Math.max(sessionEnd, reqEnd);
  }

  totalActiveMs += sessionEnd - sessionStart;
  return totalActiveMs;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerMetricsRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  fastify.get('/v0/management/metrics', async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');

    // Serve from cache when still fresh, avoiding repeated full-table scans.
    const now = Date.now();
    if (cachedMetricsBody !== null && now < cacheExpiresAt) {
      reply.header('X-Metrics-Cache', 'HIT');
      return reply.send(cachedMetricsBody);
    }

    reply.header('X-Metrics-Cache', 'MISS');

    try {
      const db = usageStorage.getDb();
      const schema = getSchema();

      const nowMs = Date.now();
      const todayStartMs = new Date().setHours(0, 0, 0, 0); // midnight local

      // -----------------------------------------------------------------------
      // Run queries sequentially. SQLite uses a single shared lock, so
      // Promise.all provides no actual parallelism here -- it just serializes
      // the same queries with extra scheduling overhead. Sequential is both
      // cleaner and equally fast on SQLite.
      // -----------------------------------------------------------------------

      // -----------------------------------------------------------------------
      // Convenience helpers
      // -----------------------------------------------------------------------
      const toNum = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

      // 1. All-time cumulative totals (full table scan; results cached above TTL)
      const totalsRow = await db
        .select({
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
          avgDurationMs: sql<number>`COALESCE(AVG(${schema.requestUsage.durationMs}), 0)`,
          errorsTotal: sql<number>`COALESCE(SUM(CASE WHEN ${schema.requestUsage.responseStatus} != 'success' THEN 1 ELSE 0 END), 0)`,
        })
        .from(schema.requestUsage);

      // 2. Today's totals (since local midnight)
      const todayRow = await db
        .select({
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensReasoning: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensReasoning}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
          errors: sql<number>`COALESCE(SUM(CASE WHEN ${schema.requestUsage.responseStatus} != 'success' THEN 1 ELSE 0 END), 0)`,
        })
        .from(schema.requestUsage)
        .where(gte(schema.requestUsage.startTime, todayStartMs));

      // 3. All-time per-provider totals
      const byProviderRows = await db
        .select({
          provider: schema.requestUsage.provider,
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          costTotal: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
          errors: sql<number>`COALESCE(SUM(CASE WHEN ${schema.requestUsage.responseStatus} != 'success' THEN 1 ELSE 0 END), 0)`,
          avgLatencyMs: sql<number>`COALESCE(AVG(${schema.requestUsage.durationMs}), 0)`,
          avgTtftMs: sql<number>`COALESCE(AVG(${schema.requestUsage.ttftMs}), 0)`,
          avgTps: sql<number>`COALESCE(AVG(${schema.requestUsage.tokensPerSec}), 0)`,
        })
        .from(schema.requestUsage)
        .where(isNotNull(schema.requestUsage.provider))
        .groupBy(schema.requestUsage.provider);

      // 4. All-time per-model-alias totals
      const byModelAliasRows = await db
        .select({
          modelAlias: schema.requestUsage.incomingModelAlias,
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          kwhUsed: sql<number>`COALESCE(SUM(${schema.requestUsage.kwhUsed}), 0)`,
          totalDurationMs: sql<number>`COALESCE(SUM(${schema.requestUsage.durationMs}), 0)`,
        })
        .from(schema.requestUsage)
        .where(isNotNull(schema.requestUsage.incomingModelAlias))
        .groupBy(schema.requestUsage.incomingModelAlias);

      // 5. All-time per-API-key totals
      const byApiKeyRows = await db
        .select({
          apiKey: schema.requestUsage.apiKey,
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
        })
        .from(schema.requestUsage)
        .where(isNotNull(schema.requestUsage.apiKey))
        .groupBy(schema.requestUsage.apiKey);

      // 6. All-time per-API-key + attribution totals
      const byApiKeyAttributionRows = await db
        .select({
          apiKey: schema.requestUsage.apiKey,
          attribution: schema.requestUsage.attribution,
          requests: sql<number>`COUNT(*)`,
          tokensInput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensOutput}), 0)`,
          tokensCached: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCached}), 0)`,
          tokensCacheWrite: sql<number>`COALESCE(SUM(${schema.requestUsage.tokensCacheWrite}), 0)`,
          costTotal: sql<number>`COALESCE(SUM(${schema.requestUsage.costTotal}), 0)`,
          errors: sql<number>`COALESCE(SUM(CASE WHEN ${schema.requestUsage.responseStatus} != 'success' THEN 1 ELSE 0 END), 0)`,
        })
        .from(schema.requestUsage)
        .where(isNotNull(schema.requestUsage.apiKey))
        .groupBy(schema.requestUsage.apiKey, schema.requestUsage.attribution);

      // 7. Currently in-flight requests grouped by provider
      //    (durationMs IS NULL = request started but not yet completed)
      const inFlightByProviderRows = await db
        .select({
          provider: schema.requestUsage.provider,
          count: sql<number>`COUNT(*)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            isNull(schema.requestUsage.durationMs),
            isNotNull(schema.requestUsage.provider),
            gte(schema.requestUsage.startTime, nowMs - 60 * 60 * 1000)
          )
        )
        .groupBy(schema.requestUsage.provider);

      // 8. Currently in-flight requests grouped by canonical model name
      const inFlightByModelRows = await db
        .select({
          model: schema.requestUsage.canonicalModelName,
          count: sql<number>`COUNT(*)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            isNull(schema.requestUsage.durationMs),
            isNotNull(schema.requestUsage.canonicalModelName),
            gte(schema.requestUsage.startTime, nowMs - 60 * 60 * 1000)
          )
        )
        .groupBy(schema.requestUsage.canonicalModelName);

      // 8. Session-based active time calculation
      //    Fetch request time windows and delegate to the pure function.
      const requestTimestamps = await db
        .select({
          startTime: schema.requestUsage.startTime,
          durationMs: schema.requestUsage.durationMs,
        })
        .from(schema.requestUsage)
        .orderBy(schema.requestUsage.startTime);

      const totalActiveMs = computeActiveTimeMs(
        requestTimestamps.map((r) => ({
          startTime: toNum(r.startTime),
          durationMs: toNum(r.durationMs),
        }))
      );

      // 9. Provider performance aggregates (TTFT, throughput)
      const rawPerfRows = await usageStorage.getProviderPerformance();

      // Active cooldowns from in-memory CooldownManager (no DB query needed)
      const cooldowns = CooldownManager.getInstance().getCooldowns();

      // -----------------------------------------------------------------------
      // Deduplicate helpers
      //
      // getProviderPerformance() groups by four columns
      // (provider, perf.model, perf.canonicalModelName, usage.canonicalModelName)
      // and resolves the display name via COALESCE. Two underlying groups can
      // therefore produce the same (provider, model) label pair after the
      // COALESCE — e.g. one row where perf.canonicalModelName is populated and
      // another where it is NULL but usage.canonicalModelName fills the same
      // value. Prometheus treats duplicate label-sets within one scrape as an
      // error and drops the extras with a "same timestamp" warning.
      //
      // We merge them here by summing counts and averaging the averages
      // (weighted by sample_count so the merged avg_ttft / avg_tps are correct).
      // The same dedup-to-'unknown' pattern applies to any GROUP BY column that
      // could be NULL in the DB (provider, model_alias, api_key) — those are
      // already handled by the ?? 'unknown' fallback in the SQL WHERE clause,
      // but we also collapse any remaining duplicates defensively.
      // -----------------------------------------------------------------------

      type PerfKey = string;
      const perfMap = new Map<
        PerfKey,
        {
          provider: string;
          model: string;
          avg_ttft_ms: number;
          min_ttft_ms: number;
          max_ttft_ms: number;
          avg_tokens_per_sec: number;
          min_tokens_per_sec: number;
          max_tokens_per_sec: number;
          sample_count: number;
          success_count: number;
          failure_count: number;
        }
      >();

      for (const r of rawPerfRows) {
        const provider = r.provider ?? 'unknown';
        const model = r.model ?? 'unknown';
        const key: PerfKey = `${provider}\0${model}`;
        const sc = toNum(r.sample_count);
        const existing = perfMap.get(key);

        if (!existing) {
          perfMap.set(key, {
            provider,
            model,
            avg_ttft_ms: toNum(r.avg_ttft_ms),
            min_ttft_ms: toNum(r.min_ttft_ms),
            max_ttft_ms: toNum(r.max_ttft_ms),
            avg_tokens_per_sec: toNum(r.avg_tokens_per_sec),
            min_tokens_per_sec: toNum(r.min_tokens_per_sec),
            max_tokens_per_sec: toNum(r.max_tokens_per_sec),
            sample_count: sc,
            success_count: toNum(r.success_count),
            failure_count: toNum(r.failure_count),
          });
        } else {
          // Merge: mins/maxes are trivial; averages need weighting by sample count.
          const totalSc = existing.sample_count + sc;
          const w1 = totalSc > 0 ? existing.sample_count / totalSc : 0.5;
          const w2 = totalSc > 0 ? sc / totalSc : 0.5;
          existing.avg_ttft_ms = existing.avg_ttft_ms * w1 + toNum(r.avg_ttft_ms) * w2;
          existing.min_ttft_ms = Math.min(existing.min_ttft_ms, toNum(r.min_ttft_ms));
          existing.max_ttft_ms = Math.max(existing.max_ttft_ms, toNum(r.max_ttft_ms));
          existing.avg_tokens_per_sec =
            existing.avg_tokens_per_sec * w1 + toNum(r.avg_tokens_per_sec) * w2;
          existing.min_tokens_per_sec = Math.min(
            existing.min_tokens_per_sec,
            toNum(r.min_tokens_per_sec)
          );
          existing.max_tokens_per_sec = Math.max(
            existing.max_tokens_per_sec,
            toNum(r.max_tokens_per_sec)
          );
          existing.sample_count = totalSc;
          existing.success_count += toNum(r.success_count);
          existing.failure_count += toNum(r.failure_count);
        }
      }

      const perfRows = Array.from(perfMap.values());

      const totals = totalsRow[0] ?? {
        requests: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensCached: 0,
        tokensCacheWrite: 0,
        kwhUsed: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        errorsTotal: 0,
      };

      const today = todayRow[0] ?? {
        requests: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensReasoning: 0,
        tokensCached: 0,
        tokensCacheWrite: 0,
        kwhUsed: 0,
        totalDurationMs: 0,
        totalCost: 0,
        errors: 0,
      };

      // -----------------------------------------------------------------------
      // Build metric blocks
      // -----------------------------------------------------------------------
      const blocks: string[] = [];

      // --- Cumulative all-time counters --------------------------------------

      blocks.push(
        metricBlock(
          'plexus_requests_total',
          'counter',
          'Total number of requests processed by Plexus since the database was created.',
          [{ labels: {}, value: toNum(totals.requests) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_errors_total',
          'counter',
          'Total number of non-success responses (errors) across all providers.',
          [{ labels: {}, value: toNum(totals.errorsTotal) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_tokens_total',
          'counter',
          'Total tokens processed, broken down by token type (input, output, cached, cache_write).',
          [
            { labels: { type: 'input' }, value: toNum(totals.tokensInput) },
            { labels: { type: 'output' }, value: toNum(totals.tokensOutput) },
            { labels: { type: 'cached' }, value: toNum(totals.tokensCached) },
            { labels: { type: 'cache_write' }, value: toNum(totals.tokensCacheWrite) },
          ]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_energy_kwh_total',
          'counter',
          'Total estimated energy consumption in kilowatt-hours across all requests.',
          [{ labels: {}, value: toNum(totals.kwhUsed) }]
        )
      );

      // --- Today's gauges ---------------------------------------------------

      blocks.push(
        metricBlock(
          'plexus_requests_today',
          'gauge',
          'Number of requests processed since local midnight.',
          [{ labels: {}, value: toNum(today.requests) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_errors_today',
          'gauge',
          'Number of non-success responses since local midnight.',
          [{ labels: {}, value: toNum(today.errors) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_cost_today_usd',
          'gauge',
          'Total cost in USD for requests processed since local midnight.',
          [{ labels: {}, value: toNum(today.totalCost) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_tokens_today',
          'gauge',
          'Tokens processed since local midnight, broken down by token type.',
          [
            { labels: { type: 'input' }, value: toNum(today.tokensInput) },
            { labels: { type: 'output' }, value: toNum(today.tokensOutput) },
            { labels: { type: 'reasoning' }, value: toNum(today.tokensReasoning) },
            { labels: { type: 'cached' }, value: toNum(today.tokensCached) },
            { labels: { type: 'cache_write' }, value: toNum(today.tokensCacheWrite) },
          ]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_energy_kwh_today',
          'gauge',
          'Estimated energy in kilowatt-hours for requests since local midnight.',
          [{ labels: {}, value: toNum(today.kwhUsed) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_duration_ms_total',
          'counter',
          'Total inference duration in milliseconds across all requests since the database was created.',
          [{ labels: {}, value: toNum(totals.totalDurationMs) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_avg_duration_ms',
          'gauge',
          'All-time average end-to-end latency in milliseconds per request.',
          [{ labels: {}, value: toNum(totals.avgDurationMs) }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_active_time_ms',
          'gauge',
          'Total active time in milliseconds, computed using a session-based model (15-min gap threshold, same as Google Analytics). This represents the wall-clock time during which at least one request was in-flight.',
          [{ labels: {}, value: totalActiveMs }]
        )
      );

      blocks.push(
        metricBlock(
          'plexus_duration_ms_today',
          'gauge',
          'Total inference duration in milliseconds for requests since local midnight.',
          [{ labels: {}, value: toNum(today.totalDurationMs) }]
        )
      );

      // --- Per-provider counters and gauges ---------------------------------

      blocks.push(
        metricBlock(
          'plexus_provider_requests_total',
          'counter',
          'Total requests routed to each provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.requests),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_errors_total',
          'counter',
          'Total non-success responses from each provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.errors),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_tokens_total',
          'counter',
          'Total tokens (input + output + cached + cache_write) sent to each provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value:
              toNum(r.tokensInput) +
              toNum(r.tokensOutput) +
              toNum(r.tokensCached) +
              toNum(r.tokensCacheWrite),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_cost_usd_total',
          'counter',
          'Cumulative cost in USD for each provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.costTotal),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_avg_latency_ms',
          'gauge',
          'All-time average end-to-end latency in milliseconds per provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.avgLatencyMs),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_avg_ttft_ms',
          'gauge',
          'All-time average time-to-first-token in milliseconds per provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.avgTtftMs),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_avg_tokens_per_sec',
          'gauge',
          'All-time average token throughput in tokens/second per provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.avgTps),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_energy_kwh_total',
          'counter',
          'Total estimated energy consumption in kilowatt-hours per provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.kwhUsed),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_provider_duration_ms_total',
          'counter',
          'Total inference duration in milliseconds per provider.',
          byProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.totalDurationMs),
          }))
        )
      );

      // --- Per-model-alias counters -----------------------------------------

      blocks.push(
        metricBlock(
          'plexus_model_alias_requests_total',
          'counter',
          'Total requests received per incoming model alias (the model name the client sent).',
          byModelAliasRows.map((r) => ({
            labels: { model_alias: r.modelAlias ?? 'unknown' },
            value: toNum(r.requests),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_model_alias_tokens_total',
          'counter',
          'Total tokens (input + output + cached + cache_write) per incoming model alias.',
          byModelAliasRows.map((r) => ({
            labels: { model_alias: r.modelAlias ?? 'unknown' },
            value:
              toNum(r.tokensInput) +
              toNum(r.tokensOutput) +
              toNum(r.tokensCached) +
              toNum(r.tokensCacheWrite),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_model_alias_energy_kwh_total',
          'counter',
          'Total estimated energy consumption in kilowatt-hours per incoming model alias.',
          byModelAliasRows.map((r) => ({
            labels: { model_alias: r.modelAlias ?? 'unknown' },
            value: toNum(r.kwhUsed),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_model_alias_duration_ms_total',
          'counter',
          'Total inference duration in milliseconds per incoming model alias.',
          byModelAliasRows.map((r) => ({
            labels: { model_alias: r.modelAlias ?? 'unknown' },
            value: toNum(r.totalDurationMs),
          }))
        )
      );

      // --- Per-API-key counters ---------------------------------------------

      blocks.push(
        metricBlock(
          'plexus_api_key_requests_total',
          'counter',
          'Total requests per API key (hashed or named key identifier).',
          byApiKeyRows.map((r) => ({
            labels: { api_key: r.apiKey ?? 'unknown' },
            value: toNum(r.requests),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_api_key_tokens_total',
          'counter',
          'Total tokens per API key.',
          byApiKeyRows.map((r) => ({
            labels: { api_key: r.apiKey ?? 'unknown' },
            value:
              toNum(r.tokensInput) +
              toNum(r.tokensOutput) +
              toNum(r.tokensCached) +
              toNum(r.tokensCacheWrite),
          }))
        )
      );

      // --- Per-API-key + attribution counters ------------------------------

      blocks.push(
        metricBlock(
          'plexus_api_key_attribution_requests_total',
          'counter',
          'Total requests per API key and attribution suffix (the part after the colon in the key, e.g. "mysecret:copilot" → attribution="copilot").',
          byApiKeyAttributionRows.map((r) => ({
            labels: {
              api_key: r.apiKey ?? 'unknown',
              attribution: r.attribution ?? '',
            },
            value: toNum(r.requests),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_api_key_attribution_tokens_total',
          'counter',
          'Total tokens per API key and attribution suffix.',
          byApiKeyAttributionRows.map((r) => ({
            labels: {
              api_key: r.apiKey ?? 'unknown',
              attribution: r.attribution ?? '',
            },
            value:
              toNum(r.tokensInput) +
              toNum(r.tokensOutput) +
              toNum(r.tokensCached) +
              toNum(r.tokensCacheWrite),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_api_key_attribution_cost_usd_total',
          'counter',
          'Cumulative cost in USD per API key and attribution suffix.',
          byApiKeyAttributionRows.map((r) => ({
            labels: {
              api_key: r.apiKey ?? 'unknown',
              attribution: r.attribution ?? '',
            },
            value: toNum(r.costTotal),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_api_key_attribution_errors_total',
          'counter',
          'Total non-success responses per API key and attribution suffix.',
          byApiKeyAttributionRows.map((r) => ({
            labels: {
              api_key: r.apiKey ?? 'unknown',
              attribution: r.attribution ?? '',
            },
            value: toNum(r.errors),
          }))
        )
      );

      // --- In-flight (concurrency) gauges -----------------------------------

      blocks.push(
        metricBlock(
          'plexus_in_flight_requests',
          'gauge',
          'Number of requests currently in-flight (started but not yet completed), per provider.',
          inFlightByProviderRows.map((r) => ({
            labels: { provider: r.provider ?? 'unknown' },
            value: toNum(r.count),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_in_flight_requests_by_model',
          'gauge',
          'Number of requests currently in-flight, per canonical model name.',
          inFlightByModelRows.map((r) => ({
            labels: { model: r.model ?? 'unknown' },
            value: toNum(r.count),
          }))
        )
      );

      // --- Cooldown gauges --------------------------------------------------

      blocks.push(
        metricBlock(
          'plexus_cooldown_active',
          'gauge',
          '1 if the provider/model combination is currently in a cooldown, 0 otherwise. Active cooldowns indicate recent consecutive failures.',
          cooldowns.map((c) => ({
            labels: {
              provider: c.provider,
              model: c.model,
            },
            value: 1,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_cooldown_time_remaining_ms',
          'gauge',
          'Milliseconds remaining in the current cooldown period for this provider/model pair.',
          cooldowns.map((c) => ({
            labels: {
              provider: c.provider,
              model: c.model,
            },
            value: Math.max(0, c.timeRemainingMs),
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_cooldown_consecutive_failures',
          'gauge',
          'Number of consecutive failures that triggered the current cooldown.',
          cooldowns.map((c) => ({
            labels: {
              provider: c.provider,
              model: c.model,
            },
            value: c.consecutiveFailures,
          }))
        )
      );

      // --- Performance tab metrics (TTFT, throughput) -----------------------
      // perfRows is already deduplicated by (provider, model) above; values are
      // plain numbers, no toNum() or ?? 'unknown' needed.

      blocks.push(
        metricBlock(
          'plexus_perf_avg_ttft_ms',
          'gauge',
          'Average time-to-first-token in milliseconds per provider and target model, aggregated over all recorded samples.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.avg_ttft_ms,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_min_ttft_ms',
          'gauge',
          'Minimum time-to-first-token in milliseconds per provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.min_ttft_ms,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_max_ttft_ms',
          'gauge',
          'Maximum time-to-first-token in milliseconds per provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.max_ttft_ms,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_avg_tokens_per_sec',
          'gauge',
          'Average token throughput in tokens/second per provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.avg_tokens_per_sec,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_min_tokens_per_sec',
          'gauge',
          'Minimum token throughput in tokens/second per provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.min_tokens_per_sec,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_max_tokens_per_sec',
          'gauge',
          'Maximum token throughput in tokens/second per provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.max_tokens_per_sec,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_sample_count',
          'gauge',
          'Number of requests sampled in the performance aggregate for this provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.sample_count,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_success_count',
          'gauge',
          'Number of successful requests in the performance aggregate for this provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.success_count,
          }))
        )
      );

      blocks.push(
        metricBlock(
          'plexus_perf_failure_count',
          'gauge',
          'Number of failed requests in the performance aggregate for this provider and model.',
          perfRows.map((r) => ({
            labels: { provider: r.provider, model: r.model },
            value: r.failure_count,
          }))
        )
      );

      // -----------------------------------------------------------------------
      // Emit final response
      // -----------------------------------------------------------------------
      const body = blocks.join('\n\n') + '\n';

      // Populate cache so subsequent scrapes within the TTL window skip the DB.
      cachedMetricsBody = body;
      cacheExpiresAt = Date.now() + getCacheTtlMs();

      return reply.send(body);
    } catch (err: any) {
      // Invalidate the cache on error so the next scrape retries immediately.
      cachedMetricsBody = null;
      cacheExpiresAt = 0;
      // Return a valid (if sparse) Prometheus body so Prometheus marks the
      // scrape as an error rather than a parse failure.
      reply.status(500);
      return reply.send(`# ERROR scraping Plexus metrics: ${String(err?.message ?? err)}\n`);
    }
  });
}
