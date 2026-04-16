import { eq, sql } from 'drizzle-orm';
import parseDuration from 'parse-duration';
import { logger } from '../../utils/logger';
import { getConfig, QuotaDefinition, KeyConfig } from '../../config';
import { getDatabase, getCurrentDialect } from '../../db/client';
import { toDbTimestampMs } from '../../utils/normalize';
import * as sqliteSchema from '../../../drizzle/schema/sqlite';
import * as postgresSchema from '../../../drizzle/schema/postgres';

export interface QuotaCheckResult {
  allowed: boolean;
  quotaName: string;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetsAt: Date | null;
  limitType: 'requests' | 'tokens' | 'cost';
}

export interface UsageRecord {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCached?: number | null;
  tokensCacheWrite?: number | null;
  tokensReasoning?: number | null;
  costTotal?: number | null;
}

export class QuotaEnforcer {
  private db: ReturnType<typeof getDatabase>;
  private dialect: 'sqlite' | 'postgres';

  constructor() {
    this.db = getDatabase();
    this.dialect = getCurrentDialect() === 'postgres' ? 'postgres' : 'sqlite';
  }

  /**
   * Convert a DB-returned value for lastUpdated/windowStart to a Date.
   * PostgreSQL bigint(mode:'number') returns epoch ms as a number.
   * SQLite integer(mode:'timestamp_ms') returns a Date object.
   */
  private fromDbTimestamp(value: Date | number | null): Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    return new Date(value as number);
  }

  /**
   * Check if the key should be allowed to make a request.
   * Returns null if no quota is assigned to the key.
   */
  async checkQuota(keyName: string): Promise<QuotaCheckResult | null> {
    const config = getConfig();

    // Get key configuration
    const keyConfig = config.keys?.[keyName];
    if (!keyConfig) {
      logger.debug(`[QuotaEnforcer] Key ${keyName} not found`);
      return null;
    }

    // Check if key has a quota assigned
    const quotaName = keyConfig.quota;
    if (!quotaName) {
      logger.debug(`[QuotaEnforcer] No quota assigned to key ${keyName}`);
      return null;
    }

    // Get quota definition
    const quotaDef = config.user_quotas?.[quotaName];
    if (!quotaDef) {
      logger.warn(`[QuotaEnforcer] Quota definition ${quotaName} not found for key ${keyName}`);
      return null;
    }

    const schema = getCurrentDialect() === 'postgres' ? postgresSchema : sqliteSchema;
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);

    // Load current state from database
    const existingState = await this.db
      .select()
      .from(schema.quotaState)
      .where(eq(schema.quotaState.keyName, keyName))
      .limit(1);

    if (existingState.length > 0) {
      const s = existingState[0]!;
      logger.debug(
        `[QuotaEnforcer] checkQuota DB state for ${keyName}: currentUsage=${s.currentUsage}, windowStart=${JSON.stringify(s.windowStart)}, lastUpdated=${JSON.stringify(s.lastUpdated)}, quotaName=${s.quotaName}, limitType=${s.limitType}`
      );
    } else {
      logger.debug(`[QuotaEnforcer] checkQuota: no DB state found for ${keyName}`);
    }

    let currentUsage: number;
    let windowStartDate: Date | null = null;
    let lastUpdatedDate: Date;

    if (existingState.length === 0) {
      // No state exists yet, start fresh
      currentUsage = 0;
      lastUpdatedDate = nowDate;

      // For calendar quotas, set window start
      if (quotaDef.type === 'daily' || quotaDef.type === 'weekly' || quotaDef.type === 'monthly') {
        windowStartDate = new Date(this.getWindowStart(quotaDef.type));
      }
      // For rolling cost quotas, align window start to calendar boundary
      else if (quotaDef.type === 'rolling' && quotaDef.limitType === 'cost') {
        const durationMs = parseDuration(quotaDef.duration);
        if (durationMs) {
          const alignedStart = this.alignToPeriodStart(nowMs, durationMs);
          windowStartDate = new Date(alignedStart);
        }
      }
    } else {
      const state = existingState[0];
      const storedLimitType = state!.limitType as 'requests' | 'tokens' | 'cost';
      const storedQuotaName = state!.quotaName as string;

      // Check if quota name has changed (key assigned to different quota)
      if (storedQuotaName !== quotaName) {
        logger.info(
          `[QuotaEnforcer] Quota name changed for ${keyName} from '${storedQuotaName}' to '${quotaName}'. ` +
            `Resetting usage — persisting to DB.`
        );
        currentUsage = 0;
        lastUpdatedDate = nowDate;
        windowStartDate = null;

        // For calendar quotas, set new window start
        if (
          quotaDef.type === 'daily' ||
          quotaDef.type === 'weekly' ||
          quotaDef.type === 'monthly'
        ) {
          windowStartDate = new Date(this.getWindowStart(quotaDef.type));
        }
        // For rolling cost quotas, align window start to calendar boundary
        else if (quotaDef.type === 'rolling' && quotaDef.limitType === 'cost') {
          const durationMs = parseDuration(quotaDef.duration);
          if (durationMs) {
            const alignedStart = this.alignToPeriodStart(nowMs, durationMs);
            windowStartDate = new Date(alignedStart);
          }
        }

        // Persist the reset to DB
        await this.db
          .update(schema.quotaState)
          .set({
            quotaName,
            currentUsage: 0,
            windowStart: toDbTimestampMs(windowStartDate, this.dialect),
            lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
          })
          .where(eq(schema.quotaState.keyName, keyName));
        // Check if quota definition has changed (e.g., requests -> tokens)
      } else if (storedLimitType !== quotaDef.limitType) {
        logger.info(
          `[QuotaEnforcer] Quota ${quotaName} limitType changed from ${storedLimitType} to ${quotaDef.limitType}. ` +
            `Resetting usage for ${keyName} — persisting to DB.`
        );
        currentUsage = 0;
        lastUpdatedDate = nowDate;
        windowStartDate = null;

        // For calendar quotas, set new window start
        if (
          quotaDef.type === 'daily' ||
          quotaDef.type === 'weekly' ||
          quotaDef.type === 'monthly'
        ) {
          windowStartDate = new Date(this.getWindowStart(quotaDef.type));
        }

        // Persist the reset to DB
        await this.db
          .update(schema.quotaState)
          .set({
            limitType: quotaDef.limitType,
            currentUsage: 0,
            windowStart: toDbTimestampMs(windowStartDate, this.dialect),
            lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
          })
          .where(eq(schema.quotaState.keyName, keyName));
      } else {
        // Quota definition unchanged, proceed normally
        currentUsage = state!.currentUsage;
        lastUpdatedDate = this.fromDbTimestamp(state!.lastUpdated)!;
        windowStartDate = this.fromDbTimestamp(state!.windowStart);

        // Handle calendar quota reset
        if (
          quotaDef.type === 'daily' ||
          quotaDef.type === 'weekly' ||
          quotaDef.type === 'monthly'
        ) {
          const expectedWindowStart = this.getWindowStart(quotaDef.type);
          logger.debug(
            `[QuotaEnforcer] checkQuota calendar check for ${keyName}: windowStartFromDB=${windowStartDate?.getTime()}, expectedWindowStart=${expectedWindowStart}, match=${windowStartDate?.getTime() === expectedWindowStart}`
          );
          if (!windowStartDate || windowStartDate.getTime() !== expectedWindowStart) {
            // Window has reset — persist the reset to the DB so recordUsage
            // doesn't keep accumulating on top of stale values
            logger.debug(
              `[QuotaEnforcer] Calendar quota ${quotaName} for ${keyName} reset — persisting to DB`
            );
            currentUsage = 0;
            windowStartDate = new Date(expectedWindowStart);
            lastUpdatedDate = nowDate;

            await this.db
              .update(schema.quotaState)
              .set({
                currentUsage: 0,
                windowStart: toDbTimestampMs(windowStartDate, this.dialect)!,
                lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
              })
              .where(eq(schema.quotaState.keyName, keyName));
          }
        } else if (quotaDef.type === 'rolling') {
          // Calculate leak for rolling quotas
          const durationMs = parseDuration(quotaDef.duration);
          if (!durationMs) {
            logger.warn(
              `[QuotaEnforcer] Invalid duration '${quotaDef.duration}' for rolling quota ${quotaName}. ` +
                `Cannot calculate quota leak. Allowing request (fail-open). ` +
                `Please fix the duration in your config (e.g., '1h', '30m', '1d').`
            );
            return null;
          }

          const elapsedMs = nowMs - lastUpdatedDate.getTime();

          // Cost quotas use cumulative spending (no leak), reset when window expires
          if (quotaDef.limitType === 'cost') {
            // Check if the rolling window has expired
            // For cost, we track when the spending window started via windowStartDate
            if (!windowStartDate || elapsedMs >= durationMs) {
              // Window expired or not set - reset and persist to DB
              const alignedStart = this.alignToPeriodStart(nowMs, durationMs);
              logger.debug(
                `[QuotaEnforcer] Rolling cost quota ${quotaName} for ${keyName} reset (window expired), aligned to ${new Date(alignedStart).toISOString()} — persisting to DB`
              );
              currentUsage = 0;
              windowStartDate = new Date(alignedStart);
              lastUpdatedDate = nowDate;

              await this.db
                .update(schema.quotaState)
                .set({
                  currentUsage: 0,
                  windowStart: toDbTimestampMs(windowStartDate, this.dialect)!,
                  lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
                })
                .where(eq(schema.quotaState.keyName, keyName));
            }
            // Otherwise keep accumulating - no leak for cost
          } else {
            // Tokens and requests use leaky bucket
            const leakRate = quotaDef.limit / durationMs;
            const leaked = elapsedMs * leakRate;

            currentUsage = Math.max(0, currentUsage - leaked);
            lastUpdatedDate = nowDate;
          }
        }
      }
    }

    // Check if quota exceeded
    const allowed = currentUsage < quotaDef.limit;
    const remaining = Math.max(0, quotaDef.limit - currentUsage);

    // Calculate resetsAt
    let resetsAt: Date | null = null;
    if (quotaDef.type === 'rolling') {
      const durationMs = parseDuration(quotaDef.duration);
      if (durationMs) {
        if (quotaDef.limitType === 'cost' && windowStartDate) {
          // For cost, reset is when the window expires
          resetsAt = new Date(windowStartDate.getTime() + durationMs);
        } else {
          // For tokens/requests, estimate when current usage will fully leak out
          const timeToLeakAll = (currentUsage / quotaDef.limit) * durationMs;
          resetsAt = new Date(nowMs + timeToLeakAll);
        }
      } else {
        logger.warn(
          `[QuotaEnforcer] Cannot calculate resetsAt for quota ${quotaName}: invalid duration '${quotaDef.duration}'`
        );
      }
    } else if (quotaDef.type === 'daily') {
      // Reset at next UTC midnight
      const tomorrow = new Date(nowMs);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      resetsAt = tomorrow;
    } else if (quotaDef.type === 'monthly') {
      // Reset at 00:00 UTC on the 1st of next month
      const nowDateObj = new Date(nowMs);
      const nextMonth = new Date(
        Date.UTC(nowDateObj.getUTCFullYear(), nowDateObj.getUTCMonth() + 1, 1, 0, 0, 0, 0)
      );
      resetsAt = nextMonth;
    } else if (quotaDef.type === 'weekly') {
      // Reset at next UTC Sunday midnight
      const nowDateObj = new Date(nowMs);
      const daysUntilSunday = 7 - nowDateObj.getUTCDay();
      const nextSunday = new Date(nowMs);
      nextSunday.setUTCDate(nowDateObj.getUTCDate() + daysUntilSunday);
      nextSunday.setUTCHours(0, 0, 0, 0);
      resetsAt = nextSunday;
    }

    // Round for tokens/requests, preserve precision for cost
    const displayUsage = quotaDef.limitType === 'cost' ? currentUsage : Math.round(currentUsage);
    const displayRemaining = quotaDef.limitType === 'cost' ? remaining : Math.round(remaining);

    const result: QuotaCheckResult = {
      allowed,
      quotaName,
      currentUsage: displayUsage,
      limit: quotaDef.limit,
      remaining: displayRemaining,
      resetsAt,
      limitType: quotaDef.limitType,
    };

    logger.debug(
      `[QuotaEnforcer] Quota check result for ${keyName}: currentUsage=${result.currentUsage}, remaining=${result.remaining}, allowed=${result.allowed}`
    );
    logger.debug(`[QuotaEnforcer] Quota check for ${keyName}:`, result);

    return result;
  }

  /**
   * Records actual usage after request completes.
   */
  async recordUsage(keyName: string, usageRecord: UsageRecord): Promise<void> {
    const config = getConfig();

    logger.debug(
      `[QuotaEnforcer] recordUsage called for ${keyName}: costTotal=${usageRecord.costTotal}, tokensInput=${usageRecord.tokensInput}, tokensOutput=${usageRecord.tokensOutput}`
    );

    // Get key configuration
    const keyConfig = config.keys?.[keyName];
    if (!keyConfig?.quota) {
      logger.debug(`[QuotaEnforcer] recordUsage: no quota assigned for key ${keyName}, skipping`);
      return; // No quota assigned, nothing to record
    }

    // Get quota definition
    const quotaDef = config.user_quotas?.[keyConfig.quota];
    if (!quotaDef) {
      logger.debug(
        `[QuotaEnforcer] recordUsage: quota definition ${keyConfig.quota} not found for key ${keyName}, skipping`
      );
      return;
    }

    // Calculate usage value based on limitType
    let usageValue: number;
    if (quotaDef.limitType === 'requests') {
      usageValue = 1;
    } else if (quotaDef.limitType === 'cost') {
      // cost: use costTotal directly
      usageValue = usageRecord.costTotal || 0;
      logger.debug(
        `[QuotaEnforcer] recordUsage cost calculation: costTotal=${usageRecord.costTotal}, usageValue=${usageValue}`
      );
    } else {
      // tokens: sum of input + output
      usageValue =
        (usageRecord.tokensInput || 0) +
        (usageRecord.tokensOutput || 0) +
        (usageRecord.tokensReasoning || 0) +
        (usageRecord.tokensCached || 0) +
        (usageRecord.tokensCacheWrite || 0);
    }

    const schema = getCurrentDialect() === 'postgres' ? postgresSchema : sqliteSchema;
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);

    // Get current state to check if we need to update or insert
    const existingState = await this.db
      .select()
      .from(schema.quotaState)
      .where(eq(schema.quotaState.keyName, keyName))
      .limit(1);

    if (existingState.length === 0) {
      // Insert new state
      let windowStartDate: Date | null = null;
      if (quotaDef.type === 'daily' || quotaDef.type === 'weekly' || quotaDef.type === 'monthly') {
        windowStartDate = new Date(this.getWindowStart(quotaDef.type));
      } else if (quotaDef.type === 'rolling' && quotaDef.limitType === 'cost') {
        // Rolling cost quotas need a window start to track when the window expires
        // Align to period start for predictable reset times
        const durationMs = parseDuration(quotaDef.duration);
        const alignedStart = durationMs ? this.alignToPeriodStart(nowMs, durationMs) : nowMs;
        windowStartDate = new Date(alignedStart);
      }

      await this.db.insert(schema.quotaState).values({
        keyName,
        quotaName: keyConfig.quota,
        limitType: quotaDef.limitType,
        currentUsage: usageValue,
        lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
        windowStart: toDbTimestampMs(windowStartDate, this.dialect),
      });
    } else if (existingState[0]) {
      // Update existing state with leak calculation for rolling quotas
      const state = existingState[0];
      const storedLimitType = state.limitType as 'requests' | 'tokens' | 'cost';
      const storedQuotaName = state.quotaName as string;

      // Check if quota name or limitType has changed - if so, start fresh
      let newUsage: number;
      if (storedQuotaName !== keyConfig.quota) {
        logger.debug(
          `[QuotaEnforcer] Quota name changed for ${keyName} from '${storedQuotaName}' to '${keyConfig.quota}' in recordUsage`
        );
        newUsage = usageValue; // Start fresh with just this request's usage
      } else if (storedLimitType !== quotaDef.limitType) {
        logger.debug(
          `[QuotaEnforcer] Quota ${keyConfig.quota} limitType changed from ${storedLimitType} to ${quotaDef.limitType} in recordUsage`
        );
        newUsage = usageValue; // Start fresh with just this request's usage
      } else {
        newUsage = state.currentUsage + usageValue;

        if (quotaDef.type === 'rolling') {
          const durationMs = parseDuration(quotaDef.duration);
          if (durationMs) {
            const lastUpdatedDate = this.fromDbTimestamp(state.lastUpdated)!;
            const elapsedMs = nowMs - lastUpdatedDate.getTime();

            // Cost quotas use cumulative spending (no leak), reset when window expires
            if (quotaDef.limitType === 'cost') {
              const windowStart = this.fromDbTimestamp(state.windowStart);
              // Check if window has expired
              if (!windowStart || elapsedMs >= durationMs) {
                // Window expired - start fresh with just this request's usage
                logger.debug(
                  `[QuotaEnforcer] Rolling cost quota window expired for ${keyName}, resetting`
                );
                newUsage = usageValue;
                // Update windowStart below
              }
              // Otherwise keep accumulating - no leak for cost
            } else {
              // Tokens and requests use leaky bucket
              const leakRate = quotaDef.limit / durationMs;
              const leaked = elapsedMs * leakRate;
              newUsage = Math.max(0, state.currentUsage - leaked) + usageValue;
            }
          } else {
            logger.warn(
              `[QuotaEnforcer] Invalid duration '${quotaDef.duration}' for rolling quota ${keyConfig.quota}. ` +
                `Recording usage without leak calculation. Usage will accumulate without decay. ` +
                `Please fix the duration in your config (e.g., '1h', '30m', '1d').`
            );
          }
        }
      }

      // Prepare update values
      const updateValues: Record<string, unknown> = {
        quotaName: keyConfig.quota,
        limitType: quotaDef.limitType,
        currentUsage: newUsage,
        lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
      };

      // For rolling cost quotas, also update windowStart if needed
      if (quotaDef.type === 'rolling' && quotaDef.limitType === 'cost') {
        const durationMs = parseDuration(quotaDef.duration);
        const lastUpdatedDate = this.fromDbTimestamp(state.lastUpdated)!;
        const elapsedMs = nowMs - lastUpdatedDate.getTime();
        const windowStart = this.fromDbTimestamp(state.windowStart);

        if (!windowStart || elapsedMs >= (durationMs || 0)) {
          // Window expired or not set - set new window start aligned to period
          const alignedStart = durationMs ? this.alignToPeriodStart(nowMs, durationMs) : nowMs;
          updateValues.windowStart = toDbTimestampMs(new Date(alignedStart), this.dialect);
        }
      }

      // For calendar quotas, update windowStart to current period if stale
      if (quotaDef.type === 'daily' || quotaDef.type === 'weekly' || quotaDef.type === 'monthly') {
        const expectedWindowStart = this.getWindowStart(quotaDef.type);
        const currentWindowStart = this.fromDbTimestamp(state.windowStart);
        if (!currentWindowStart || currentWindowStart.getTime() !== expectedWindowStart) {
          // Window has rolled over since last update
          updateValues.windowStart = toDbTimestampMs(new Date(expectedWindowStart), this.dialect)!;
          // Reset usage to just this request since the old window is done
          updateValues.currentUsage = usageValue;
        }
      }

      await this.db
        .update(schema.quotaState)
        .set(updateValues)
        .where(eq(schema.quotaState.keyName, keyName));
    }

    logger.debug(
      `[QuotaEnforcer] Recorded ${usageValue} ${quotaDef.limitType} usage for ${keyName}`
    );
  }

  /**
   * Admin method to reset quota to zero.
   */
  async clearQuota(keyName: string): Promise<void> {
    const schema = getCurrentDialect() === 'postgres' ? postgresSchema : sqliteSchema;
    const nowDate = new Date();

    await this.db
      .update(schema.quotaState)
      .set({
        currentUsage: 0,
        lastUpdated: toDbTimestampMs(nowDate, this.dialect)!,
      })
      .where(eq(schema.quotaState.keyName, keyName));

    logger.info(`[QuotaEnforcer] Quota cleared for ${keyName}`);
  }

  /**
   * Get the current window start timestamp for calendar quotas.
   */
  private getWindowStart(type: 'daily' | 'weekly' | 'monthly'): number {
    const now = new Date();

    if (type === 'daily') {
      // Start of current UTC day
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    } else if (type === 'weekly') {
      // Start of current UTC week (Sunday)
      const dayOfWeek = now.getUTCDay();
      now.setUTCDate(now.getUTCDate() - dayOfWeek);
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    } else {
      // type === 'monthly' - Start of current UTC month (1st day)
      return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    }
  }

  /**
   * Align timestamp to the start of the current period.
   * E.g., if now is 10:30 and duration is 1h, returns 10:00 (start of current hour).
   * Uses simple floor division for all durations.
   *
   * @param nowMs - Current timestamp in milliseconds
   * @param durationMs - Duration of the rolling window in milliseconds
   * @returns Aligned timestamp at the start of the current period
   */
  private alignToPeriodStart(nowMs: number, durationMs: number): number {
    // Floor division: find how many periods have passed, then multiply back
    // This gives us the start of the current period
    return Math.floor(nowMs / durationMs) * durationMs;
  }
}
