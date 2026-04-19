import { logger } from '../utils/logger';
import { getDatabase, getSchema } from '../db/client';
import { lt, eq, sql, and, desc } from 'drizzle-orm';
import { getConfig } from '../config';

interface Target {
  provider: string;
  model: string;
}

interface CooldownEntry {
  expiry: number;
  consecutiveFailures: number;
  lastError?: string;
}

export class CooldownManager {
  private static instance: CooldownManager;
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private db: ReturnType<typeof getDatabase> | null = null;
  private schema: any = null;

  private constructor() {}

  public static getInstance(): CooldownManager {
    if (!CooldownManager.instance) {
      CooldownManager.instance = new CooldownManager();
    }
    return CooldownManager.instance;
  }

  private ensureDb() {
    if (!this.db) {
      this.db = getDatabase();
      this.schema = getSchema();
    }
    return this.db;
  }

  public async loadFromStorage() {
    try {
      const db = this.ensureDb();
      const now = Date.now();

      await db
        .delete(this.schema.providerCooldowns)
        .where(lt(this.schema.providerCooldowns.expiry, now));

      const rows = await db
        .select()
        .from(this.schema.providerCooldowns)
        .where(sql`${this.schema.providerCooldowns.expiry} >= ${now}`);

      this.cooldowns.clear();
      for (const row of rows) {
        const key = CooldownManager.makeCooldownKey(row.provider, row.model || '');
        this.cooldowns.set(key, {
          expiry: row.expiry,
          consecutiveFailures: row.consecutiveFailures || 0,
          lastError: row.lastError ?? undefined,
        });
      }
      logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
      await this.pruneDisabledProviders();
    } catch (e) {
      logger.error('Failed to load cooldowns from storage', e);
    }
  }

  private static makeCooldownKey(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  private isCooldownDisabledForProvider(provider: string): boolean {
    try {
      const config = getConfig();
      return config.providers?.[provider]?.disable_cooldown === true;
    } catch {
      return false;
    }
  }

  private async pruneDisabledProviders(): Promise<void> {
    const keysToDelete: string[] = [];

    for (const key of this.cooldowns.keys()) {
      const provider = key.split(':')[0];
      if (provider && this.isCooldownDisabledForProvider(provider)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cooldowns.delete(key);
    }

    if (keysToDelete.length > 0) {
      const providers = [...new Set(keysToDelete.map((k) => k.split(':')[0]))];
      try {
        const db = this.ensureDb();
        for (const provider of providers) {
          await db
            .delete(this.schema.providerCooldowns)
            .where(eq(this.schema.providerCooldowns.provider, provider));
        }
        logger.debug(`Pruned cooldowns for disable_cooldown providers: ${providers.join(', ')}`);
      } catch (e) {
        logger.error('Failed to prune disabled provider cooldowns from DB', e);
      }
    }
  }

  /** For testing only */
  public static resetInstance(): void {
    CooldownManager.instance = undefined as any;
  }

  /**
   * Calculate exponential backoff duration using formula:
   * C(n) = min(C_max, C_0 * 2^n)
   *
   * Where:
   * - n = consecutive failures (0-indexed, so first failure is n=0)
   * - C_0 = initial cooldown in milliseconds
   * - C_max = max cooldown in milliseconds
   */
  private calculateCooldownDuration(consecutiveFailures: number): number {
    try {
      const config = getConfig();
      const cooldownConfig = config.cooldown;
      const initialMinutes = cooldownConfig?.initialMinutes ?? 2;
      const maxMinutes = cooldownConfig?.maxMinutes ?? 300;

      const initialMs = initialMinutes * 60 * 1000;
      const maxMs = maxMinutes * 60 * 1000;

      // C(n) = min(C_max, C_0 * 2^n)
      const exponentialMs = initialMs * Math.pow(2, consecutiveFailures);
      const durationMs = Math.min(maxMs, exponentialMs);

      return durationMs;
    } catch (e) {
      // Fallback if config not loaded yet
      const initialMs = 2 * 60 * 1000; // 2 minutes
      const maxMs = 300 * 60 * 1000; // 5 hours
      const exponentialMs = initialMs * Math.pow(2, consecutiveFailures);
      return Math.min(maxMs, exponentialMs);
    }
  }

  public async markProviderFailure(
    provider: string,
    model: string,
    durationMs?: number,
    lastError?: string
  ): Promise<void> {
    if (this.isCooldownDisabledForProvider(provider)) {
      logger.debug(
        `Skipping cooldown for provider '${provider}' model '${model}' (disable_cooldown=true)`
      );
      return;
    }

    const key = CooldownManager.makeCooldownKey(provider, model);
    const existingEntry = this.cooldowns.get(key);
    const consecutiveFailures = (existingEntry?.consecutiveFailures || 0) + 1;

    // Calculate duration using exponential backoff if not provided (e.g., from 429 parser)
    const duration = durationMs || this.calculateCooldownDuration(consecutiveFailures - 1);
    const expiry = Date.now() + duration;

    this.cooldowns.set(key, { expiry, consecutiveFailures, lastError });

    logger.warn(
      `Provider '${provider}' model '${model}' placed on cooldown for ${duration / 1000}s ` +
        `(failure #${consecutiveFailures}) until ${new Date(expiry).toISOString()}`
    );

    try {
      const db = this.ensureDb();
      await db
        .insert(this.schema.providerCooldowns)
        .values({
          provider,
          model,
          expiry,
          consecutiveFailures,
          createdAt: Date.now(),
          lastError: lastError ?? null,
        })
        .onConflictDoUpdate({
          target: [this.schema.providerCooldowns.provider, this.schema.providerCooldowns.model],
          set: {
            expiry,
            consecutiveFailures,
            lastError: lastError ?? null,
          },
        });
    } catch (e) {
      logger.error(`Failed to persist cooldown for ${provider}:${model}`, e);
    }
  }

  public async markProviderSuccess(provider: string, model: string): Promise<void> {
    const key = CooldownManager.makeCooldownKey(provider, model);
    const existingEntry = this.cooldowns.get(key);

    if (!existingEntry) {
      // No cooldown entry, nothing to reset
      return;
    }

    // Reset consecutive failures to 0 and remove the entry entirely
    this.cooldowns.delete(key);

    if (existingEntry.consecutiveFailures > 0) {
      logger.info(
        `Provider '${provider}' model '${model}' succeeded - resetting failure count (was ${existingEntry.consecutiveFailures})`
      );
    }

    try {
      const db = this.ensureDb();
      await db
        .delete(this.schema.providerCooldowns)
        .where(
          and(
            eq(this.schema.providerCooldowns.provider, provider),
            eq(this.schema.providerCooldowns.model, model)
          )
        );
    } catch (e) {
      logger.error(`Failed to clear cooldown for ${provider}:${model}`, e);
    }
  }

  public async isProviderHealthy(provider: string, model: string): Promise<boolean> {
    // First check for a provider-wide cooldown (keyed with empty model string).
    // This is set by the quota scheduler when any checker detects utilization at or above its threshold,
    // and blocks all models under the provider until the quota window resets.
    if (model !== '') {
      const providerWideHealthy = await this.isProviderHealthy(provider, '');
      if (!providerWideHealthy) {
        logger.debug(
          `Provider '${provider}' model '${model}' blocked by provider-wide quota cooldown`
        );
        return false;
      }
    }

    const key = CooldownManager.makeCooldownKey(provider, model);
    const entry = this.cooldowns.get(key);
    if (!entry) return true;

    // expiry === 0 means cooldown already expired — provider is eligible but failure count is retained
    if (entry.expiry === 0) return true;

    if (Date.now() > entry.expiry) {
      // Cooldown just expired — keep the failure count so the next failure escalates correctly,
      // but mark expiry as 0 so we stop treating it as actively cooling down.
      this.cooldowns.set(key, { expiry: 0, consecutiveFailures: entry.consecutiveFailures });

      try {
        const db = this.ensureDb();
        await db
          .delete(this.schema.providerCooldowns)
          .where(
            and(
              eq(this.schema.providerCooldowns.provider, provider),
              eq(this.schema.providerCooldowns.model, model)
            )
          );
      } catch (e) {
        logger.error(`Failed to remove expired cooldown for ${provider}:${model}`, e);
      }

      logger.info(`Provider '${provider}' model '${model}' cooldown expired, marking as healthy`);
      return true;
    }

    return false;
  }

  public async filterHealthyTargets(targets: Target[]): Promise<Target[]> {
    const healthyTargets: Target[] = [];

    for (const target of targets) {
      const isHealthy = await this.isProviderHealthy(target.provider, target.model);
      if (isHealthy) {
        healthyTargets.push(target);
      }
    }

    return healthyTargets;
  }

  public async removeCooldowns(targets: Target[]): Promise<Target[]> {
    return this.filterHealthyTargets(targets);
  }

  public getCooldowns(): {
    provider: string;
    model: string;
    expiry: number;
    timeRemainingMs: number;
    consecutiveFailures: number;
    lastError?: string;
  }[] {
    const now = Date.now();
    let providerConfig: Record<string, any> = {};
    try {
      providerConfig = getConfig().providers ?? {};
    } catch {
      // ignore — treat all providers as enabled
    }

    const results = [];
    for (const [key, entry] of this.cooldowns.entries()) {
      if (entry.expiry > now) {
        const parts = key.split(':');
        const provider = parts[0];
        if (!provider || providerConfig[provider]?.disable_cooldown === true) {
          continue;
        }
        const model = parts[1] || '';
        results.push({
          provider,
          model,
          expiry: entry.expiry,
          timeRemainingMs: entry.expiry - now,
          consecutiveFailures: entry.consecutiveFailures,
          lastError: entry.lastError,
        });
      }
    }
    return results;
  }

  public async clearCooldown(provider?: string, model?: string): Promise<void> {
    if (provider && model) {
      const keysToDelete = Array.from(this.cooldowns.keys()).filter((key) =>
        key.startsWith(`${provider}:${model}`)
      );
      keysToDelete.forEach((key) => this.cooldowns.delete(key));
      logger.info(
        `Manually cleared all cooldowns for provider '${provider}' model '${model}' (${keysToDelete.length} total)`
      );
      try {
        const db = this.ensureDb();
        await db
          .delete(this.schema.providerCooldowns)
          .where(
            and(
              eq(this.schema.providerCooldowns.provider, provider),
              eq(this.schema.providerCooldowns.model, model)
            )
          );
      } catch (e) {
        logger.error(`Failed to delete cooldowns for ${provider}:${model}`, e);
      }
    } else if (provider) {
      const keysToDelete = Array.from(this.cooldowns.keys()).filter((key) =>
        key.startsWith(`${provider}:`)
      );
      keysToDelete.forEach((key) => this.cooldowns.delete(key));
      logger.info(
        `Manually cleared all cooldowns for provider '${provider}' (${keysToDelete.length} total)`
      );
      try {
        const db = this.ensureDb();
        await db
          .delete(this.schema.providerCooldowns)
          .where(eq(this.schema.providerCooldowns.provider, provider));
      } catch (e) {
        logger.error(`Failed to delete cooldowns for ${provider}`, e);
      }
    } else {
      this.cooldowns.clear();
      logger.info('Manually cleared all cooldowns');
      try {
        const db = this.ensureDb();
        await db.delete(this.schema.providerCooldowns);
      } catch (e) {
        logger.error('Failed to delete all cooldowns', e);
      }
    }
  }
}
