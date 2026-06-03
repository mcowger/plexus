import type { ProviderConfig } from '../config';
import { ConfigRepository } from '../db/config-repository';
import { logger } from '../utils/logger';
import { discoverProviderModelIds } from './provider-model-discovery';

type ModelsChangedCallback = () => void | Promise<void>;

interface AutosyncConfig {
  providerId: string;
  provider: ProviderConfig;
  intervalMinutes: number;
}

export class ModelAutosyncScheduler {
  private static instance: ModelAutosyncScheduler;
  private configs: Map<string, AutosyncConfig> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private runningProviders: Set<string> = new Set();
  private initialized = false;
  private onModelsChanged?: ModelsChangedCallback;

  private constructor(private repo: ConfigRepository = new ConfigRepository()) {}

  static getInstance(): ModelAutosyncScheduler {
    if (!ModelAutosyncScheduler.instance) {
      ModelAutosyncScheduler.instance = new ModelAutosyncScheduler();
    }
    return ModelAutosyncScheduler.instance;
  }

  static resetInstance(): void {
    ModelAutosyncScheduler.instance = undefined as any;
  }

  initialize(
    providers: Record<string, ProviderConfig>,
    onModelsChanged?: ModelsChangedCallback
  ): void {
    this.initialized = true;
    this.onModelsChanged = onModelsChanged;
    this.reload(providers, onModelsChanged);
  }

  reload(providers: Record<string, ProviderConfig>, onModelsChanged?: ModelsChangedCallback): void {
    if (onModelsChanged) this.onModelsChanged = onModelsChanged;

    const nextConfigs = new Map<string, AutosyncConfig>();
    for (const [providerId, provider] of Object.entries(providers)) {
      if (provider.enabled === false) continue;
      if (provider.model_autosync?.enabled !== true) continue;

      nextConfigs.set(providerId, {
        providerId,
        provider,
        intervalMinutes: Math.max(1, provider.model_autosync.intervalMinutes ?? 60),
      });
    }

    for (const providerId of this.configs.keys()) {
      if (!nextConfigs.has(providerId)) this.unschedule(providerId);
    }

    for (const [providerId, config] of nextConfigs) {
      const existing = this.configs.get(providerId);
      this.configs.set(providerId, config);

      if (!existing || existing.intervalMinutes !== config.intervalMinutes) {
        this.unschedule(providerId);
        this.schedule(config);
        this.runSyncNow(providerId).catch((error) => {
          logger.error(`Initial model autosync failed for provider '${providerId}': ${error}`);
        });
      }
    }
  }

  async runSyncNow(providerId: string): Promise<number> {
    const config = this.configs.get(providerId);
    if (!config) {
      logger.warn(`Model autosync config for provider '${providerId}' not found`);
      return 0;
    }

    if (this.runningProviders.has(providerId)) {
      logger.debug(`Model autosync for provider '${providerId}' is already running`);
      return 0;
    }

    this.runningProviders.add(providerId);
    try {
      const modelIds = await discoverProviderModelIds(config.provider);
      if (modelIds.length === 0) {
        logger.info(`Model autosync found no models for provider '${providerId}'`);
        return 0;
      }

      const added = await this.repo.addMissingProviderModels(providerId, modelIds);
      logger.info(
        `Model autosync for provider '${providerId}' discovered ${modelIds.length} models, added ${added}`
      );

      if (added > 0) await this.onModelsChanged?.();
      return added;
    } catch (error) {
      logger.error(`Model autosync failed for provider '${providerId}': ${error}`);
      return 0;
    } finally {
      this.runningProviders.delete(providerId);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  stop(): void {
    for (const [providerId, intervalId] of this.intervals) {
      clearInterval(intervalId);
      logger.info(`Stopped model autosync for provider '${providerId}'`);
    }
    this.intervals.clear();
    this.configs.clear();
    this.runningProviders.clear();
    this.initialized = false;
  }

  private schedule(config: AutosyncConfig): void {
    const intervalMs = config.intervalMinutes * 60 * 1000;
    const intervalId = setInterval(() => this.runSyncNow(config.providerId), intervalMs);
    this.intervals.set(config.providerId, intervalId);
    logger.info(
      `Scheduled model autosync for provider '${config.providerId}' every ${config.intervalMinutes} minutes`
    );
  }

  private unschedule(providerId: string): void {
    const intervalId = this.intervals.get(providerId);
    if (intervalId) clearInterval(intervalId);
    this.intervals.delete(providerId);
    this.configs.delete(providerId);
  }
}
