import { logger } from '../utils/logger';
import { getDatabase } from '../db/client';
import * as schema from '../../drizzle/schema';
import { lt, eq, sql, and, desc } from 'drizzle-orm';

interface Target {
    provider: string;
    model: string;
}

export class CooldownManager {
    private static instance: CooldownManager;
    private cooldowns: Map<string, number> = new Map();
    private readonly defaultCooldownMinutes = 10;
    private db;

    private constructor() {
        this.db = getDatabase();
    }

    public static getInstance(): CooldownManager {
        if (!CooldownManager.instance) {
            CooldownManager.instance = new CooldownManager();
        }
        return CooldownManager.instance;
    }

    public async loadFromStorage() {
        try {
            const now = Date.now();

            await this.db
                .delete(schema.providerCooldowns)
                .where(lt(schema.providerCooldowns.expiry, now));

            const rows = await this.db
                .select()
                .from(schema.providerCooldowns)
                .where(sql`${schema.providerCooldowns.expiry} >= ${now}`);

            this.cooldowns.clear();
            for (const row of rows) {
                const key = CooldownManager.makeCooldownKey(row.provider, row.model || '', row.accountId || undefined);
                this.cooldowns.set(key, row.expiry);
            }
            logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
        } catch (e) {
            logger.error('Failed to load cooldowns from storage', e);
        }
    }

    private static makeCooldownKey(provider: string, model: string, accountId?: string): string {
        const parts = [provider, model];
        if (accountId) {
            parts.push(accountId);
        }
        return parts.join(':');
    }

    private getCooldownDuration(): number {
        const envVal = process.env.PLEXUS_PROVIDER_COOLDOWN_MINUTES;
        const minutes = envVal ? parseInt(envVal, 10) : this.defaultCooldownMinutes;
        return (isNaN(minutes) ? this.defaultCooldownMinutes : minutes) * 60 * 1000;
    }

    public async markProviderFailure(provider: string, model: string, accountId?: string, durationMs?: number): Promise<void> {
        const duration = durationMs || this.getCooldownDuration();
        const expiry = Date.now() + duration;
        const key = CooldownManager.makeCooldownKey(provider, model, accountId);
        this.cooldowns.set(key, expiry);

        const accountInfo = accountId ? ` (account: ${accountId})` : '';
        logger.warn(`Provider '${provider}' model '${model}'${accountInfo} placed on cooldown for ${duration / 1000}s until ${new Date(expiry).toISOString()}`);

        try {
            await this.db.insert(schema.providerCooldowns).values({
                provider,
                model,
                accountId: accountId || '',
                expiry,
                createdAt: Date.now(),
            }).onConflictDoUpdate({
                target: [
                    schema.providerCooldowns.provider,
                    schema.providerCooldowns.model,
                    schema.providerCooldowns.accountId,
                ],
                set: { expiry },
            });
        } catch (e) {
            logger.error(`Failed to persist cooldown for ${provider}:${model}${accountInfo}`, e);
        }
    }

    public async isProviderHealthy(provider: string, model: string, accountId?: string): Promise<boolean> {
        const key = CooldownManager.makeCooldownKey(provider, model, accountId);
        const expiry = this.cooldowns.get(key);
        if (!expiry) return true;

        if (Date.now() > expiry) {
            this.cooldowns.delete(key);

            try {
                await this.db
                    .delete(schema.providerCooldowns)
                    .where(and(
                        eq(schema.providerCooldowns.provider, provider),
                        eq(schema.providerCooldowns.model, model),
                        sql`(${schema.providerCooldowns.accountId} = ${accountId || ''} OR (${schema.providerCooldowns.accountId} = '' AND ${accountId || ''} = ''))`
                    ));
            } catch (e) {
                const accountInfo = accountId ? ` (account: ${accountId})` : '';
                logger.error(`Failed to remove expired cooldown for ${provider}:${model}${accountInfo}`, e);
            }

            const accountInfo = accountId ? ` (account: ${accountId})` : '';
            logger.info(`Provider '${provider}' model '${model}'${accountInfo} cooldown expired, marking as healthy`);
            return true;
        }

        return false;
    }

    public async filterHealthyTargets(targets: Target[], getAccountId?: (provider: string) => string | undefined): Promise<Target[]> {
        const healthyTargets: Target[] = [];
        
        for (const target of targets) {
            const accountId = getAccountId ? getAccountId(target.provider) : undefined;
            const isHealthy = await this.isProviderHealthy(target.provider, target.model, accountId);
            if (isHealthy) {
                healthyTargets.push(target);
            }
        }
        
        return healthyTargets;
    }
    
    public async removeCooldowns(targets: Target[]): Promise<Target[]> {
        return this.filterHealthyTargets(targets);
    }

    public getCooldowns(): { provider: string, model: string, accountId: string | undefined, expiry: number, timeRemainingMs: number }[] {
        const now = Date.now();
        const results = [];
        for (const [key, expiry] of this.cooldowns.entries()) {
            if (expiry > now) {
                const parts = key.split(':');
                const provider = parts[0];
                const model = parts[1] || '';
                const accountId = parts[2];
                results.push({
                    provider: provider || '',
                    model,
                    accountId,
                    expiry,
                    timeRemainingMs: expiry - now
                });
            } else {
                
            }
        }
        return results;
    }

    public async clearCooldown(provider?: string, model?: string, accountId?: string): Promise<void> {
        if (provider && model && accountId) {
            const key = CooldownManager.makeCooldownKey(provider, model, accountId);
            this.cooldowns.delete(key);
            logger.info(`Manually cleared cooldown for provider '${provider}' model '${model}' account '${accountId}'`);
            try {
                await this.db
                    .delete(schema.providerCooldowns)
                    .where(and(
                        eq(schema.providerCooldowns.provider, provider),
                        eq(schema.providerCooldowns.model, model),
                        eq(schema.providerCooldowns.accountId, accountId)
                    ));
            } catch (e) {
                logger.error(`Failed to delete cooldown for ${provider}:${model}:${accountId}`, e);
            }
        } else if (provider && model) {
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key.startsWith(`${provider}:${model}`)
            );
            keysToDelete.forEach(key => this.cooldowns.delete(key));
            logger.info(`Manually cleared all cooldowns for provider '${provider}' model '${model}' (${keysToDelete.length} total)`);
            try {
                await this.db
                    .delete(schema.providerCooldowns)
                    .where(and(
                        eq(schema.providerCooldowns.provider, provider),
                        eq(schema.providerCooldowns.model, model)
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
                await this.db
                    .delete(schema.providerCooldowns)
                    .where(eq(schema.providerCooldowns.provider, provider));
            } catch (e) {
                logger.error(`Failed to delete cooldowns for ${provider}`, e);
            }
        } else {
            this.cooldowns.clear();
            logger.info('Manually cleared all cooldowns');
            try {
                await this.db.delete(schema.providerCooldowns);
            } catch (e) {
                logger.error('Failed to delete all cooldowns', e);
            }
        }
    }
}
