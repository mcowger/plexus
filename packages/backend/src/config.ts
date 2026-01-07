import { z } from 'zod';
import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { logger } from './utils/logger';

// --- Zod Schemas ---

const PricingRangeSchema = z.object({
  // This strategy is used to define a range of pricing for a model
  // There can be multiple ranges defined for different usage levels
  // They are based on the number of input tokens.
  // If the input token count falls within a range, the corresponding pricing applies.
  // Example: 
  //   lower_bound: 0, upper_bound: 1000, input_per_m: 0.01, output_per_m: 0.02 
  //   ## In the above case, if the number of input tokens is between 0 and 1000, the pricing will be 0.01 per million input tokens and 0.02 per million output tokens
  //   lower_bound: 1001, upper_bound: 5000, input_per_m: 0.008, output_per_m: 0.018
  //   ## In the above case, if the number of input tokens is between 1001 and 5000, the pricing will be 0.008 per million input tokens and 0.018 per million output tokens
  //.  # If the upper bound is Infinity, the pricing will apply to all token counts above the lower bound
  lower_bound: z.number().min(0).default(0), 
  upper_bound: z.number().default(Infinity),
  input_per_m: z.number().min(0),
  output_per_m: z.number().min(0),
  cached_per_m: z.number().min(0).optional(),
});

const PricingSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('openrouter'),
    slug: z.string(),
    discount: z.number().min(0).max(1).optional(),
  }),
  z.object({
    source: z.literal('defined'),
    range: z.array(PricingRangeSchema).min(1),
  }),
  z.object({
    source: z.literal('simple'),
    input: z.number().min(0),
    output: z.number().min(0),
    cached: z.number().min(0).optional(),
  }),
]);

const ModelProviderConfigSchema = z.object({
  pricing: PricingSchema.default({
    source: 'simple',
    input: 0,
    output: 0,
  }),
  access_via: z.array(z.string()).optional(),
});

const ProviderConfigSchema = z.object({
  type: z.union([z.string(), z.array(z.string())]),
  display_name: z.string().optional(),
  api_base_url: z.union([z.string().url(), z.record(z.string())]),
  api_key: z.string().optional(),
  oauth_provider: z.string().optional(),
  oauth_account_pool: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().default(true).optional(),
  discount: z.number().min(0).max(1).optional(),
  models: z.union([
    z.array(z.string()),
    z.record(z.string(), ModelProviderConfigSchema)
  ]).optional(),
  headers: z.record(z.string()).optional(),
  extraBody: z.record(z.any()).optional(),
  force_transformer: z.string().optional(),
}).refine(
  (data) => {
    // Either api_key OR oauth_provider must be present, but not neither
    if (!data.api_key && !data.oauth_provider) {
      return false;
    }
    // If oauth_provider is specified, oauth_account_pool is required
    if (data.oauth_provider && !data.oauth_account_pool) {
      return false;
    }
    return true;
  },
  {
    message: "Either 'api_key' must be specified, OR both 'oauth_provider' and 'oauth_account_pool' must be specified",
  }
).refine(
  (data) => {
    // Claude Code OAuth must use type 'messages'
    if (data.oauth_provider === 'claude-code') {
      const types = Array.isArray(data.type) ? data.type : [data.type];
      if (!types.includes('messages')) {
        return false;
      }
    }
    return true;
  },
  {
    message: "Claude Code OAuth provider must use type 'messages'",
  }
);

const ModelTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

const ModelConfigSchema = z.object({
  selector: z.enum(['random', 'cost', 'latency', 'usage', 'performance']).optional(),
  priority: z.enum(['selector', 'api_match']).default('selector'),
  targets: z.array(ModelTargetSchema),
  additional_aliases: z.array(z.string()).optional(),
});

const KeyConfigSchema = z.object({
  secret: z.string(),
  comment: z.string().optional(),
});

const PlexusConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  models: z.record(z.string(), ModelConfigSchema),
  keys: z.record(z.string(), KeyConfigSchema),
  adminKey: z.string(),
});

export type PlexusConfig = z.infer<typeof PlexusConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type ModelTarget = z.infer<typeof ModelTargetSchema>;

// --- Loader ---

let currentConfig: PlexusConfig | null = null;
let currentConfigPath: string | null = null;
let configWatcher: fs.FSWatcher | null = null;

function logConfigStats(config: PlexusConfig) {
    const providerCount = Object.keys(config.providers).length;
    logger.info(`Loaded ${providerCount} Providers:`);
    Object.entries(config.providers).forEach(([name, provider]) => {
      let modelCount = 0;
      if (Array.isArray(provider.models)) {
        modelCount = provider.models.length;
      } else if (provider.models) {
        modelCount = Object.keys(provider.models).length;
      }
      logger.info(`  - ${name}: ${modelCount} models`);
    });

    const aliasCount = Object.keys(config.models).length;
    logger.info(`Loaded ${aliasCount} Model Aliases:`);
    Object.entries(config.models).forEach(([name, alias]) => {
      const targetCount = alias.targets.length;
      let msg = `  - ${name}: ${targetCount} targets`;
      if (alias.additional_aliases && alias.additional_aliases.length > 0) {
        msg += ` (aliases: ${alias.additional_aliases.join(', ')})`;
      }
      logger.info(msg);
    });

    if (config.keys) {
      const keyCount = Object.keys(config.keys).length;
      logger.info(`Loaded ${keyCount} API Keys:`);
      Object.keys(config.keys).forEach((keyName) => {
        logger.info(`  - ${keyName}`);
      });
    }
}

export function validateConfig(yamlContent: string): PlexusConfig {
  const parsed = yaml.parse(yamlContent);
  return PlexusConfigSchema.parse(parsed);
}

async function parseConfigFile(filePath: string): Promise<PlexusConfig> {
  const file = Bun.file(filePath);
  const fileContents = await file.text();
  const config = validateConfig(fileContents);
  logConfigStats(config);
  return config;
}

function setupWatcher(filePath: string) {
    if (configWatcher) return;
    
    logger.info(`Watching configuration file: ${filePath}`);
    let debounceTimer: NodeJS.Timeout | null = null;

    try {
        configWatcher = fs.watch(filePath, (eventType) => {
            if (eventType === 'change') {
                if (debounceTimer) clearTimeout(debounceTimer);
                
                debounceTimer = setTimeout(async () => {
                    logger.info('Configuration file changed, reloading...');
                    try {
                        const newConfig = await parseConfigFile(filePath);
                        currentConfig = newConfig;
                        logger.info('Configuration reloaded successfully');
                    } catch (error) {
                        logger.error('Failed to reload configuration', { error });
                         if (error instanceof z.ZodError) {
                             logger.error('Validation errors:', error.errors);
                         }
                    }
                }, 100);
            }
        });
    } catch (err) {
        logger.error('Failed to setup config watcher', err);
    }
}

export async function loadConfig(configPath?: string): Promise<PlexusConfig> {
  if (currentConfig && !configPath) return currentConfig;

  // Default path assumes running from packages/backend, but we want it relative to project root
  const projectRoot = path.resolve(process.cwd(), '../../');
  const defaultPath = path.resolve(projectRoot, 'config/plexus.yaml');
  const finalPath = configPath || process.env.CONFIG_FILE || defaultPath;
  
  logger.info(`Loading configuration from ${finalPath}`);

  const file = Bun.file(finalPath);
  if (!(await file.exists())) {
    logger.error(`Configuration file not found at ${finalPath}`);
    throw new Error(`Configuration file not found at ${finalPath}`);
  }

  try {
    currentConfig = await parseConfigFile(finalPath);
    currentConfigPath = finalPath;
    logger.info('Configuration loaded successfully');
    
    setupWatcher(finalPath);
    
    return currentConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error('Configuration validation failed', { errors: error.errors });
    }
    throw error;
  }
}

export function getConfig(): PlexusConfig {
    if (!currentConfig) {
        throw new Error("Configuration not loaded. Call loadConfig() first.");
    }
    return currentConfig;
}

export function getConfigPath(): string | null {
    return currentConfigPath;
}

export function setConfigForTesting(config: PlexusConfig) {
    currentConfig = config;
}