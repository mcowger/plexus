import { and, eq, gte, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import parseDuration from 'parse-duration';
import { logger } from '../../utils/logger';
import { getConfig, PlexusConfig, QuotaDefinition, KeyConfig } from '../../config';
import { getDatabase, getSchema, getCurrentDialect } from '../../db/client';
import { toDbTimestampMs } from '../../utils/normalize';
import { ScopeLists, scopeMatches, isGlobalScope } from '../scope-match';

/** Sentinel `key_name` used for `shared: true` quota definitions — a single
 * pooled bucket accrued across every key that references the quota, instead
 * of one independent counter per key. */
export const SHARED_OWNER = '*';

export interface UsageRecord {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCached?: number | null;
  tokensCacheWrite?: number | null;
  tokensReasoning?: number | null;
  costTotal?: number | null;
}

/** Point-in-time read of a single quota definition's state for one key (or
 * the shared bucket). Purely computed in memory — never a side effect of
 * reading it. */
export interface QuotaCheckSnapshot {
  quotaName: string;
  limitType: 'requests' | 'tokens' | 'cost';
  limit: number;
  currentUsage: number;
  remaining: number;
  allowed: boolean;
  resetsAtMs: number;
  scope: ScopeLists;
  global: boolean;
  shared: boolean;
  warnAt?: number;
  source: 'assigned' | 'default';
}

/** The full set of quotas that apply to a key for the current request,
 * resolved once per request. `blockedGlobal` is the first exhausted
 * quota with global scope (applies regardless of candidate provider/model) —
 * middleware/route shims use it to preserve the old single-quota 429 shape. */
export interface QuotaContext {
  keyName: string;
  checks: QuotaCheckSnapshot[];
  blockedGlobal: QuotaCheckSnapshot | null;
}

/** Minimal candidate shape `filterCandidates`/`selectHeaderQuota` need —
 * kept generic so callers can pass their own richer candidate/route types. */
export interface QuotaCandidate {
  provider: string;
  model: string;
}

interface QuotaStateRow {
  keyName: string;
  quotaName: string;
  limitType: string;
  currentUsage: number;
  lastUpdated: Date | number;
  windowStart: Date | number | null;
}

type CalendarType = 'daily' | 'weekly' | 'monthly';

/**
 * Effective quota-name set for a key: `keyConfig.quotas` when non-empty,
 * else `config.default_quotas`. Non-stacking substitution, not a union —
 * a key with its own quotas never also gets the defaults. Exported so the
 * management routes (`_quota-response.ts`) validate quota membership with
 * the exact same resolution enforcement uses.
 */
export function resolveQuotaNames(
  keyConfig: KeyConfig,
  config: PlexusConfig
): { names: string[]; source: 'assigned' | 'default' } | null {
  if (keyConfig.quotas && keyConfig.quotas.length > 0) {
    return { names: keyConfig.quotas, source: 'assigned' };
  }
  if (config.default_quotas && config.default_quotas.length > 0) {
    return { names: config.default_quotas, source: 'default' };
  }
  return null;
}

export class QuotaEnforcer {
  private db: ReturnType<typeof getDatabase>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private schema: any;
  private dialect: 'sqlite' | 'postgres';

  constructor() {
    this.db = getDatabase();
    this.schema = getSchema();
    this.dialect = getCurrentDialect() === 'postgres' ? 'postgres' : 'sqlite';
  }

  /**
   * Convert a DB-returned value for lastUpdated/windowStart to epoch ms.
   * PostgreSQL bigint(mode:'number') returns epoch ms as a number.
   * SQLite integer(mode:'timestamp_ms') returns a Date object.
   */
  private toMs(value: Date | number | null | undefined): number | null {
    if (value == null) return null;
    return value instanceof Date ? value.getTime() : value;
  }

  private scopeOf(def: QuotaDefinition): ScopeLists {
    return {
      allowedModels: def.allowedModels,
      allowedProviders: def.allowedProviders,
      excludedModels: def.excludedModels,
      excludedProviders: def.excludedProviders,
    };
  }

  /**
   * Start of the current calendar window (UTC), given `type`.
   * Weekly anchors to Monday (ISO week start) — matches the "Resets at
   * midnight UTC on Monday" copy already shown in the admin UI. Existing
   * Sunday-anchored rows persisted before this change simply look "stale"
   * (window_start mismatch) on next read/write and lazily reset — no
   * migration needed.
   */
  private getWindowStart(type: CalendarType, nowMs: number): number {
    const now = new Date(nowMs);
    if (type === 'daily') {
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    } else if (type === 'weekly') {
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      now.setUTCDate(now.getUTCDate() - daysSinceMonday);
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    }
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
  }

  /** End of the calendar window that starts at `windowStartMs`. */
  private getWindowEnd(type: CalendarType, windowStartMs: number): number {
    if (type === 'daily') return windowStartMs + 24 * 60 * 60 * 1000;
    if (type === 'weekly') return windowStartMs + 7 * 24 * 60 * 60 * 1000;
    const d = new Date(windowStartMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  }

  /**
   * Align a timestamp to the start of the current rolling period.
   * E.g. if now is 10:30 and duration is 1h, returns 10:00.
   */
  private alignToPeriodStart(nowMs: number, durationMs: number): number {
    return Math.floor(nowMs / durationMs) * durationMs;
  }

  /**
   * Compute a read-only snapshot for one quota definition from its stored
   * row (if any). No DB writes happen here — resets/leak are applied purely
   * in memory so `loadQuotaContext` stays a single SELECT.
   *
   * Returns null when the quota can't be evaluated at all (invalid rolling
   * duration) — matches the legacy single-quota checker's fail-open
   * behavior of skipping the check entirely rather than blocking.
   */
  private computeSnapshot(
    name: string,
    def: QuotaDefinition,
    row: QuotaStateRow | undefined,
    nowMs: number,
    source: 'assigned' | 'default'
  ): QuotaCheckSnapshot | null {
    const scope = this.scopeOf(def);
    const global = isGlobalScope(scope);
    const shared = def.shared === true;

    let currentUsage: number;
    let resetsAtMs: number;

    if (def.type === 'daily' || def.type === 'weekly' || def.type === 'monthly') {
      const expectedWindowStart = this.getWindowStart(def.type, nowMs);
      const storedWindowStart = row ? this.toMs(row.windowStart) : null;
      const stale =
        !row || storedWindowStart !== expectedWindowStart || row.limitType !== def.limitType;
      currentUsage = stale ? 0 : row!.currentUsage;
      resetsAtMs = this.getWindowEnd(def.type, expectedWindowStart);
    } else if (def.type === 'rolling' && def.limitType === 'cost') {
      const durationMs = parseDuration(def.duration);
      if (!durationMs) {
        logger.warn(
          `Invalid duration '${def.duration}' for rolling cost quota '${name}'. Skipping check (fail-open).`
        );
        return null;
      }
      const expectedWindowStart = this.alignToPeriodStart(nowMs, durationMs);
      const storedWindowStart = row ? this.toMs(row.windowStart) : null;
      const stale =
        !row || storedWindowStart !== expectedWindowStart || row.limitType !== def.limitType;
      currentUsage = stale ? 0 : row!.currentUsage;
      resetsAtMs = expectedWindowStart + durationMs;
    } else {
      // rolling requests/tokens — leaky bucket
      const durationMs = parseDuration(def.duration);
      if (!durationMs) {
        logger.warn(
          `Invalid duration '${def.duration}' for rolling quota '${name}'. Skipping check (fail-open).`
        );
        return null;
      }
      if (!row || row.limitType !== def.limitType) {
        currentUsage = 0;
      } else {
        const lastUpdatedMs = this.toMs(row.lastUpdated)!;
        const elapsedMs = Math.max(0, nowMs - lastUpdatedMs);
        const leakRate = def.limit / durationMs;
        currentUsage = Math.max(0, row.currentUsage - elapsedMs * leakRate);
      }
      const timeToLeakAll = (currentUsage / def.limit) * durationMs;
      resetsAtMs = nowMs + timeToLeakAll;
    }

    const allowed = currentUsage < def.limit;
    const remaining = Math.max(0, def.limit - currentUsage);
    const displayUsage = def.limitType === 'cost' ? currentUsage : Math.round(currentUsage);
    const displayRemaining = def.limitType === 'cost' ? remaining : Math.round(remaining);

    return {
      quotaName: name,
      limitType: def.limitType,
      limit: def.limit,
      currentUsage: displayUsage,
      remaining: displayRemaining,
      allowed,
      resetsAtMs,
      scope,
      global,
      shared,
      ...(def.warnAt !== undefined ? { warnAt: def.warnAt } : {}),
      source,
    };
  }

  /**
   * Resolve the effective quota set for `keyName` and read all of it in ONE
   * SELECT. Strictly read-only — no writes, no side effects. Returns null
   * when the key is unknown or resolves to no quota names at all (assigned
   * empty and no `default_quotas` configured).
   */
  async loadQuotaContext(keyName: string): Promise<QuotaContext | null> {
    const config = getConfig();
    const keyConfig = config.keys?.[keyName];
    if (!keyConfig) return null;

    const resolved = resolveQuotaNames(keyConfig, config);
    if (!resolved) return null;

    const defs: Array<{ name: string; def: QuotaDefinition; owner: string }> = [];
    for (const name of resolved.names) {
      const def = config.user_quotas?.[name];
      if (!def) {
        logger.warn(`Quota definition '${name}' not found for key '${keyName}'`);
        continue;
      }
      defs.push({ name, def, owner: def.shared ? SHARED_OWNER : keyName });
    }

    if (defs.length === 0) {
      return { keyName, checks: [], blockedGlobal: null };
    }

    const nonSharedNames = defs.filter((d) => d.owner === keyName).map((d) => d.name);
    const sharedNames = defs.filter((d) => d.owner === SHARED_OWNER).map((d) => d.name);

    const conditions = [];
    if (nonSharedNames.length > 0) {
      conditions.push(
        and(
          eq(this.schema.quotaState.keyName, keyName),
          inArray(this.schema.quotaState.quotaName, nonSharedNames)
        )
      );
    }
    if (sharedNames.length > 0) {
      conditions.push(
        and(
          eq(this.schema.quotaState.keyName, SHARED_OWNER),
          inArray(this.schema.quotaState.quotaName, sharedNames)
        )
      );
    }

    const rows: QuotaStateRow[] =
      conditions.length > 0
        ? await this.db
            .select()
            .from(this.schema.quotaState)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
        : [];

    const rowMap = new Map<string, QuotaStateRow>();
    for (const r of rows) rowMap.set(`${r.keyName}::${r.quotaName}`, r);

    const nowMs = Date.now();
    const checks: QuotaCheckSnapshot[] = [];
    for (const { name, def, owner } of defs) {
      const row = rowMap.get(`${owner}::${name}`);
      const snapshot = this.computeSnapshot(name, def, row, nowMs, resolved.source);
      if (snapshot) checks.push(snapshot);
    }

    const blockedGlobal = checks.find((c) => c.global && !c.allowed) ?? null;

    return { keyName, checks, blockedGlobal };
  }

  /**
   * Split candidates into those allowed by every scope-matching quota and
   * those blocked by at least one exhausted scope-matching quota. Pure —
   * takes an already-loaded context, does no I/O.
   */
  static filterCandidates<C extends QuotaCandidate>(
    ctx: QuotaContext | null,
    candidates: C[]
  ): { allowed: C[]; blocked: Array<{ candidate: C; quota: QuotaCheckSnapshot }> } {
    if (!ctx) return { allowed: candidates, blocked: [] };

    const allowed: C[] = [];
    const blocked: Array<{ candidate: C; quota: QuotaCheckSnapshot }> = [];

    for (const candidate of candidates) {
      const exhausted = ctx.checks.find(
        (c) => !c.allowed && scopeMatches(c.scope, candidate.provider, candidate.model)
      );
      if (exhausted) {
        blocked.push({ candidate, quota: exhausted });
      } else {
        allowed.push(candidate);
      }
    }

    return { allowed, blocked };
  }

  /**
   * Among the checks that apply to (provider, model) — global or
   * scope-matching — pick the most-constrained one (smallest
   * remaining/limit ratio). Used to populate legacy single-quota response
   * shapes / rate-limit headers. Pure.
   */
  static selectHeaderQuota(
    ctx: QuotaContext | null,
    provider: string,
    model: string
  ): QuotaCheckSnapshot | null {
    if (!ctx) return null;

    const applicable = ctx.checks.filter((c) => scopeMatches(c.scope, provider, model));
    if (applicable.length === 0) return null;

    return applicable.reduce((min, c) =>
      c.remaining / c.limit < min.remaining / min.limit ? c : min
    );
  }

  private computeUsageValue(limitType: 'requests' | 'tokens' | 'cost', usage: UsageRecord): number {
    if (limitType === 'requests') return 1;
    if (limitType === 'cost') return usage.costTotal || 0;
    return (
      (usage.tokensInput || 0) +
      (usage.tokensOutput || 0) +
      (usage.tokensReasoning || 0) +
      (usage.tokensCached || 0) +
      (usage.tokensCacheWrite || 0)
    );
  }

  /**
   * Atomic upsert of one quota bucket's usage. A single
   * `insert(...).onConflictDoUpdate(...)` statement — no read-then-write —
   * so concurrent recordUsage calls against the same bucket sum exactly on
   * both dialects (row-level upsert on Postgres, single-writer serialization
   * on SQLite).
   */
  private async upsertQuotaState(
    owner: string,
    quotaName: string,
    def: QuotaDefinition,
    usageValue: number,
    nowMs: number
  ): Promise<void> {
    const limitType = def.limitType;
    const maxFn = this.dialect === 'postgres' ? sql.raw('GREATEST') : sql.raw('MAX');
    const nowDb = toDbTimestampMs(nowMs, this.dialect)!;

    if (def.type === 'rolling' && limitType !== 'cost') {
      // Leaky bucket (rolling tokens/requests). limitType change still
      // resets the bucket, mirroring the existing (pre-rewrite) behavior.
      const durationMs = parseDuration(def.duration);
      if (!durationMs) {
        logger.warn(
          `Invalid duration '${def.duration}' for rolling quota '${quotaName}'. ` +
            `Recording usage without leak calculation.`
        );
      }
      const leakPerMs = durationMs ? def.limit / durationMs : 0;

      const currentUsageExpr = sql`CASE WHEN ${this.schema.quotaState.limitType} != ${limitType} THEN ${usageValue}
        ELSE ${maxFn}(0, ${this.schema.quotaState.currentUsage} - (${nowMs} - ${this.schema.quotaState.lastUpdated}) * ${leakPerMs}) + ${usageValue}
        END`;

      await this.db
        .insert(this.schema.quotaState)
        .values({
          keyName: owner,
          quotaName,
          limitType,
          currentUsage: usageValue,
          lastUpdated: nowDb,
          windowStart: null,
        })
        .onConflictDoUpdate({
          target: [this.schema.quotaState.keyName, this.schema.quotaState.quotaName],
          set: {
            currentUsage: currentUsageExpr,
            lastUpdated: nowDb,
            limitType,
          },
        });
      return;
    }

    // Rolling-cost & calendar (daily/weekly/monthly): reset to the boundary
    // exactly rather than leaking. NOTE deliberate change from the old
    // implementation: rolling-cost quotas used to ALSO reset when
    // `now - lastUpdated >= duration` (an "elapsed since last write" check),
    // which was redundant with — and could fire earlier/later than — the
    // aligned window boundary below. That branch is dropped: rolling-cost
    // now resets exactly at aligned period boundaries, same as calendar
    // quotas.
    let expectedWindowStart: number;
    if (def.type === 'rolling') {
      const durationMs = parseDuration(def.duration);
      if (!durationMs) {
        logger.warn(
          `Invalid duration '${def.duration}' for rolling cost quota '${quotaName}'. ` +
            `Using current time as window start.`
        );
      }
      expectedWindowStart = durationMs ? this.alignToPeriodStart(nowMs, durationMs) : nowMs;
    } else {
      expectedWindowStart = this.getWindowStart(def.type, nowMs);
    }
    const windowStartDb = toDbTimestampMs(expectedWindowStart, this.dialect);

    const currentUsageExpr = sql`CASE WHEN ${this.schema.quotaState.windowStart} IS NULL OR ${this.schema.quotaState.windowStart} != ${expectedWindowStart} OR ${this.schema.quotaState.limitType} != ${limitType}
      THEN ${usageValue}
      ELSE ${this.schema.quotaState.currentUsage} + ${usageValue}
      END`;

    await this.db
      .insert(this.schema.quotaState)
      .values({
        keyName: owner,
        quotaName,
        limitType,
        currentUsage: usageValue,
        lastUpdated: nowDb,
        windowStart: windowStartDb,
      })
      .onConflictDoUpdate({
        target: [this.schema.quotaState.keyName, this.schema.quotaState.quotaName],
        set: {
          currentUsage: currentUsageExpr,
          lastUpdated: nowDb,
          windowStart: windowStartDb,
          limitType,
        },
      });
  }

  /**
   * Record usage against every quota attached to `keyName` whose scope
   * matches (finalProvider, finalModel) — the resolved candidate/model at
   * filter time may differ from the model actually dispatched, so recording
   * uses the final attempt, not the original candidate list.
   */
  async recordUsage(
    keyName: string,
    finalProvider: string,
    finalModel: string,
    usage: UsageRecord
  ): Promise<void> {
    const config = getConfig();
    const keyConfig = config.keys?.[keyName];
    if (!keyConfig) return;

    const resolved = resolveQuotaNames(keyConfig, config);
    if (!resolved) return;

    const nowMs = Date.now();
    for (const name of resolved.names) {
      const def = config.user_quotas?.[name];
      if (!def) continue;
      if (!scopeMatches(this.scopeOf(def), finalProvider, finalModel)) continue;

      const owner = def.shared ? SHARED_OWNER : keyName;
      const usageValue = this.computeUsageValue(def.limitType, usage);
      await this.upsertQuotaState(owner, name, def, usageValue, nowMs);
    }
  }

  /**
   * Reset quota usage to zero. With no `quotaName`, clears every quota
   * currently attached to the key (assigned, or default_quotas if the key
   * has none of its own). Shared defs clear the pooled '*' bucket.
   */
  async clearQuota(keyName: string, quotaName?: string): Promise<void> {
    const config = getConfig();
    const keyConfig = config.keys?.[keyName];

    let names: string[];
    if (quotaName) {
      names = [quotaName];
    } else {
      const resolved = keyConfig ? resolveQuotaNames(keyConfig, config) : null;
      names = resolved?.names ?? [];
    }

    if (names.length === 0) return;

    const nowMs = Date.now();
    const nowDb = toDbTimestampMs(nowMs, this.dialect)!;

    for (const name of names) {
      const def = config.user_quotas?.[name];
      const owner = def?.shared ? SHARED_OWNER : keyName;
      await this.db
        .update(this.schema.quotaState)
        .set({ currentUsage: 0, lastUpdated: nowDb })
        .where(
          and(eq(this.schema.quotaState.keyName, owner), eq(this.schema.quotaState.quotaName, name))
        );
    }

    logger.debug(`Quota cleared for ${keyName}${quotaName ? `/${quotaName}` : ' (all attached)'}`);
  }

  /** Every key whose resolved quota set (assigned, or default_quotas
   * fallback) includes `quotaName` — used to recompute a shared bucket from
   * `request_usage` across every key that pools into it. */
  private keysAttachingQuota(quotaName: string, config: PlexusConfig): string[] {
    const keys: string[] = [];
    for (const [name, keyConfig] of Object.entries(config.keys ?? {})) {
      const resolved = resolveQuotaNames(keyConfig, config);
      if (resolved?.names.includes(quotaName)) keys.push(name);
    }
    return keys;
  }

  /**
   * Repair a quota bucket by recomputing it from `request_usage` instead of
   * trusting the (potentially drifted) counter. Exact for calendar types and
   * rolling-cost, since those are reconstructable from a bounded time
   * window. Refused for leaky rolling tokens/requests — decay depends on the
   * exact sequence and timing of past writes, which isn't recoverable from
   * request_usage alone.
   */
  async recomputeQuota(
    keyName: string,
    quotaName: string
  ): Promise<{ recomputed: boolean; usage?: number; windowStartMs?: number; reason?: string }> {
    const config = getConfig();
    const def = config.user_quotas?.[quotaName];
    if (!def) return { recomputed: false, reason: 'quota_not_found' };

    if (def.type === 'rolling' && def.limitType !== 'cost') {
      return { recomputed: false, reason: 'unsupported_quota_type' };
    }

    const nowMs = Date.now();
    let windowStartMs: number;
    if (def.type === 'rolling') {
      const durationMs = parseDuration(def.duration);
      if (!durationMs) return { recomputed: false, reason: 'invalid_duration' };
      windowStartMs = this.alignToPeriodStart(nowMs, durationMs);
    } else {
      windowStartMs = this.getWindowStart(def.type, nowMs);
    }

    const owner = def.shared ? SHARED_OWNER : keyName;
    const apiKeys = def.shared ? this.keysAttachingQuota(quotaName, config) : [keyName];
    if (apiKeys.length === 0) apiKeys.push(keyName);

    const ru = this.schema.requestUsage;
    const conditions = [
      inArray(ru.apiKey, apiKeys),
      gte(ru.startTime, windowStartMs),
      eq(ru.responseStatus, 'success'),
      // Non-chat routes (embeddings/images/speech/transcriptions) write
      // request_usage rows with NULL final_attempt_provider/model and never
      // record quota usage on the live path. Exclude them here so recompute
      // repair doesn't inflate the counter with traffic live recording never
      // counted (chat-path rows always set final_attempt_provider).
      isNotNull(ru.finalAttemptProvider),
    ];
    if (def.allowedProviders && def.allowedProviders.length > 0) {
      conditions.push(inArray(ru.finalAttemptProvider, def.allowedProviders));
    }
    if (def.excludedProviders && def.excludedProviders.length > 0) {
      conditions.push(notInArray(ru.finalAttemptProvider, def.excludedProviders));
    }
    if (def.allowedModels && def.allowedModels.length > 0) {
      conditions.push(inArray(ru.finalAttemptModel, def.allowedModels));
    }
    if (def.excludedModels && def.excludedModels.length > 0) {
      conditions.push(notInArray(ru.finalAttemptModel, def.excludedModels));
    }

    let usage: number;
    if (def.limitType === 'requests') {
      const rows = await this.db
        .select({ value: sql<number>`count(*)` })
        .from(ru)
        .where(and(...conditions));
      usage = Number(rows[0]?.value ?? 0);
    } else if (def.limitType === 'cost') {
      const rows = await this.db
        .select({ value: sql<number>`COALESCE(SUM(${ru.costTotal}), 0)` })
        .from(ru)
        .where(and(...conditions));
      usage = Number(rows[0]?.value ?? 0);
    } else {
      const rows = await this.db
        .select({
          value: sql<number>`COALESCE(SUM(
            COALESCE(${ru.tokensInput}, 0) + COALESCE(${ru.tokensOutput}, 0) +
            COALESCE(${ru.tokensReasoning}, 0) + COALESCE(${ru.tokensCached}, 0) +
            COALESCE(${ru.tokensCacheWrite}, 0)
          ), 0)`,
        })
        .from(ru)
        .where(and(...conditions));
      usage = Number(rows[0]?.value ?? 0);
    }

    const nowDb = toDbTimestampMs(nowMs, this.dialect)!;
    const windowStartDb = toDbTimestampMs(windowStartMs, this.dialect);

    await this.db
      .insert(this.schema.quotaState)
      .values({
        keyName: owner,
        quotaName,
        limitType: def.limitType,
        currentUsage: usage,
        lastUpdated: nowDb,
        windowStart: windowStartDb,
      })
      .onConflictDoUpdate({
        target: [this.schema.quotaState.keyName, this.schema.quotaState.quotaName],
        set: {
          limitType: def.limitType,
          currentUsage: usage,
          lastUpdated: nowDb,
          windowStart: windowStartDb,
        },
      });

    return { recomputed: true, usage, windowStartMs };
  }
}
