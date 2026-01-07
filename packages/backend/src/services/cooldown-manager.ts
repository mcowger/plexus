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

            const rows = db.query("SELECT provider, account_id, expiry FROM provider_cooldowns").all() as
                { provider: string, account_id: string | null, expiry: number }[];

            this.cooldowns.clear();
            for (const row of rows) {
                if (row.expiry > now) {
                    const key = CooldownManager.makeCooldownKey(row.provider, row.account_id || undefined);
                    this.cooldowns.set(key, row.expiry);
                }
            }
            logger.info(`Loaded ${this.cooldowns.size} active cooldowns from storage`);
        } catch (e) {
            logger.error("Failed to load cooldowns from storage", e);
        }
    }

    private static makeCooldownKey(provider: string, accountId?: string): string {
        return accountId ? `${provider}:${accountId}` : provider;
    }

    private getCooldownDuration(): number {
        const envVal = process.env.PLEXUS_PROVIDER_COOLDOWN_MINUTES;
        const minutes = envVal ? parseInt(envVal, 10) : this.defaultCooldownMinutes;
        return (isNaN(minutes) ? this.defaultCooldownMinutes : minutes) * 60 * 1000;
    }

    public markProviderFailure(provider: string, accountId?: string, durationMs?: number): void {
        const duration = durationMs || this.getCooldownDuration();
        const expiry = Date.now() + duration;
        const key = CooldownManager.makeCooldownKey(provider, accountId);
        this.cooldowns.set(key, expiry);

        const accountInfo = accountId ? ` (account: ${accountId})` : '';
        logger.warn(`Provider '${provider}'${accountInfo} placed on cooldown for ${duration / 1000}s until ${new Date(expiry).toISOString()}`);

        if (this.storage) {
            try {
                this.storage.getDb().run(
                    "INSERT OR REPLACE INTO provider_cooldowns (provider, account_id, expiry, created_at) VALUES (?, ?, ?, ?)",
                    [provider, accountId || null, expiry, Date.now()]
                );
            } catch (e) {
                logger.error(`Failed to persist cooldown for ${provider}${accountInfo}`, e);
            }
        }
    }

    public isProviderHealthy(provider: string, accountId?: string): boolean {
        const key = CooldownManager.makeCooldownKey(provider, accountId);
        const expiry = this.cooldowns.get(key);
        if (!expiry) return true;

        if (Date.now() > expiry) {
            this.cooldowns.delete(key);

            if (this.storage) {
                try {
                    this.storage.getDb().run(
                        "DELETE FROM provider_cooldowns WHERE provider = ? AND (account_id = ? OR (account_id IS NULL AND ? IS NULL))",
                        [provider, accountId || null, accountId || null]
                    );
                } catch (e) {
                    const accountInfo = accountId ? ` (account: ${accountId})` : '';
                    logger.error(`Failed to remove expired cooldown for ${provider}${accountInfo}`, e);
                }
            }

            const accountInfo = accountId ? ` (account: ${accountId})` : '';
            logger.info(`Provider '${provider}'${accountInfo} cooldown expired, marking as healthy`);
            return true;
        }

        return false;
    }

    public filterHealthyTargets(targets: Target[], getAccountId?: (provider: string) => string | undefined): Target[] {
        return targets.filter(target => {
            const accountId = getAccountId ? getAccountId(target.provider) : undefined;
            return this.isProviderHealthy(target.provider, accountId);
        });
    }
    
    // Helper specifically for the requested signature, though filterHealthyTargets is more versatile
    public removeCooldowns(targets: Target[]): Target[] {
        return this.filterHealthyTargets(targets);
    }

    public getCooldowns(): { provider: string, accountId?: string, expiry: number, timeRemainingMs: number }[] {
        const now = Date.now();
        const results = [];
        for (const [key, expiry] of this.cooldowns.entries()) {
            if (expiry > now) {
                const [provider, accountId] = key.includes(':') ? key.split(':', 2) : [key, undefined];
                results.push({
                    provider,
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

    public clearCooldown(provider?: string, accountId?: string): void {
        if (provider && accountId) {
            // Clear specific account cooldown
            const key = CooldownManager.makeCooldownKey(provider, accountId);
            this.cooldowns.delete(key);
            logger.info(`Manually cleared cooldown for provider '${provider}' account '${accountId}'`);
            if (this.storage) {
                try {
                    this.storage.getDb().run(
                        "DELETE FROM provider_cooldowns WHERE provider = ? AND account_id = ?",
                        [provider, accountId]
                    );
                } catch (e) {
                    logger.error(`Failed to delete cooldown for ${provider}:${accountId}`, e);
                }
            }
        } else if (provider) {
            // Clear all cooldowns for this provider (including all accounts)
            const keysToDelete = Array.from(this.cooldowns.keys()).filter(key =>
                key === provider || key.startsWith(`${provider}:`)
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
