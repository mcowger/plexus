import { logger } from '../../utils/logger';
import { getCurrentDialect, getDatabase, getSchema } from '../../db/client';
import type { QuotaConfig } from '../../config';
import { loadAllCheckers, getCheckerDefinition, createMeterContext } from './checker-registry';
import type { MeterCheckResult, Meter } from '../../types/meter';
import { toDbTimestampMs } from '../../utils/normalize';
import { eq, desc, gte, and } from 'drizzle-orm';
import { CooldownManager } from '../cooldown-manager';

const DEFAULT_EXHAUSTION_THRESHOLD = 99;

function toMs(val: unknown): number {
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime();
  return 0;
}

function toIso(val: unknown): string {
  return new Date(toMs(val)).toISOString();
}

export class QuotaScheduler {
  private static instance: QuotaScheduler;
  private configs: Map<string, QuotaConfig> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private checkersLoaded = false;
  private db: ReturnType<typeof getDatabase> | null = null;
  private schema: ReturnType<typeof getSchema> | null = null;

  private constructor() {}

  static getInstance(): QuotaScheduler {
    if (!QuotaScheduler.instance) {
      QuotaScheduler.instance = new QuotaScheduler();
    }
    return QuotaScheduler.instance;
  }

  private ensureDb() {
    if (!this.db) {
      this.db = getDatabase();
      this.schema = getSchema();
    }
    return { db: this.db, schema: this.schema! };
  }

  async initialize(quotaConfigs: QuotaConfig[]): Promise<void> {
    if (!this.checkersLoaded) {
      await loadAllCheckers();
      this.checkersLoaded = true;
    }

    for (const config of quotaConfigs) {
      if (!config.enabled) {
        logger.info(`Quota checker '${config.id}' is disabled, skipping`);
        continue;
      }
      if (!getCheckerDefinition(config.type)) {
        logger.error(`Unknown quota checker type '${config.type}' for checker '${config.id}'`);
        continue;
      }
      this.configs.set(config.id, config);
      logger.info(
        `Registered quota checker '${config.id}' (${config.type}) for provider '${config.provider}'`
      );
    }

    for (const [id, config] of this.configs) {
      if (this.intervals.has(id)) continue;
      const intervalMs = config.intervalMinutes * 60 * 1000;
      const intervalId = setInterval(() => this.runCheckNow(id), intervalMs);
      this.intervals.set(id, intervalId);
      logger.info(
        `Scheduled quota checker '${id}' to run every ${config.intervalMinutes} minutes`
      );
      this.runCheckNow(id).catch((error) => {
        logger.error(`Initial quota check failed for '${id}': ${error}`);
      });
    }
  }

  async runCheckNow(checkerId: string): Promise<MeterCheckResult | null> {
    const config = this.configs.get(checkerId);
    if (!config) {
      logger.warn(`Quota checker '${checkerId}' not found`);
      return null;
    }

    const def = getCheckerDefinition(config.type);
    if (!def) {
      logger.warn(`No checker definition for type '${config.type}'`);
      return null;
    }

    logger.debug(`Running quota check for '${checkerId}'`);
    const checkedAt = new Date().toISOString();
    let result: MeterCheckResult;

    try {
      const ctx = createMeterContext(checkerId, config.provider, config.options);
      const meters = await def.check(ctx);
      result = {
        checkerId,
        checkerType: config.type,
        provider: config.provider,
        checkedAt,
        success: true,
        meters,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Quota checker '${checkerId}' threw an exception: ${message}`);
      result = {
        checkerId,
        checkerType: config.type,
        provider: config.provider,
        checkedAt,
        success: false,
        error: message,
        meters: [],
      };
    }

    if (!result.success) {
      logger.warn(`Quota check failed for '${checkerId}': ${result.error ?? 'unknown error'}`);
    }

    await this.persistResult(result);
    await this.applyCooldownsFromResult(result, config);

    return result;
  }

  private async applyCooldownsFromResult(
    result: MeterCheckResult,
    config: QuotaConfig
  ): Promise<void> {
    if (!result.success || result.meters.length === 0) return;

    const exhaustionThreshold =
      (config.options.maxUtilizationPercent as number | undefined) ?? DEFAULT_EXHAUSTION_THRESHOLD;
    const cooldownManager = CooldownManager.getInstance();
    const provider = result.provider;

    let latestResetMs: number | null = null;
    let exhaustedMeterLabel: string | null = null;

    for (const meter of result.meters) {
      const util = meter.utilizationPercent;
      if (typeof util === 'number' && util >= exhaustionThreshold) {
        const resetMs = meter.resetsAt ? new Date(meter.resetsAt).getTime() : null;
        if (resetMs !== null && resetMs > Date.now()) {
          if (latestResetMs === null || resetMs > latestResetMs) {
            latestResetMs = resetMs;
            exhaustedMeterLabel = meter.label;
          }
        }
      }
    }

    if (latestResetMs !== null) {
      const durationMs = Math.max(0, latestResetMs - Date.now());
      logger.info(
        `[quota-scheduler] Provider '${provider}' quota exhausted` +
          ` (meter: ${exhaustedMeterLabel}, threshold: ${exhaustionThreshold}%, checker: ${result.checkerId}).` +
          ` Injecting provider-wide cooldown for ${Math.round(durationMs / 1000)}s.`
      );
      await cooldownManager.markProviderFailure(
        provider,
        '',
        durationMs,
        `quota exhausted (threshold: ${exhaustionThreshold}%) — ${exhaustedMeterLabel}`
      );
    } else {
      const strictestThreshold = this.getStrictestThresholdForProvider(provider);
      if (exhaustionThreshold <= strictestThreshold) {
        await cooldownManager.markProviderSuccess(provider, '');
      } else {
        logger.debug(
          `[quota-scheduler] Checker '${result.checkerId}' sees provider '${provider}' as healthy, ` +
            `but a stricter checker (threshold: ${strictestThreshold}%) may have set the cooldown. Keeping it.`
        );
      }
    }
  }

  private getStrictestThresholdForProvider(provider: string): number {
    let strictest = DEFAULT_EXHAUSTION_THRESHOLD;
    for (const [, config] of this.configs) {
      if (config.provider !== provider) continue;
      const threshold = config.options.maxUtilizationPercent as number | undefined;
      if (threshold !== undefined && threshold < strictest) {
        strictest = threshold;
      }
    }
    return strictest;
  }

  private async persistResult(result: MeterCheckResult): Promise<void> {
    const { db, schema } = this.ensureDb();
    const dialect = getCurrentDialect();
    const checkedAt = toDbTimestampMs(new Date(result.checkedAt), dialect);
    const createdAt = toDbTimestampMs(Date.now(), dialect);

    if (!result.success) {
      try {
        await db.insert(schema.meterSnapshots).values({
          checkerId: result.checkerId,
          checkerType: result.checkerType,
          provider: result.provider,
          meterKey: '_error',
          kind: 'allowance',
          unit: '',
          label: 'Quota check failed',
          utilizationState: 'unknown',
          utilizationPercent: null,
          status: 'ok',
          success: false,
          errorMessage: result.error ?? 'Unknown quota check error',
          checkedAt,
          createdAt,
        });
      } catch (error) {
        logger.error(`Failed to persist quota error for '${result.checkerId}': ${error}`);
      }
      return;
    }

    for (const meter of result.meters) {
      try {
        const util = meter.utilizationPercent;
        const utilizationState =
          util === 'unknown'
            ? 'unknown'
            : util === 'not_applicable'
              ? 'not_applicable'
              : 'reported';
        const utilizationPercent = typeof util === 'number' ? util : null;
        const resetsAt = meter.resetsAt
          ? toDbTimestampMs(new Date(meter.resetsAt), dialect)
          : null;

        await db.insert(schema.meterSnapshots).values({
          checkerId: result.checkerId,
          checkerType: result.checkerType,
          provider: result.provider,
          meterKey: meter.key,
          kind: meter.kind,
          unit: meter.unit,
          label: meter.label,
          group: meter.group ?? null,
          scope: meter.scope ?? null,
          limit: meter.limit ?? null,
          used: meter.used ?? null,
          remaining: meter.remaining ?? null,
          utilizationState,
          utilizationPercent,
          status: meter.status,
          periodValue: meter.periodValue ?? null,
          periodUnit: meter.periodUnit ?? null,
          periodCycle: meter.periodCycle ?? null,
          resetsAt,
          success: true,
          errorMessage: null,
          checkedAt,
          createdAt,
        });
      } catch (error) {
        logger.error(
          `Failed to persist meter '${meter.key}' for '${result.checkerId}': ${error}`
        );
      }
    }
  }

  getCheckerIds(): string[] {
    return Array.from(this.configs.keys());
  }

  // Category is now per-meter (meter.kind); kept for minimal API compat, always undefined
  getCheckerCategory(_checkerId: string): 'balance' | 'rate-limit' | undefined {
    return undefined;
  }

  async getLatestQuota(checkerId: string): Promise<MeterCheckResult | null> {
    try {
      const { db, schema } = this.ensureDb();
      const config = this.configs.get(checkerId);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), 15000);
      });

      const queryPromise = db
        .select()
        .from(schema.meterSnapshots)
        .where(eq(schema.meterSnapshots.checkerId, checkerId))
        .orderBy(desc(schema.meterSnapshots.checkedAt))
        .limit(200);

      const rows = (await Promise.race([queryPromise, timeoutPromise])) as any[];
      if (rows.length === 0) return null;

      const latestMs = toMs(rows[0].checkedAt);
      const latestRows = rows.filter((r: any) => toMs(r.checkedAt) === latestMs);

      const errorRow = latestRows.find((r: any) => !r.success);
      if (errorRow) {
        return {
          checkerId,
          checkerType: config?.type ?? errorRow.checkerType,
          provider: config?.provider ?? errorRow.provider,
          checkedAt: toIso(errorRow.checkedAt),
          success: false,
          error: errorRow.errorMessage ?? 'Unknown error',
          meters: [],
        };
      }

      const meters: Meter[] = latestRows.map((row: any) => {
        const util: Meter['utilizationPercent'] =
          row.utilizationState === 'unknown'
            ? 'unknown'
            : row.utilizationState === 'not_applicable'
              ? 'not_applicable'
              : (row.utilizationPercent ?? 0);
        return {
          key: row.meterKey,
          label: row.label,
          kind: row.kind,
          unit: row.unit,
          group: row.group ?? undefined,
          scope: row.scope ?? undefined,
          limit: row.limit ?? undefined,
          used: row.used ?? undefined,
          remaining: row.remaining ?? undefined,
          utilizationPercent: util,
          status: row.status,
          periodValue: row.periodValue ?? undefined,
          periodUnit: row.periodUnit ?? undefined,
          periodCycle: row.periodCycle ?? undefined,
          resetsAt: row.resetsAt ? toIso(row.resetsAt) : undefined,
        };
      });

      const firstRow = latestRows[0];
      return {
        checkerId,
        checkerType: config?.type ?? firstRow.checkerType,
        provider: config?.provider ?? firstRow.provider,
        checkedAt: toIso(firstRow.checkedAt),
        success: true,
        meters,
      };
    } catch (error) {
      logger.error(`Failed to get latest quota for '${checkerId}': ${error}`);
      throw error;
    }
  }

  async getQuotaHistory(checkerId: string, meterKey?: string, since?: number): Promise<any[]> {
    try {
      const { db, schema } = this.ensureDb();
      const dialect = getCurrentDialect();
      const conditions = [eq(schema.meterSnapshots.checkerId, checkerId)];

      if (meterKey) {
        conditions.push(eq(schema.meterSnapshots.meterKey, meterKey));
      }
      if (since) {
        conditions.push(
          gte(schema.meterSnapshots.checkedAt, toDbTimestampMs(since, dialect) as any)
        );
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), 15000);
      });

      const queryPromise = db
        .select()
        .from(schema.meterSnapshots)
        .where(and(...conditions))
        .orderBy(desc(schema.meterSnapshots.checkedAt))
        .limit(1000);

      return (await Promise.race([queryPromise, timeoutPromise])) as any[];
    } catch (error) {
      logger.error(`Failed to get quota history for '${checkerId}': ${error}`);
      throw error;
    }
  }

  stop(): void {
    for (const [id, intervalId] of this.intervals) {
      clearInterval(intervalId);
      logger.info(`Stopped quota checker '${id}'`);
    }
    this.intervals.clear();
    this.configs.clear();
  }

  async reload(quotaConfigs: QuotaConfig[]): Promise<void> {
    if (!this.checkersLoaded) {
      await loadAllCheckers();
      this.checkersLoaded = true;
    }

    const existingIds = new Set(this.configs.keys());
    const newConfigs = quotaConfigs.filter((c) => !existingIds.has(c.id) && c.enabled);

    for (const config of newConfigs) {
      if (!getCheckerDefinition(config.type)) {
        logger.error(`Unknown quota checker type '${config.type}' for checker '${config.id}'`);
        continue;
      }
      this.configs.set(config.id, config);
      logger.info(
        `Registered quota checker '${config.id}' (${config.type}) for provider '${config.provider}'`
      );

      const intervalMs = config.intervalMinutes * 60 * 1000;
      const intervalId = setInterval(() => this.runCheckNow(config.id), intervalMs);
      this.intervals.set(config.id, intervalId);
      logger.info(
        `Scheduled quota checker '${config.id}' to run every ${config.intervalMinutes} minutes`
      );
      this.runCheckNow(config.id).catch((error) => {
        logger.error(`Initial quota check failed for '${config.id}' on reload: ${error}`);
      });
    }

    const loadedIds = new Set(quotaConfigs.filter((c) => c.enabled).map((c) => c.id));
    for (const id of existingIds) {
      if (!loadedIds.has(id)) {
        const intervalId = this.intervals.get(id);
        if (intervalId) {
          clearInterval(intervalId);
          this.intervals.delete(id);
        }
        this.configs.delete(id);
        logger.info(`Removed quota checker '${id}' on reload`);
      }
    }
  }
}
