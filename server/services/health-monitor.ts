import { logger } from "../utils/logger";
import type { CooldownManager } from "./cooldown-manager";
import type { ConfigManager } from "./config-manager";
import type { PlexusConfig } from "../types/config";
import type {
  SystemHealth,
  SystemHealthStatus,
  ProviderHealth,
} from "../types/health";

/**
 * Monitors system health based on provider cooldown state
 */
export class HealthMonitor {
  constructor(
    private configManager: ConfigManager,
    private cooldownManager: CooldownManager
  ) {}

  /**
   * Gets current system health status
   */
  getSystemHealth(): SystemHealth {
    const config = this.configManager.getCurrentConfig();
    const providers = config.providers;
    const providerHealthList: ProviderHealth[] = [];

    let enabledCount = 0;
    let healthyCount = 0;
    let onCooldownCount = 0;
    let disabledCount = 0;

    for (const provider of providers) {
      const onCooldown = this.cooldownManager.isOnCooldown(provider.name);
      const cooldownEntry = onCooldown
        ? this.cooldownManager.getCooldown(provider.name)
        : undefined;

      const providerHealth: ProviderHealth = {
        name: provider.name,
        enabled: provider.enabled,
        onCooldown,
        cooldownEntry,
        cooldownRemaining: onCooldown
          ? this.cooldownManager.getRemainingTime(provider.name)
          : undefined,
      };

      providerHealthList.push(providerHealth);

      // Count statistics
      if (provider.enabled) {
        enabledCount++;
        if (!onCooldown) {
          healthyCount++;
        } else {
          onCooldownCount++;
        }
      } else {
        disabledCount++;
      }
    }

    // Calculate system status
    const status = this.calculateSystemStatus(enabledCount, onCooldownCount);

    return {
      status,
      timestamp: new Date().toISOString(),
      providers: providerHealthList,
      summary: {
        total: providers.length,
        healthy: healthyCount,
        onCooldown: onCooldownCount,
        disabled: disabledCount,
      },
    };
  }

  /**
   * Calculates overall system health status
   * Based on percentage of enabled providers on cooldown
   */
  private calculateSystemStatus(
    enabledCount: number,
    onCooldownCount: number
  ): SystemHealthStatus {
    const config = this.configManager.getCurrentConfig();

    // If no enabled providers, system is unhealthy
    if (enabledCount === 0) {
      return "unhealthy";
    }

    // Calculate ratio of providers on cooldown
    const cooldownRatio = onCooldownCount / enabledCount;

    const { degradedThreshold, unhealthyThreshold } =
      config.resilience.health;

    if (cooldownRatio >= unhealthyThreshold) {
      return "unhealthy";
    }

    if (cooldownRatio >= degradedThreshold) {
      return "degraded";
    }

    return "healthy";
  }

  /**
   * Gets health status for a specific provider
   */
  getProviderHealth(providerName: string): ProviderHealth | undefined {
    const config = this.configManager.getCurrentConfig();
    const provider = config.providers.find((p) => p.name === providerName);
    if (!provider) {
      return undefined;
    }

    const onCooldown = this.cooldownManager.isOnCooldown(provider.name);
    const cooldownEntry = onCooldown
      ? this.cooldownManager.getCooldown(provider.name)
      : undefined;

    return {
      name: provider.name,
      enabled: provider.enabled,
      onCooldown,
      cooldownEntry,
      cooldownRemaining: onCooldown
        ? this.cooldownManager.getRemainingTime(provider.name)
        : undefined,
    };
  }
}
