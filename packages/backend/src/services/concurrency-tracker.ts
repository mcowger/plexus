import { logger } from '../utils/logger';
import { getConfig } from '../config';

export interface ConcurrencySnapshot {
  providers: Record<string, number>;
  targets: Record<string, number>;
}

export class ConcurrencyTracker {
  private static instance: ConcurrencyTracker;
  private providerCounts = new Map<string, number>();
  private providerModelCounts = new Map<string, number>();

  private constructor() {}

  public static getInstance(): ConcurrencyTracker {
    if (!ConcurrencyTracker.instance) {
      ConcurrencyTracker.instance = new ConcurrencyTracker();
    }
    return ConcurrencyTracker.instance;
  }

  /** For testing only */
  public static resetForTesting(): void {
    ConcurrencyTracker.instance = undefined as any;
  }

  /**
   * Attempt to acquire a concurrency slot for the given provider and model.
   * Returns true if acquired, false if either the provider-wide or model-specific
   * limit would be exceeded.
   */
  public acquire(provider: string, model: string): boolean {
    const config = getConfig();
    const providerConfig = config.providers[provider];
    if (!providerConfig) {
      // Provider not found — shouldn't happen in normal flow, but be permissive
      return true;
    }

    const providerLimit = providerConfig.maxConcurrency;
    const modelConfig =
      !Array.isArray(providerConfig.models) && providerConfig.models
        ? providerConfig.models[model]
        : undefined;
    const modelLimit = modelConfig?.maxConcurrency;

    if (providerLimit != null) {
      const current = this.providerCounts.get(provider) || 0;
      if (current >= providerLimit) {
        logger.debug(
          `ConcurrencyTracker: provider '${provider}' limit ${providerLimit} reached (${current} in-flight)`
        );
        return false;
      }
    }

    if (modelLimit != null) {
      const key = `${provider}/${model}`;
      const current = this.providerModelCounts.get(key) || 0;
      if (current >= modelLimit) {
        logger.debug(
          `ConcurrencyTracker: target '${key}' limit ${modelLimit} reached (${current} in-flight)`
        );
        return false;
      }
    }

    this.providerCounts.set(provider, (this.providerCounts.get(provider) || 0) + 1);
    this.providerModelCounts.set(
      `${provider}/${model}`,
      (this.providerModelCounts.get(`${provider}/${model}`) || 0) + 1
    );
    return true;
  }

  /**
   * Release a concurrency slot. Safe to call multiple times for the same
   * provider/model — subsequent calls are no-ops.
   */
  public release(provider: string, model: string): void {
    const providerCount = Math.max(0, (this.providerCounts.get(provider) || 0) - 1);
    if (providerCount === 0) {
      this.providerCounts.delete(provider);
    } else {
      this.providerCounts.set(provider, providerCount);
    }

    const key = `${provider}/${model}`;
    const modelCount = Math.max(0, (this.providerModelCounts.get(key) || 0) - 1);
    if (modelCount === 0) {
      this.providerModelCounts.delete(key);
    } else {
      this.providerModelCounts.set(key, modelCount);
    }
  }

  public getProviderCount(provider: string): number {
    return this.providerCounts.get(provider) || 0;
  }

  public getTargetCount(provider: string, model: string): number {
    return this.providerModelCounts.get(`${provider}/${model}`) || 0;
  }

  public getSnapshot(): ConcurrencySnapshot {
    const providers: Record<string, number> = {};
    const targets: Record<string, number> = {};
    for (const [k, v] of this.providerCounts.entries()) {
      providers[k] = v;
    }
    for (const [k, v] of this.providerModelCounts.entries()) {
      targets[k] = v;
    }
    return { providers, targets };
  }
}
