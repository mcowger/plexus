import type { CompactionSettings, McpOAuthSettings } from '../../lib/api';

export interface FailoverPolicy {
  enabled: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

export interface CooldownPolicy {
  initialMinutes: number;
  maxMinutes: number;
}

export interface ExplorationRates {
  performanceExplorationRate: number;
  latencyExplorationRate: number;
  e2ePerformanceExplorationRate: number;
}

export interface BackgroundExplorationConfig {
  enabled: boolean;
  stalenessThresholdSeconds: number;
  workerConcurrency: number;
}

export interface TimeoutConfig {
  defaultSeconds: number;
}

export interface StallConfig {
  ttfbSeconds: number | null;
  ttfbBytes: number;
  minBytesPerSecond: number | null;
  windowSeconds: number;
  gracePeriodSeconds: number;
}

export interface FieldValidation<T = number> {
  valid: boolean;
  value?: T | null;
  error?: string;
}
export const DEFAULT_EXPLORATION_RATES: ExplorationRates = {
  performanceExplorationRate: 0.05,
  latencyExplorationRate: 0.05,
  e2ePerformanceExplorationRate: 0.05,
};

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultSeconds: 300,
};

export const DEFAULT_STALL_CONFIG: StallConfig = {
  ttfbSeconds: null,
  ttfbBytes: 100,
  minBytesPerSecond: null,
  windowSeconds: 10,
  gracePeriodSeconds: 30,
};

export const DEFAULT_BACKGROUND_EXPLORATION: BackgroundExplorationConfig = {
  enabled: false,
  stalenessThresholdSeconds: 600,
  workerConcurrency: 2,
};

export const DEFAULT_COMPACTION_CONFIG: CompactionSettings = { enabled: false, strategy: 'native' };

export const DEFAULT_FAILOVER_POLICY: FailoverPolicy = {
  enabled: true,
  retryableStatusCodes: [],
  retryableErrors: [],
};

export const DEFAULT_MCP_OAUTH_CONFIG: McpOAuthSettings = {
  enabled: false,
  provider: 'plexus-idp',
};

export const DEFAULT_COOLDOWN_POLICY: CooldownPolicy = {
  initialMinutes: 2,
  maxMinutes: 300,
};
