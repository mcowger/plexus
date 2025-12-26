import { 
  ProviderConfig, 
  VirtualKeyConfig, 
  ModelConfig,
  providerConfigSchema,
  virtualKeyConfigSchema,
  modelSchema
} from '@plexus/types';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface ConfigurationSnapshot {
  providers: Map<string, ProviderConfig>;
  virtualKeys: Map<string, VirtualKeyConfig>;
  models: Map<string, ModelConfig>;
  lastLoaded: Date;
}

export class ConfigurationLoader {
  private snapshot: ConfigurationSnapshot | null = null;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config');
  }

  /**
   * Load and validate configuration files
   */
  async loadConfiguration(): Promise<ConfigurationSnapshot> {
    try {
      const providers = await this.loadProviderConfigs();
      const virtualKeys = await this.loadVirtualKeyConfigs();
      const models = await this.loadModelConfigs();

      this.snapshot = {
        providers,
        virtualKeys,
        models,
        lastLoaded: new Date(),
      };

      return this.snapshot;
    } catch (error) {
      logger.error('Failed to load configuration:', error);
      throw new Error(`Configuration loading failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a read-only snapshot of the current configuration
   */
  getSnapshot(): ConfigurationSnapshot | null {
    return this.snapshot ? { ...this.snapshot } : null;
  }

  /**
   * Validate a provider configuration
   */
  validateProviderConfig(config: Object): ProviderConfig {
    try {
      return providerConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid provider configuration: ${error.issues.map((issue: { path: any[]; message: any; }) => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Validate a virtual key configuration
   */
  validateVirtualKeyConfig(config: Object): VirtualKeyConfig {
    try {
      return virtualKeyConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid virtual key configuration: ${error.issues.map((issue: { path: any[]; message: any; }) => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Validate a model configuration
   */
  validateModelConfig(config: Object): ModelConfig {
    try {
      return modelSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid model configuration: ${error.issues.map((issue: { path: any[]; message: any; }) => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Load provider configurations from file
   */
  private async loadProviderConfigs(): Promise<Map<string, ProviderConfig>> {
    const providersPath = path.join(this.configPath, 'providers.json');
    logger.info(`Loading provider configurations from ${providersPath}`);
    
    try {
      const data = await fs.readFile(providersPath, 'utf-8');
      const configs: Object = JSON.parse(data);
      
      const providers = new Map<string, ProviderConfig>();
      
      for (const [name, config] of Object.entries(configs)) {
        const validatedConfig = this.validateProviderConfig(config);
        providers.set(name, validatedConfig);
      }
      
      return providers;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        logger.warn('Provider configuration file not found, using empty configuration');
        return new Map();
      }
      throw error;
    }
  }

  /**
   * Load virtual key configurations from file
   */
  private async loadVirtualKeyConfigs(): Promise<Map<string, VirtualKeyConfig>> {
    const virtualKeysPath = path.join(this.configPath, 'virtual-keys.json');
    logger.info(`Loading virtual key configurations from ${virtualKeysPath}`);
    
    try {
      const data = await fs.readFile(virtualKeysPath, 'utf-8');
      const configs: Object = JSON.parse(data);
      
      const virtualKeys = new Map<string, VirtualKeyConfig>();
      
      for (const [name, config] of Object.entries(configs)) {
        const validatedConfig = this.validateVirtualKeyConfig(config);
        virtualKeys.set(name, validatedConfig);
      }
      
      return virtualKeys;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        logger.warn('Virtual key configuration file not found, using empty configuration');
        return new Map();
      }
      throw error;
    }
  }

  /**
   * Load model configurations from file
   */
  private async loadModelConfigs(): Promise<Map<string, ModelConfig>> {
    const modelsPath = path.join(this.configPath, 'models.json');
    logger.info(`Loading model configurations from ${modelsPath}`);
    
    try {
      const data = await fs.readFile(modelsPath, 'utf-8');
      const configs: Object = JSON.parse(data);
      
      const models = new Map<string, ModelConfig>();
      
      for (const [name, config] of Object.entries(configs)) {
        const validatedConfig = this.validateModelConfig(config);
        models.set(name, validatedConfig);
      }
      
      return models;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        logger.warn('Model configuration file not found, using empty configuration');
        return new Map();
      }
      throw error;
    }
  }

  /**
   * Reload configuration from disk
   */
  async reloadConfiguration(): Promise<ConfigurationSnapshot> {
    return this.loadConfiguration();
  }

  /**
   * Check if configuration is loaded
   */
  isLoaded(): boolean {
    return this.snapshot !== null;
  }

  /**
   * Get configuration status
   */
  getStatus() {
    return {
      loaded: this.isLoaded(),
      lastLoaded: this.snapshot?.lastLoaded,
      providerCount: this.snapshot?.providers.size || 0,
      virtualKeyCount: this.snapshot?.virtualKeys.size || 0,
      modelCount: this.snapshot?.models.size || 0,
    };
  }
}

// Default configuration loader instance
export const configLoader = new ConfigurationLoader();