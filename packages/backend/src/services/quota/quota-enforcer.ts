import { eq, sql } from 'drizzle-orm';
import parseDuration from 'parse-duration';
import { logger } from '../../utils/logger';
import { getConfig, QuotaDefinition, KeyConfig } from '../../config';
import { getDatabase, getCurrentDialect } from '../../db/client';
import * as sqliteSchema from '../../../drizzle/schema/sqlite';
import * as postgresSchema from '../../../drizzle/schema/postgres';

export interface QuotaCheckResult {
  allowed: boolean;
  quotaName: string;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetsAt: Date | null;
  limitType: 'requests' | 'tokens';
}

export interface UsageRecord {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCached?: number | null;
  tokensCacheWrite?: number | null;
  tokensReasoning?: number | null;
}

export class QuotaEnforcer {
  private db: ReturnType<typeof getDatabase>;

  constructor() {
    this.db = getDatabase();
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

    let currentUsage: number;
    let windowStartDate: Date | null = null;
    let lastUpdatedDate: Date;

    if (existingState.length === 0) {
      // No state exists yet, start fresh
      currentUsage = 0;
      lastUpdatedDate = nowDate;
      
      // For calendar quotas, set window start
      if (quotaDef.type === 'daily' || quotaDef.type === 'weekly') {
        windowStartDate = new Date(this.getWindowStart(quotaDef.type));
      }
    } else {
      const state = existingState[0];
      const storedLimitType = state!.limitType as 'requests' | 'tokens';
      const storedQuotaName = state!.quotaName as string;
      
      // Check if quota name has changed (key assigned to different quota)
      if (storedQuotaName !== quotaName) {
        logger.info(`[QuotaEnforcer] Quota name changed for ${keyName} from '${storedQuotaName}' to '${quotaName}'. ` +
          `Resetting usage.`);
        currentUsage = 0;
        lastUpdatedDate = nowDate;
        windowStartDate = null;
        
        // For calendar quotas, set new window start
        if (quotaDef.type === 'daily' || quotaDef.type === 'weekly') {
          windowStartDate = new Date(this.getWindowStart(quotaDef.type));
        }
      // Check if quota definition has changed (e.g., requests -> tokens)
      } else if (storedLimitType !== quotaDef.limitType) {
        logger.info(`[QuotaEnforcer] Quota ${quotaName} limitType changed from ${storedLimitType} to ${quotaDef.limitType}. ` +
          `Resetting usage for ${keyName}.`);
        currentUsage = 0;
        lastUpdatedDate = nowDate;
        windowStartDate = null;
        
        // For calendar quotas, set new window start
        if (quotaDef.type === 'daily' || quotaDef.type === 'weekly') {
          windowStartDate = new Date(this.getWindowStart(quotaDef.type));
        }
      } else {
        // Quota definition unchanged, proceed normally
        currentUsage = state!.currentUsage;
        lastUpdatedDate = state!.lastUpdated as Date;
        windowStartDate = state!.windowStart as Date | null;

        // Handle calendar quota reset
        if (quotaDef.type === 'daily' || quotaDef.type === 'weekly') {
          const expectedWindowStart = this.getWindowStart(quotaDef.type);
          if (!windowStartDate || windowStartDate.getTime() !== expectedWindowStart) {
            // Window has reset
            logger.debug(`[QuotaEnforcer] Calendar quota ${quotaName} for ${keyName} reset`);
            currentUsage = 0;
            windowStartDate = new Date(expectedWindowStart);
            lastUpdatedDate = nowDate;
          }
        } else if (quotaDef.type === 'rolling') {
          // Calculate leak for rolling quotas
          const durationMs = parseDuration(quotaDef.duration);
          if (!durationMs) {
            logger.warn(`[QuotaEnforcer] Invalid duration '${quotaDef.duration}' for rolling quota ${quotaName}. ` +
              `Cannot calculate quota leak. Allowing request (fail-open). ` +
              `Please fix the duration in your config (e.g., '1h', '30m', '1d').`);
            return null;
          }

          const elapsedMs = nowMs - lastUpdatedDate.getTime();
          const leakRate = quotaDef.limit / durationMs;
          const leaked = elapsedMs * leakRate;
          
          currentUsage = Math.max(0, currentUsage - leaked);
          lastUpdatedDate = nowDate;
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
        // Estimate when current usage will fully leak out
        const timeToLeakAll = (currentUsage / quotaDef.limit) * durationMs;
        resetsAt = new Date(nowMs + timeToLeakAll);
      } else {
        logger.warn(`[QuotaEnforcer] Cannot calculate resetsAt for quota ${quotaName}: invalid duration '${quotaDef.duration}'`);
      }
    } else if (quotaDef.type === 'daily') {
      // Reset at next UTC midnight
      const tomorrow = new Date(nowMs);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      resetsAt = tomorrow;
    } else if (quotaDef.type === 'weekly') {
      // Reset at next UTC Sunday midnight
      const nowDateObj = new Date(nowMs);
      const daysUntilSunday = 7 - nowDateObj.getUTCDay();
      const nextSunday = new Date(nowMs);
      nextSunday.setUTCDate(nowDateObj.getUTCDate() + daysUntilSunday);
      nextSunday.setUTCHours(0, 0, 0, 0);
      resetsAt = nextSunday;
    }

    const result: QuotaCheckResult = {
      allowed,
      quotaName,
      currentUsage: Math.round(currentUsage),
      limit: quotaDef.limit,
      remaining: Math.round(remaining),
      resetsAt,
      limitType: quotaDef.limitType,
    };

    logger.debug(`[QuotaEnforcer] Quota check for ${keyName}:`, result);

    return result;
  }

  /**
   * Records actual usage after request completes.
   */
  async recordUsage(keyName: string, usageRecord: UsageRecord): Promise<void> {
    const config = getConfig();
    
    // Get key configuration
    const keyConfig = config.keys?.[keyName];
    if (!keyConfig?.quota) {
      return; // No quota assigned, nothing to record
    }

    // Get quota definition
    const quotaDef = config.user_quotas?.[keyConfig.quota];
    if (!quotaDef) {
      return;
    }

    // Calculate cost
    let cost: number;
    if (quotaDef.limitType === 'requests') {
      cost = 1;
    } else {
      // tokens: sum of input + output
      cost = (usageRecord.tokensInput || 0) + 
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
      if (quotaDef.type === 'daily' || quotaDef.type === 'weekly') {
        windowStartDate = new Date(this.getWindowStart(quotaDef.type));
      }

      await this.db.insert(schema.quotaState).values({
        keyName,
        quotaName: keyConfig.quota,
        limitType: quotaDef.limitType,
        currentUsage: cost,
        lastUpdated: nowDate,
        windowStart: windowStartDate,
      });
    } else if (existingState[0]) {
      // Update existing state with leak calculation for rolling quotas
      const state = existingState[0];
      const storedLimitType = state.limitType as 'requests' | 'tokens';
      const storedQuotaName = state.quotaName as string;
      
      // Check if quota name or limitType has changed - if so, start fresh
      let newUsage: number;
      if (storedQuotaName !== keyConfig.quota) {
        logger.debug(`[QuotaEnforcer] Quota name changed for ${keyName} from '${storedQuotaName}' to '${keyConfig.quota}' in recordUsage`);
        newUsage = cost; // Start fresh with just this request's cost
      } else if (storedLimitType !== quotaDef.limitType) {
        logger.debug(`[QuotaEnforcer] Quota ${keyConfig.quota} limitType changed from ${storedLimitType} to ${quotaDef.limitType} in recordUsage`);
        newUsage = cost; // Start fresh with just this request's cost
      } else {
        newUsage = state.currentUsage + cost;
        
        if (quotaDef.type === 'rolling') {
          // Apply leak since last update
          const durationMs = parseDuration(quotaDef.duration);
          if (durationMs) {
            const lastUpdatedDate = state.lastUpdated as Date;
            const elapsedMs = nowMs - lastUpdatedDate.getTime();
            const leakRate = quotaDef.limit / durationMs;
            const leaked = elapsedMs * leakRate;
            newUsage = Math.max(0, state.currentUsage - leaked) + cost;
          } else {
            logger.warn(`[QuotaEnforcer] Invalid duration '${quotaDef.duration}' for rolling quota ${keyConfig.quota}. ` +
              `Recording usage without leak calculation. Usage will accumulate without decay. ` +
              `Please fix the duration in your config (e.g., '1h', '30m', '1d').`);
          }
        }
      }

      await this.db
        .update(schema.quotaState)
        .set({
          quotaName: keyConfig.quota,
          limitType: quotaDef.limitType,
          currentUsage: newUsage,
          lastUpdated: nowDate,
        })
        .where(eq(schema.quotaState.keyName, keyName));
    }

    logger.debug(`[QuotaEnforcer] Recorded ${cost} ${quotaDef.limitType} usage for ${keyName}`);
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
        lastUpdated: nowDate,
      })
      .where(eq(schema.quotaState.keyName, keyName));

    logger.info(`[QuotaEnforcer] Quota cleared for ${keyName}`);
  }

  /**
   * Get the current window start timestamp for calendar quotas.
   */
  private getWindowStart(type: 'daily' | 'weekly'): number {
    const now = new Date();
    
    if (type === 'daily') {
      // Start of current UTC day
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    } else {
      // Start of current UTC week (Sunday)
      const dayOfWeek = now.getUTCDay();
      now.setUTCDate(now.getUTCDate() - dayOfWeek);
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    }
  }
}
