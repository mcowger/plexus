import { logger } from '../utils/logger';
import { UsageStorageService } from './usage-storage';

interface Target {
    provider: string;
    model: string;
}

export class CooldownManager {
    private static instance: CooldownManager;
    private cooldowns: Map<string, number> = new Map();
    private readonly defaultCooldownMinutes = 10;
    private storage: UsageStorageService | null = null;

    private constructor() {}

    public static getInstance(): CooldownManager {
        if (!CooldownManager.instance) {
            CooldownManager.instance = new CooldownManager();
        }
        return CooldownManager.instance;
    }

    public async setStorage(storage: UsageStorageService) {
        this.storage = storage;
        await this.loadFromStorage();
    }

    private async loadFromStorage() {
        if (!this.storage) return;
        try {
            const db = this.storage.getDb();
            const now = Date.now();

            // Clean up expired first
            db.run("DELETE FROM provider_cooldowns WHERE expiry < ?", [now]);

            const rows = db.query("SELECT provider, model, account_id, expiry FROM provider_cooldowns").all() as
                { provider: string, model: string, account_id: string | null, expiry: number }[];

            this.cooldowns.clear();
            for (const row of rows) {
                if (row.expiry > now) {
                    const key = CooldownManager.makeCooldownKey(row.provider, row.model || '', row.account_id || undefined);
                    this.cooldowns.set(key, row.expiry);
                }
            }
            logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
        } catch (e) {
            logger.error("Failed to load cooldowns from storage", e);
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

    public markProviderFailure(provider: string, model: string, accountId?: string, durationMs?: number): void {
        const duration = durationMs || this.getCooldownDuration();
        const expiry = Date.now() + duration;
        const key = CooldownManager.makeCooldownKey(provider, model, accountId);
        this.cooldowns.set(key, expiry);

        const accountInfo = accountId ? ` (account: ${accountId})` : '';
        logger.warn(`Provider '${provider}' model '${model}'${accountInfo} placed on cooldown for ${duration / 1000}s until ${new Date(expiry).toISOString()}`);

        if (this.storage) {
            try {
                this.storage.getDb().run(
                    "INSERT OR REPLACE INTO provider_cooldowns (provider, model, account_id, expiry, created_at) VALUES (?, ?, ?, ?, ?)",
                    [provider, model, accountId || '', expiry, Date.now()]
                );
            } catch (e) {
                logger.error(`Failed to persist cooldown for ${provider}:${model}${accountInfo}`, e);
            }
        }
    }

    public isProviderHealthy(provider: string, model: string, accountId?: string): boolean {
        const key = CooldownManager.makeCooldownKey(provider, model, accountId);
        const expiry = this.cooldowns.get(key);
        if (!expiry) return true;

        if (Date.now() > expiry) {
            this.cooldowns.delete(key);

            if (this.storage) {
                try {
                    this.storage.getDb().run(
                        "DELETE FROM provider_cooldowns WHERE provider = ? AND model = ? AND (account_id = ? OR (account_id = '' AND ? = ''))",
                        [provider, model, accountId || '', accountId || '']
                    );
                } catch (e) {
                    const accountInfo = accountId ? ` (account: ${accountId})` : '';
                    logger.error(`Failed to remove expired cooldown for ${provider}:${model}${accountInfo}`, e);
                }
            }

            const accountInfo = accountId ? ` (account: ${accountId})` : '';
            logger.info(`Provider '${provider}' model '${model}'${accountInfo} cooldown expired, marking as healthy`);
            return true;
        }

        return false;
    }

    public filterHealthyTargets(targets: Target[], getAccountId?: (provider: string) => string | undefined): Target[] {
        return targets.filter(target => {
            const accountId = getAccountId ? getAccountId(target.provider) : undefined;
            return this.isProviderHealthy(target.provider, target.model, accountId);
        });
    }
    
    // Helper specifically for the requested signature, though filterHealthyTargets is more versatile
    public removeCooldowns(targets: Target[]): Target[] {
        return this.filterHealthyTargets(targets);
    }

    public getCooldowns(): { provider: string, model: string, accountId?: string, expiry: number, timeRemainingMs: number }[] {
        const now = Date.now();
        const results = [];
        for (const [key, expiry] of this.cooldowns.entries()) {
            if (expiry > now) {
                const parts = key.split(':');
                const provider = parts[0];
                const model = parts[1] || '';
                const accountId = parts[2] || undefined;
                results.push({
                    provider,
                    model,
                    accountId,
                    expiry,
                    timeRemainingMs: expiry - now
                });
            } else {
                // Should be cleaned up on next check, but for reporting we ignore it
            }
        }
        return results;
    }

    public clearCooldown(provider?: string, model?: string, accountId?: string): void {
        if (provider && model && accountId) {
            // Clear specific provider+model+account cooldown
            const key = CooldownManager.makeCooldownKey(provider, model, accountId);
            this.cooldowns.delete(key);
            logger.info(`Manually cleared cooldown for provider '${provider}' model '${model}' account '${accountId}'`);
            if (this.storage) {
                try {
                    this.storage.getDb().run(
                        "DELETE FROM provider_cooldowns WHERE provider = ? AND model = ? AND account_id = ?",
                        [provider, model, accountId]
                    );
                } catch (e) {
                    logger.error(`Failed to delete cooldown for ${provider}:${model}:${accountId}`, e);
                }
            }
        } else if (provider && model) {
            // Clear all cooldowns for this provider+model combination (all accounts)
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key.startsWith(`${provider}:${model}`)
            );
            keysToDelete.forEach(key => this.cooldowns.delete(key));
            logger.info(`Manually cleared all cooldowns for provider '${provider}' model '${model}' (${keysToDelete.length} total)`);
            if (this.storage) {
                try {
                    this.storage.getDb().run("DELETE FROM provider_cooldowns WHERE provider = ? AND model = ?", [provider, model]);
                } catch (e) {
                    logger.error(`Failed to delete cooldowns for ${provider}:${model}`, e);
                }
            }
        } else if (provider) {
            // Clear all cooldowns for this provider (all models and accounts)
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key.startsWith(`${provider}:`)
            );
            keysToDelete.forEach(key => this.cooldowns.delete(key));
            logger.info(`Manually cleared all cooldowns for provider '${provider}' (${keysToDelete.length} total)`);
            if (this.storage) {
                try {
                    this.storage.getDb().run("DELETE FROM provider_cooldowns WHERE provider = ?", [provider]);
                } catch (e) {
                    logger.error(`Failed to delete cooldowns for ${provider}`, e);
                }
            }
        } else {
            // Clear all cooldowns
            this.cooldowns.clear();
            logger.info("Manually cleared all cooldowns");
            if (this.storage) {
                try {
                    this.storage.getDb().run("DELETE FROM provider_cooldowns");
                } catch (e) {
                    logger.error("Failed to delete all cooldowns", e);
                }
            }
        }
    }
}
