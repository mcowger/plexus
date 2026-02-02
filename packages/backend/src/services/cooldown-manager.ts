import { logger } from '../utils/logger';
import { getDatabase, getSchema } from '../db/client';
import { lt, eq, sql, and, desc } from 'drizzle-orm';

interface Target {
    provider: string;
    model: string;
}

export class CooldownManager {
    private static instance: CooldownManager;
    private cooldowns: Map<string, number> = new Map();
    private readonly defaultCooldownMinutes = 10;
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
                this.cooldowns.set(key, row.expiry);
            }
            logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
        } catch (e) {
            logger.error('Failed to load cooldowns from storage', e);
        }
    }

    private static makeCooldownKey(provider: string, model: string): string {
        return `${provider}:${model}`;
    }

    private getCooldownDuration(): number {
        const envVal = process.env.PLEXUS_PROVIDER_COOLDOWN_MINUTES;
        const minutes = envVal ? parseInt(envVal, 10) : this.defaultCooldownMinutes;
        return (isNaN(minutes) ? this.defaultCooldownMinutes : minutes) * 60 * 1000;
    }

    public async markProviderFailure(provider: string, model: string, durationMs?: number): Promise<void> {
        const duration = durationMs || this.getCooldownDuration();
        const expiry = Date.now() + duration;
        const key = CooldownManager.makeCooldownKey(provider, model);
        this.cooldowns.set(key, expiry);

        logger.warn(`Provider '${provider}' model '${model}' placed on cooldown for ${duration / 1000}s until ${new Date(expiry).toISOString()}`);

        try {
            const db = this.ensureDb();
            await db.insert(this.schema.providerCooldowns).values({
                provider,
                model,
                expiry,
                createdAt: Date.now(),
            }).onConflictDoUpdate({
                target: [
                    this.schema.providerCooldowns.provider,
                    this.schema.providerCooldowns.model,
                ],
                set: { expiry },
            });
        } catch (e) {
            logger.error(`Failed to persist cooldown for ${provider}:${model}`, e);
        }
    }

    public async isProviderHealthy(provider: string, model: string): Promise<boolean> {
        const key = CooldownManager.makeCooldownKey(provider, model);
        const expiry = this.cooldowns.get(key);
        if (!expiry) return true;

        if (Date.now() > expiry) {
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

    public getCooldowns(): { provider: string, model: string, expiry: number, timeRemainingMs: number }[] {
        const now = Date.now();
        const results = [];
        for (const [key, expiry] of this.cooldowns.entries()) {
            if (expiry > now) {
                const parts = key.split(':');
                const provider = parts[0];
                const model = parts[1] || '';
                results.push({
                    provider: provider || '',
                    model,
                    expiry,
                    timeRemainingMs: expiry - now
                });
            } else {
                
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
