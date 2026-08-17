import { logger } from '../../utils/logger';
import { getCurrentDialect, getDatabase, getSchema } from '../../db/client';
import type { QuotaConfig } from '../../config';
import { loadAllCheckers, getCheckerDefinition, createMeterContext } from './checker-registry';
import type { MeterCheckResult, Meter } from '../../types/meter';
import { toDbTimestampMs } from '../../utils/normalize';
import { eq, desc, gte, and } from 'drizzle-orm';
import { CooldownManager } from '../runtime/cooldown-manager';
import { INDEFINITE_COOLDOWN_MS } from '@plexus/shared';

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
      logger.info(`Scheduled quota checker '${id}' to run every ${config.intervalMinutes} minutes`);
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

  private getExhaustionThreshold(config: QuotaConfig): number {
    if (
      typeof config.options.maxUtilizationPercent === 'number' &&
      config.options.maxUtilizationPercent > 0
    ) {
      return config.options.maxUtilizationPercent;
    }
    if (
      config.options.allow100PercentUtilization === true ||
      config.options.allow_100_percent_utilization === true
    ) {
      return 100;
    }
    return DEFAULT_EXHAUSTION_THRESHOLD;
  }

  private async applyCooldownsFromResult(
    result: MeterCheckResult,
    config: QuotaConfig
  ): Promise<void> {
    if (!result.success || result.meters.length === 0) return;

    const exhaustionThreshold = this.getExhaustionThreshold(config);
    const cooldownManager = CooldownManager.getInstance();
    const provider = result.provider;

    let isExhausted = false;
    let latestResetMs: number | null = null;
    let exhaustedMeterLabel: string | null = null;

    for (const meter of result.meters) {
      const util = meter.utilizationPercent;
      const utilExhausted = typeof util === 'number' && util >= exhaustionThreshold;
      const statusExhausted = meter.status === 'exhausted';

      if (utilExhausted || statusExhausted) {
        isExhausted = true;
        if (!exhaustedMeterLabel) {
          exhaustedMeterLabel = meter.label;
        }
        const resetMs = meter.resetsAt ? new Date(meter.resetsAt).getTime() : null;
        if (resetMs !== null && resetMs > Date.now()) {
          if (latestResetMs === null || resetMs > latestResetMs) {
            latestResetMs = resetMs;
            exhaustedMeterLabel = meter.label;
          }
        }
      }
    }

    if (isExhausted) {
      const durationMs =
        latestResetMs !== null ? Math.max(0, latestResetMs - Date.now()) : INDEFINITE_COOLDOWN_MS;

      logger.info(
        `Provider '${provider}' quota exhausted` +
          ` (meter: ${exhaustedMeterLabel}, threshold: ${exhaustionThreshold}%, checker: ${result.checkerId}).` +
          (latestResetMs !== null
            ? ` Injecting provider-wide cooldown for ${Math.round(durationMs / 1000)}s.`
            : ` Injecting provider-wide indefinite cooldown until reset/balance recovery.`)
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
          `Checker '${result.checkerId}' sees provider '${provider}' as healthy, ` +
            `but a stricter checker (threshold: ${strictestThreshold}%) may have set the cooldown. Keeping it.`
        );
      }
    }
  }

  private getStrictestThresholdForProvider(provider: string): number {
    let strictest = 100;
    let found = false;
    for (const [, config] of this.configs) {
      if (config.provider !== provider) continue;
      found = true;
      const threshold = this.getExhaustionThreshold(config);
      if (threshold < strictest) {
        strictest = threshold;
      }
    }
    return found ? strictest : DEFAULT_EXHAUSTION_THRESHOLD;
  }

  private async persistResult(result: MeterCheckResult): Promise<void> {
    const { db, schema } = this.ensureDb();
    const dialect = getCurrentDialect();
    const checkedAt = toDbTimestampMs(new Date(result.checkedAt), dialect);
    const createdAt = toDbTimestampMs(Date.now(), dialect);

    const sentinelValues = result.success
      ? {
          meterKey: '_empty',
          kind: 'allowance',
          unit: '',
          label: 'No meters',
          utilizationState: 'not_applicable',
          utilizationPercent: null,
          status: 'ok',
          success: true,
          errorMessage: null,
        }
      : {
          meterKey: '_error',
          kind: 'allowance',
          unit: '',
          label: 'Quota check failed',
          utilizationState: 'unknown',
          utilizationPercent: null,
          status: 'ok',
          success: false,
          errorMessage: result.error ?? 'Unknown quota check error',
        };

    if (!result.success || result.meters.length === 0) {
      try {
        await db.insert(schema.meterSnapshots).values({
          checkerId: result.checkerId,
          checkerType: result.checkerType,
          provider: result.provider,
          checkedAt,
          createdAt,
          ...sentinelValues,
        });
      } catch (error) {
        logger.error(`Failed to persist quota result for '${result.checkerId}': ${error}`);
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
        const resetsAt = meter.resetsAt ? toDbTimestampMs(new Date(meter.resetsAt), dialect) : null;

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
        logger.error(`Failed to persist meter '${meter.key}' for '${result.checkerId}': ${error}`);
      }
    }
  }

  getCheckerIds(): string[] {
    return Array.from(this.configs.keys());
  }

  isInitialized(): boolean {
    return this.checkersLoaded;
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

      const meters: Meter[] = latestRows
        .filter((r: any) => r.meterKey !== '_empty' && r.meterKey !== '_error')
        .map((row: any) => {
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
    const activeConfigs = quotaConfigs.filter((c) => c.enabled);
    const activeIds = new Set(activeConfigs.map((c) => c.id));

    for (const id of existingIds) {
      if (!activeIds.has(id)) {
        const intervalId = this.intervals.get(id);
        if (intervalId) {
          clearInterval(intervalId);
          this.intervals.delete(id);
        }
        this.configs.delete(id);
        logger.info(`Removed quota checker '${id}' on reload`);
      }
    }

    for (const config of activeConfigs) {
      if (!getCheckerDefinition(config.type)) {
        logger.error(`Unknown quota checker type '${config.type}' for checker '${config.id}'`);
        continue;
      }

      const existingConfig = this.configs.get(config.id);
      const intervalChanged = existingConfig?.intervalMinutes !== config.intervalMinutes;

      this.configs.set(config.id, config);

      if (existingConfig && !intervalChanged) {
        logger.debug(`Updated quota checker '${config.id}' on reload`);
        continue;
      }

      if (existingConfig && intervalChanged) {
        const intervalId = this.intervals.get(config.id);
        if (intervalId) clearInterval(intervalId);
        this.intervals.delete(config.id);
        logger.info(
          `Rescheduled quota checker '${config.id}' from ${existingConfig.intervalMinutes} to ${config.intervalMinutes} minutes`
        );
      } else {
        logger.info(
          `Registered quota checker '${config.id}' (${config.type}) for provider '${config.provider}'`
        );
      }

      if (this.intervals.has(config.id)) continue;

      logger.info(
        `Scheduled quota checker '${config.id}' to run every ${config.intervalMinutes} minutes`
      );

      const intervalMs = config.intervalMinutes * 60 * 1000;
      const intervalId = setInterval(() => this.runCheckNow(config.id), intervalMs);
      this.intervals.set(config.id, intervalId);

      if (!existingConfig) {
        this.runCheckNow(config.id).catch((error) => {
          logger.error(`Initial quota check failed for '${config.id}' on reload: ${error}`);
        });
      }
    }
  }
}
