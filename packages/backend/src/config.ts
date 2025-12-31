import { z } from 'zod';
import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { logger } from './utils/logger';

// --- Zod Schemas ---

const TransformerConfigSchema = z.object({
  use: z.array(z.tuple([z.string(), z.any()])).optional(),
});

const ProviderConfigSchema = z.object({
  type: z.string(),
  display_name: z.string().optional(),
  api_base_url: z.string().url(),
  api_key: z.string().optional(),
  models: z.array(z.string()).optional(),
  headers: z.record(z.string()).optional(),
});

const ModelTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

const ModelConfigSchema = z.object({
  targets: z.array(ModelTargetSchema),
});

const PlexusConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  models: z.record(z.string(), ModelConfigSchema),
});

export type PlexusConfig = z.infer<typeof PlexusConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// --- Loader ---

let currentConfig: PlexusConfig | null = null;
let configWatcher: fs.FSWatcher | null = null;

function logConfigStats(config: PlexusConfig) {
    const providerCount = Object.keys(config.providers).length;
    logger.info(`Loaded ${providerCount} Providers:`);
    Object.entries(config.providers).forEach(([name, provider]) => {
      const modelCount = provider.models ? provider.models.length : 0;
      logger.info(`  - ${name}: ${modelCount} models`);
    });

    const aliasCount = Object.keys(config.models).length;
    logger.info(`Loaded ${aliasCount} Model Aliases:`);
    Object.entries(config.models).forEach(([name, alias]) => {
      const targetCount = alias.targets.length;
      logger.info(`  - ${name}: ${targetCount} targets`);
    });
}

function parseConfigFile(filePath: string): PlexusConfig {
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.parse(fileContents);
  const config = PlexusConfigSchema.parse(parsed);
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
                
                debounceTimer = setTimeout(() => {
                    logger.info('Configuration file changed, reloading...');
                    try {
                        const newConfig = parseConfigFile(filePath);
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

export function loadConfig(configPath?: string): PlexusConfig {
  if (currentConfig) return currentConfig;

  // Default path assumes running from packages/backend, but we want it relative to project root
  const projectRoot = path.resolve(process.cwd(), '../../');
  const defaultPath = path.resolve(projectRoot, 'config/plexus.yaml');
  const finalPath = configPath || process.env.CONFIG_FILE || defaultPath;
  
  logger.info(`Loading configuration from ${finalPath}`);

  if (!fs.existsSync(finalPath)) {
    logger.error(`Configuration file not found at ${finalPath}`);
    throw new Error(`Configuration file not found at ${finalPath}`);
  }

  try {
    currentConfig = parseConfigFile(finalPath);
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
        // Auto-load if not loaded? Or throw?
        // Let's auto-load for convenience if possible
        return loadConfig();
    }
    return currentConfig;
}