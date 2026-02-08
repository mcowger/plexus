import { logger } from '../../utils/logger';
import { getDatabase, getSchema } from '../../db/client';
import { QuotaCheckerFactory } from './quota-checker-factory';
import { QuotaEstimator } from './quota-estimator';
import type { QuotaCheckerConfig, QuotaCheckResult, QuotaChecker } from '../../types/quota';
import { and, eq, gte, desc } from 'drizzle-orm';

export class QuotaScheduler {
  private static instance: QuotaScheduler;
  private checkers: Map<string, QuotaChecker> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
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
    return { db: this.db, schema: this.schema };
  }

  async initialize(quotaConfigs: QuotaCheckerConfig[]): Promise<void> {
    for (const config of quotaConfigs) {
      if (!config.enabled) {
        logger.info(`Quota checker '${config.id}' is disabled, skipping`);
        continue;
      }

      try {
        const checker = QuotaCheckerFactory.createChecker(config.type, config);
        this.checkers.set(config.id, checker);
        logger.info(`Registered quota checker '${config.id}' (${config.type}) for provider '${config.provider}'`);
      } catch (error) {
        logger.error(`Failed to register quota checker '${config.id}': ${error}`);
      }
    }

    for (const [id, checker] of this.checkers) {
      try {
        await this.runCheckNow(id);
        const intervalMs = checker.config.intervalMinutes * 60 * 1000;
        const intervalId = setInterval(() => this.runCheckNow(id), intervalMs);
        this.intervals.set(id, intervalId);
        logger.info(`Scheduled quota checker '${id}' to run every ${checker.config.intervalMinutes} minutes`);
      } catch (error) {
        logger.error(`Failed to schedule quota checker '${id}': ${error}`);
      }
    }
  }

  async runCheckNow(checkerId: string): Promise<QuotaCheckResult | null> {
    const checker = this.checkers.get(checkerId);
    if (!checker) {
      logger.warn(`Quota checker '${checkerId}' not found`);
      return null;
    }

    logger.debug(`Running quota check for '${checkerId}'`);
    let result: QuotaCheckResult;

    try {
      result = await checker.checkQuota();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Quota checker '${checkerId}' threw an exception: ${message}`);

      result = {
        provider: checker.config.provider,
        checkerId,
        checkedAt: new Date(),
        success: false,
        error: message,
      };
    }

    if (!result.success) {
      logger.warn(`Quota check failed for '${checkerId}': ${result.error ?? 'unknown error'}`);
    }

    await this.persistResult(result);

    return result;
  }

  private async persistResult(result: QuotaCheckResult): Promise<void> {
    const { db, schema } = this.ensureDb();
    const checkedAt = result.checkedAt.getTime();
    const now = Date.now();

    if (!result.success) {
      try {
        await db.insert(schema.quotaSnapshots).values({
          provider: result.provider,
          checkerId: result.checkerId,
          groupId: null,
          windowType: 'custom',
          checkedAt,
          limit: null,
          used: null,
          remaining: null,
          utilizationPercent: null,
          unit: null,
          resetsAt: null,
          status: null,
          description: 'Quota check failed',
          success: 0,
          errorMessage: result.error ?? 'Unknown quota check error',
          createdAt: now,
        });
      } catch (error) {
        logger.error(`Failed to persist quota error for '${result.checkerId}': ${error}`);
      }
      return;
    }

    if (result.windows) {
      for (const window of result.windows) {
        try {
            await db.insert(schema.quotaSnapshots).values({
              provider: result.provider,
              checkerId: result.checkerId,
              groupId: null,
              windowType: window.windowType,
              checkedAt,
              limit: window.limit,
              used: window.used,
              remaining: window.remaining,
              utilizationPercent: window.utilizationPercent,
              unit: window.unit,
              resetsAt: window.resetsAt?.getTime() ?? null,
              status: window.status ?? null,
              description: window.description ?? null,
              success: 1,
              errorMessage: null,
              createdAt: now,
            });
        } catch (error) {
          logger.error(`Failed to persist quota window for '${result.checkerId}': ${error}`);
        }
      }
    }

    if (result.groups) {
      for (const group of result.groups) {
        for (const window of group.windows) {
          try {
            await db.insert(schema.quotaSnapshots).values({
              provider: result.provider,
              checkerId: result.checkerId,
              groupId: group.groupId,
              windowType: window.windowType,
              checkedAt,
              limit: window.limit,
              used: window.used,
              remaining: window.remaining,
              utilizationPercent: window.utilizationPercent,
              unit: window.unit,
              resetsAt: window.resetsAt?.getTime() ?? null,
              status: window.status ?? null,
              description: window.description ?? null,
              success: 1,
              errorMessage: null,
              createdAt: now,
            });
          } catch (error) {
            logger.error(`Failed to persist quota group '${group.groupId}' for '${result.checkerId}': ${error}`);
          }
        }
      }
    }
  }

  getCheckerIds(): string[] {
    return Array.from(this.checkers.keys());
  }

  async getLatestQuota(checkerId: string) {
    try {
      const { db, schema } = this.ensureDb();
      
      // Create a timeout promise to prevent indefinite hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), 15000);
      });
      
      const queryPromise = db
        .select()
        .from(schema.quotaSnapshots)
        .where(eq(schema.quotaSnapshots.checkerId, checkerId))
        .orderBy(desc(schema.quotaSnapshots.checkedAt))
        .limit(100);
      
      const results = await Promise.race([queryPromise, timeoutPromise]) as any[];
      
      // Get only the most recent snapshot per window type
      const latestByWindowType = new Map<string, any>();
      for (const snapshot of results) {
        const existing = latestByWindowType.get(snapshot.windowType);
        if (!existing || snapshot.checkedAt > existing.checkedAt) {
          latestByWindowType.set(snapshot.windowType, snapshot);
        }
      }
      
      // Add resetInSeconds calculation and quota estimation
      const now = Date.now();
      return Array.from(latestByWindowType.values()).map(snapshot => {
        const resetInSeconds = snapshot.resetsAt ? Math.max(0, Math.floor((snapshot.resetsAt - now) / 1000)) : null;
        
        // Calculate estimation for this window type
        const estimation = QuotaEstimator.estimateUsageAtReset(
          checkerId,
          snapshot.windowType,
          snapshot.used,
          snapshot.limit,
          snapshot.resetsAt,
          results // Pass all historical data
        );
        
        return {
          ...snapshot,
          resetInSeconds,
          estimation,
        };
      });
    } catch (error) {
      logger.error(`Failed to get latest quota for '${checkerId}': ${error}`);
      throw error;
    }
  }

  async getQuotaHistory(checkerId: string, windowType?: string, since?: number) {
    try {
      const { db, schema } = this.ensureDb();
      let conditions = [eq(schema.quotaSnapshots.checkerId, checkerId)];

      if (windowType) {
        conditions.push(eq(schema.quotaSnapshots.windowType, windowType));
      }

      if (since) {
        conditions.push(gte(schema.quotaSnapshots.checkedAt, since));
      }

      // Create a timeout promise to prevent indefinite hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), 15000);
      });

      const queryPromise = db
        .select()
        .from(schema.quotaSnapshots)
        .where(and(...conditions))
        .orderBy(desc(schema.quotaSnapshots.checkedAt))
        .limit(1000);

      const results = await Promise.race([queryPromise, timeoutPromise]);
      return results as any[];
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
    this.checkers.clear();
  }
}
