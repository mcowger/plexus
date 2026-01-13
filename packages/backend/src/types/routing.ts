import type { ProviderConfig } from "./config";

/**
 * Represents a target backend provider/model combination
 */
export interface ModelTarget {
  provider: string;
  model: string;
  weight?: number; // For weighted random selection
}

/**
 * Selection strategy for choosing among multiple targets
 */
export type SelectorStrategy =
  | "random" // Random selection (uniform or weighted)
  | "in_order" // Try targets in order (for fallback)
  | "cost" // Select by lowest cost (Phase 7)
  | "latency" // Select by lowest latency (Phase 7)
  | "performance"; // Select by best performance (Phase 7)

/**
 * A resolved target with full provider configuration
 */
export interface ResolvedTarget {
  provider: ProviderConfig;
  model: string;
  aliasUsed: string;
  targetIndex: number;
}

/**
 * Result of route resolution
 */
export type RouteResolutionResult =
  | {
      success: true;
      target: ResolvedTarget;
    }
  | {
      success: false;
      error: string;
      code:
        | "ALIAS_NOT_FOUND"
        | "NO_ENABLED_TARGETS"
        | "PROVIDER_NOT_FOUND"
        | "ALL_PROVIDERS_ON_COOLDOWN";
    };

/**
 * Target enriched with provider configuration and health status
 */
export interface TargetWithProvider extends ModelTarget {
  providerConfig: ProviderConfig;
  healthy: boolean; // For future health-based filtering
}

/**
 * Context passed to selector strategies
 */
export interface SelectionContext {
  previousAttempts?: number[]; // Indices of previously tried targets (for failover)
  incomingApiType?: string; // Type of incoming API request
  performanceMetrics?: Record<string, unknown>; // For future use
}
