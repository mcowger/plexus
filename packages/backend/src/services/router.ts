import type { PlexusConfig, ModelAliasConfig, ProviderConfig } from "../types/config";
import type {
  RouteResolutionResult,
  ResolvedTarget,
  TargetWithProvider,
  SelectionContext,
} from "../types/routing";
import { TargetSelector } from "./selector";
import { logger } from "../utils/logger";
import type { CooldownManager } from "./cooldown-manager";
import type { CostCalculator } from "./cost-calculator";
import type { MetricsCollector } from "./metrics-collector";

/**
 * Router service for model alias resolution and target selection
 */
export class Router {
  private aliasMap: Map<string, ModelAliasConfig> = new Map();
  private additionalAliasMap: Map<string, string> = new Map();
  private providerMap: Map<string, ProviderConfig> = new Map();
  private selector: TargetSelector;
  private cooldownManager?: CooldownManager;

  constructor(
    private config: PlexusConfig,
    cooldownManager?: CooldownManager,
    costCalculator?: CostCalculator,
    metricsCollector?: MetricsCollector
  ) {
    this.selector = new TargetSelector(costCalculator, metricsCollector);
    this.cooldownManager = cooldownManager;
    this.buildMaps();
  }

  /**
   * Builds lookup maps from configuration
   * Called on initialization and when configuration changes
   */
  private buildMaps(): void {
    // Clear existing maps
    this.aliasMap.clear();
    this.additionalAliasMap.clear();
    this.providerMap.clear();

    // Build provider map
    for (const provider of this.config.providers) {
      this.providerMap.set(provider.name, provider);
    }

    // Build alias maps
    for (const modelAlias of this.config.models || []) {
      // Add canonical alias
      this.aliasMap.set(modelAlias.alias, modelAlias);

      // Add additional aliases mapping to canonical
      if (modelAlias.additionalAliases) {
        for (const additionalAlias of modelAlias.additionalAliases) {
          this.additionalAliasMap.set(additionalAlias, modelAlias.alias);
        }
      }
    }

    logger.debug("Router maps built", {
      aliases: this.aliasMap.size,
      additionalAliases: this.additionalAliasMap.size,
      providers: this.providerMap.size,
    });
  }

  /**
   * Rebuilds maps when configuration changes
   * @param config - Updated configuration
   */
  updateConfig(config: PlexusConfig): void {
    this.config = config;
    this.buildMaps();
    logger.info("Router configuration updated");
  }

  /**
   * Resolves a model name to a concrete provider/model target
   * @param modelName - Model name from client request
   * @param context - Optional selection context
   * @returns Resolution result with target or error
   */
  resolve(
    modelName: string,
    context: SelectionContext = {}
  ): RouteResolutionResult {
    // Step 1: Check if it's a direct alias
    let aliasConfig = this.aliasMap.get(modelName);
    let aliasUsed = modelName;

    // Step 2: Check if it's an additional alias
    if (!aliasConfig) {
      const canonicalAlias = this.additionalAliasMap.get(modelName);
      if (canonicalAlias) {
        aliasConfig = this.aliasMap.get(canonicalAlias);
        aliasUsed = canonicalAlias;
      }
    }

    // Step 3: Check if it's a raw provider/model format (passthrough)
    if (!aliasConfig) {
      const passthroughResult = this.tryPassthrough(modelName);
      if (passthroughResult) {
        return passthroughResult;
      }
    }

    // Step 4: Not found
    if (!aliasConfig) {
      logger.debug("Model alias not found", { modelName });
      return {
        success: false,
        error: `Model '${modelName}' not found`,
        code: "ALIAS_NOT_FOUND",
      };
    }

    // Filter targets to only enabled providers
    const enabledTargets = this.getEnabledTargets(aliasConfig);

    if (enabledTargets.length === 0) {
      logger.warn("No enabled targets for alias", { alias: aliasUsed });
      return {
        success: false,
        error: `No enabled providers available for model '${modelName}'`,
        code: "NO_ENABLED_TARGETS",
      };
    }

    // Filter out providers on cooldown
    const healthyTargets = this.filterHealthyTargets(enabledTargets);

    if (healthyTargets.length === 0) {
      logger.warn("All targets on cooldown for alias", { alias: aliasUsed });
      
      // Build error message with cooldown info
      const cooldownInfo = this.getCooldownInfo(enabledTargets);
      return {
        success: false,
        error: `All providers for model '${modelName}' are currently unavailable. ${cooldownInfo}`,
        code: "ALL_PROVIDERS_ON_COOLDOWN",
      };
    }

    // Select a target using the configured strategy (from healthy targets)
    const selectedTarget = this.selector.select(
      healthyTargets,
      aliasConfig.selector,
      context
    );

    if (!selectedTarget) {
      return {
        success: false,
        error: `Failed to select target for model '${modelName}'`,
        code: "NO_ENABLED_TARGETS",
      };
    }

    // Find the index of the selected target in the original targets array
    const targetIndex = aliasConfig.targets.findIndex(
      (t) =>
        t.provider === selectedTarget.provider &&
        t.model === selectedTarget.model
    );

    const resolvedTarget: ResolvedTarget = {
      provider: selectedTarget.providerConfig,
      model: selectedTarget.model,
      aliasUsed,
      targetIndex,
    };

    logger.debug("Model resolved", {
      requested: modelName,
      alias: aliasUsed,
      provider: resolvedTarget.provider.name,
      model: resolvedTarget.model,
      strategy: aliasConfig.selector,
    });

    return {
      success: true,
      target: resolvedTarget,
    };
  }

  /**
   * Attempts to resolve model as raw provider/model format
   * E.g., "openai/gpt-4o" -> provider: openai, model: gpt-4o
   */
  private tryPassthrough(modelName: string): RouteResolutionResult | null {
    const parts = modelName.split("/");
    if (parts.length !== 2) {
      return null;
    }

    const [providerName, model] = parts;
    if (!providerName || !model) {
      return null;
    }

    const provider = this.providerMap.get(providerName);

    if (!provider) {
      return null;
    }

    if (!provider.enabled) {
      return {
        success: false,
        error: `Provider '${providerName}' is disabled`,
        code: "NO_ENABLED_TARGETS",
      };
    }

    if (!provider.models.includes(model)) {
      logger.debug("Passthrough rejected: model not found in provider", {
        provider: providerName,
        model,
      });
      return null;
    }

    logger.debug("Model passthrough", { provider: providerName, model });

    return {
      success: true,
      target: {
        provider,
        model,
        aliasUsed: modelName,
        targetIndex: 0,
      },
    };
  }

  /**
   * Filters targets to only those with enabled providers
   */
  private getEnabledTargets(
    aliasConfig: ModelAliasConfig
  ): TargetWithProvider[] {
    const enabledTargets: TargetWithProvider[] = [];

    for (const target of aliasConfig.targets) {
      const provider = this.providerMap.get(target.provider);

      if (!provider) {
        logger.warn("Provider not found for target", {
          alias: aliasConfig.alias,
          provider: target.provider,
        });
        continue;
      }

      if (!provider.enabled) {
        logger.debug("Skipping disabled provider", {
          alias: aliasConfig.alias,
          provider: target.provider,
        });
        continue;
      }

      // Check if model exists in provider's model list
      if (!provider.models.includes(target.model)) {
        logger.warn("Model not found in provider", {
          alias: aliasConfig.alias,
          provider: target.provider,
          model: target.model,
        });
        continue;
      }

      enabledTargets.push({
        ...target,
        providerConfig: provider,
        healthy: true, // Always true for now, health checking in Phase 6
      });
    }

    return enabledTargets;
  }

  /**
   * Gets all available model aliases (for /v1/models endpoint)
   */
  getAllAliases(): Array<{
    id: string;
    description?: string;
    canonicalAlias?: string;
  }> {
    const aliases: Array<{
      id: string;
      description?: string;
      canonicalAlias?: string;
    }> = [];

    // Add canonical aliases
    for (const [alias, config] of this.aliasMap) {
      aliases.push({
        id: alias,
        description: config.description,
      });
    }

    // Add additional aliases
    for (const [additionalAlias, canonicalAlias] of this.additionalAliasMap) {
      aliases.push({
        id: additionalAlias,
        description: `Alias for: ${canonicalAlias}`,
        canonicalAlias,
      });
    }

    return aliases;
  }

  /**
   * Filters targets to only healthy providers (not on cooldown)
   */
  private filterHealthyTargets(
    targets: TargetWithProvider[]
  ): TargetWithProvider[] {
    if (!this.cooldownManager) {
      // No cooldown manager, all targets are healthy
      return targets;
    }

    const healthy = targets.filter((target) => {
      const onCooldown = this.cooldownManager!.isOnCooldown(target.provider);
      if (onCooldown) {
        logger.debug("Filtering out provider on cooldown", {
          provider: target.provider,
          remaining: this.cooldownManager!.getRemainingTime(target.provider),
        });
      }
      return !onCooldown;
    });

    return healthy;
  }

  /**
   * Builds a message describing cooldown status of targets
   */
  private getCooldownInfo(targets: TargetWithProvider[]): string {
    if (!this.cooldownManager) {
      return "";
    }

    const cooldownDetails: string[] = [];
    for (const target of targets) {
      const remaining = this.cooldownManager.getRemainingTime(target.provider);
      if (remaining > 0) {
        cooldownDetails.push(`${target.provider}: ${remaining}s`);
      }
    }

    if (cooldownDetails.length === 0) {
      return "";
    }

    return `Cooldown remaining: ${cooldownDetails.join(", ")}`;
  }
}
