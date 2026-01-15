import { logger } from "../utils/logger";
import { CooldownStore } from "../storage/cooldown-store";
import type { CooldownEntry, CooldownReason, CooldownState } from "../types/health";
import type { PlexusConfig, ProviderConfig } from "../types/config";
import type { ConfigManager } from "./config-manager";

/**
 * Options for setting a cooldown
 */
export interface SetCooldownOptions {
  provider: string;
  reason: CooldownReason;
  duration?: number;        // Override duration in seconds
  httpStatus?: number;
  message?: string;
  retryAfter?: number;      // From provider header (seconds)
}

/**
 * Manages provider cooldown state
 * Handles in-memory state, persistence, and cooldown logic
 */
export class CooldownManager {
  private state: CooldownState;
  private store: CooldownStore;
  private ready: Promise<void>;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    const config = configManager.getCurrentConfig();
    this.store = new CooldownStore(config.resilience.cooldown.storagePath);
    this.state = { entries: {}, lastUpdated: Date.now() };

    // Load state asynchronously
    this.ready = this.initialize();
  }

  /**
   * Initializes the cooldown manager by loading state from disk
   */
  private async initialize(): Promise<void> {
    this.state = await this.store.load();
    logger.info("Cooldown manager initialized", {
      activeEntries: Object.keys(this.state.entries).length,
    });
  }

  /**
   * Ensures the manager is ready before operations
   */
  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Places a provider on cooldown
   * Calculates duration based on:
   * 1. Explicit duration parameter
   * 2. Provider-specific override
   * 3. Retry-after header
   * 4. Default duration for error type
   */
  setCooldown(options: SetCooldownOptions): void {
    const { provider, reason, duration, httpStatus, message, retryAfter } = options;

    // Calculate cooldown duration
    const cooldownDuration = this.calculateDuration(provider, reason, duration, retryAfter);

    const now = Date.now();
    const entry: CooldownEntry = {
      provider,
      reason,
      startTime: now,
      endTime: now + cooldownDuration * 1000,
      httpStatus,
      message,
      retryAfter,
    };

    this.state.entries[provider] = entry;
    this.state.lastUpdated = now;

    // Persist to disk (fire and forget - don't block)
    this.store.save(this.state).catch((error) => {
      logger.error("Failed to persist cooldown", { error });
    });

    logger.warn("Provider placed on cooldown", {
      provider,
      reason,
      duration: cooldownDuration,
      httpStatus,
      expiresAt: new Date(entry.endTime).toISOString(),
    });
  }

  /**
   * Gets cooldown entry for a provider if on cooldown
   * Returns undefined if not on cooldown or cooldown has expired
   */
  getCooldown(provider: string): CooldownEntry | undefined {
    const entry = this.state.entries[provider];
    if (!entry) {
      return undefined;
    }

    // Check if expired (lazy evaluation)
    if (entry.endTime <= Date.now()) {
      // Remove expired entry
      delete this.state.entries[provider];
      // Persist cleanup (fire and forget)
      this.store.save(this.state).catch((error) => {
        logger.error("Failed to persist expired cooldown cleanup", { error });
      });
      return undefined;
    }

    return entry;
  }

  /**
   * Checks if a provider is currently on cooldown
   */
  isOnCooldown(provider: string): boolean {
    return this.getCooldown(provider) !== undefined;
  }

  /**
   * Clears cooldown for a specific provider
   */
  clearCooldown(provider: string): boolean {
    if (!this.state.entries[provider]) {
      return false;
    }

    delete this.state.entries[provider];
    this.state.lastUpdated = Date.now();
    
    // Persist to disk (fire and forget)
    this.store.save(this.state).catch((error) => {
      logger.error("Failed to persist cooldown clear", { error });
    });

    logger.info("Cooldown cleared", { provider });
    return true;
  }

  /**
   * Clears all cooldowns
   */
  clearAllCooldowns(): void {
    const count = Object.keys(this.state.entries).length;
    this.state.entries = {};
    this.state.lastUpdated = Date.now();
    
    // Persist to disk (fire and forget)
    this.store.save(this.state).catch((error) => {
      logger.error("Failed to persist cooldowns clear", { error });
    });

    logger.info("All cooldowns cleared", { count });
  }

  /**
   * Gets all active cooldowns
   * Automatically filters out expired entries
   */
  getActiveCooldowns(): CooldownEntry[] {
    const now = Date.now();
    const active: CooldownEntry[] = [];
    const expired: string[] = [];

    for (const [provider, entry] of Object.entries(this.state.entries)) {
      if (entry.endTime > now) {
        active.push(entry);
      } else {
        expired.push(provider);
      }
    }

    // Clean up expired entries
    if (expired.length > 0) {
      for (const provider of expired) {
        delete this.state.entries[provider];
      }
      // Persist cleanup (fire and forget)
      this.store.save(this.state).catch((error) => {
        logger.error("Failed to persist expired cooldowns cleanup", { error });
      });
    }

    return active;
  }

  /**
   * Gets remaining time in seconds for a provider's cooldown
   * Returns 0 if not on cooldown
   */
  getRemainingTime(provider: string): number {
    const entry = this.getCooldown(provider);
    if (!entry) {
      return 0;
    }

    const remaining = Math.ceil((entry.endTime - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  /**
   * Calculates cooldown duration based on configuration and parameters
   */
  private calculateDuration(
    providerName: string,
    reason: CooldownReason,
    explicitDuration?: number,
    retryAfter?: number
  ): number {
    const config = this.configManager.getCurrentConfig();

    // 1. Use explicit duration if provided
    if (explicitDuration !== undefined) {
      return this.clampDuration(explicitDuration);
    }

    // 2. Check for provider-specific override
    const provider = this.findProvider(providerName);
    if (provider?.cooldown) {
      const override = (provider.cooldown as any)[reason];
      if (override !== undefined) {
        return this.clampDuration(override);
      }
    }

    // 3. Use retry-after from provider header if available
    if (retryAfter !== undefined) {
      return this.clampDuration(retryAfter);
    }

    // 4. Use default for reason type
    const defaultDuration = (config.resilience.cooldown.defaults as any)[reason];
    return this.clampDuration(defaultDuration || 60);
  }

  /**
   * Clamps duration between min and max configured values
   */
  private clampDuration(duration: number): number {
    const config = this.configManager.getCurrentConfig();
    const { minDuration, maxDuration } = config.resilience.cooldown;
    return Math.max(minDuration, Math.min(maxDuration, duration));
  }

  /**
   * Finds a provider in config by name
   */
  private findProvider(name: string): ProviderConfig | undefined {
    const config = this.configManager.getCurrentConfig();
    return config.providers.find((p) => p.name === name);
  }
}
