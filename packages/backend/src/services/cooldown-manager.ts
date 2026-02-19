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
}

export class CooldownManager {
    private static instance: CooldownManager;
    private cooldowns: Map<string, CooldownEntry> = new Map();
    private db: ReturnType<typeof getDatabase> | null = null;
    private schema: any = null;

    private constructor() {
    }

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
                    consecutiveFailures: row.consecutiveFailures || 0
                });
            }
            logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
        } catch (e) {
            logger.error('Failed to load cooldowns from storage', e);
        }
    }

    private static makeCooldownKey(provider: string, model: string): string {
        return `${provider}:${model}`;
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

    public async markProviderFailure(provider: string, model: string, durationMs?: number): Promise<void> {
        const key = CooldownManager.makeCooldownKey(provider, model);
        const existingEntry = this.cooldowns.get(key);
        const consecutiveFailures = (existingEntry?.consecutiveFailures || 0) + 1;
        
        // Calculate duration using exponential backoff if not provided (e.g., from 429 parser)
        const duration = durationMs || this.calculateCooldownDuration(consecutiveFailures - 1);
        const expiry = Date.now() + duration;
        
        this.cooldowns.set(key, { expiry, consecutiveFailures });

        logger.warn(
            `Provider '${provider}' model '${model}' placed on cooldown for ${duration / 1000}s ` +
            `(failure #${consecutiveFailures}) until ${new Date(expiry).toISOString()}`
        );

        try {
            const db = this.ensureDb();
            await db.insert(this.schema.providerCooldowns).values({
                provider,
                model,
                expiry,
                consecutiveFailures,
                createdAt: Date.now(),
            }).onConflictDoUpdate({
                target: [
                    this.schema.providerCooldowns.provider,
                    this.schema.providerCooldowns.model,
                ],
                set: { 
                    expiry,
                    consecutiveFailures,
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

        // Reset consecutive failures to 0
        this.cooldowns.delete(key);

        logger.info(`Provider '${provider}' model '${model}' succeeded - resetting failure count`);

        try {
            const db = this.ensureDb();
            await db
                .delete(this.schema.providerCooldowns)
                .where(and(
                    eq(this.schema.providerCooldowns.provider, provider),
                    eq(this.schema.providerCooldowns.model, model)
                ));
        } catch (e) {
            logger.error(`Failed to clear cooldown for ${provider}:${model}`, e);
        }
    }

    public async isProviderHealthy(provider: string, model: string): Promise<boolean> {
        const key = CooldownManager.makeCooldownKey(provider, model);
        const entry = this.cooldowns.get(key);
        if (!entry) return true;

        if (Date.now() > entry.expiry) {
            this.cooldowns.delete(key);

            try {
                const db = this.ensureDb();
                await db
                    .delete(this.schema.providerCooldowns)
                    .where(and(
                        eq(this.schema.providerCooldowns.provider, provider),
                        eq(this.schema.providerCooldowns.model, model)
                    ));
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

    public getCooldowns(): { provider: string, model: string, expiry: number, timeRemainingMs: number, consecutiveFailures: number }[] {
        const now = Date.now();
        const results = [];
        for (const [key, entry] of this.cooldowns.entries()) {
            if (entry.expiry > now) {
                const parts = key.split(':');
                const provider = parts[0];
                const model = parts[1] || '';
                results.push({
                    provider: provider || '',
                    model,
                    expiry: entry.expiry,
                    timeRemainingMs: entry.expiry - now,
                    consecutiveFailures: entry.consecutiveFailures
                });
            }
        }
        return results;
    }

    public async clearCooldown(provider?: string, model?: string): Promise<void> {
        if (provider && model) {
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key.startsWith(`${provider}:${model}`)
            );
            keysToDelete.forEach(key => this.cooldowns.delete(key));
            logger.info(`Manually cleared all cooldowns for provider '${provider}' model '${model}' (${keysToDelete.length} total)`);
            try {
                const db = this.ensureDb();
                await db
                    .delete(this.schema.providerCooldowns)
                    .where(and(
                        eq(this.schema.providerCooldowns.provider, provider),
                        eq(this.schema.providerCooldowns.model, model)
                    ));
            } catch (e) {
                logger.error(`Failed to delete cooldowns for ${provider}:${model}`, e);
            }
        } else if (provider) {
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key.startsWith(`${provider}:`)
            );
            keysToDelete.forEach(key => this.cooldowns.delete(key));
            logger.info(`Manually cleared all cooldowns for provider '${provider}' (${keysToDelete.length} total)`);
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
