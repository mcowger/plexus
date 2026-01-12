import { watch } from "fs";
import { parse } from "yaml";
import { PlexusConfigSchema, type PlexusConfig } from "./types/config";
import { logger } from "./utils/logger";
import { join } from "path";

let cachedConfig: PlexusConfig | null = null;

/**
 * Resolves environment variable references in config values
 * Supports ${VAR_NAME} syntax
 */
function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === "string") {
    // Replace ${VAR_NAME} with environment variable value
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable not found: ${varName}`);
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVariables(item));
  }

  if (obj !== null && typeof obj === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVariables(value);
    }
    return resolved;
  }

  return obj;
}

/**
 * Validates model alias configuration
 * - Checks for duplicate aliases
 * - Validates target providers exist
 * - Validates target models exist in provider
 * - Warns on disabled providers
 */
function validateModelAliases(config: PlexusConfig): void {
  const allAliases = new Set<string>();
  const providerMap = new Map(config.providers.map((p) => [p.name, p]));

  for (const modelAlias of config.models || []) {
    // Check for duplicate canonical aliases
    if (allAliases.has(modelAlias.alias)) {
      throw new Error(`Duplicate alias name: '${modelAlias.alias}'`);
    }
    allAliases.add(modelAlias.alias);

    // Check for duplicate additional aliases
    if (modelAlias.additionalAliases) {
      for (const additionalAlias of modelAlias.additionalAliases) {
        if (allAliases.has(additionalAlias)) {
          throw new Error(
            `Duplicate alias name: '${additionalAlias}' (used in alias '${modelAlias.alias}')`
          );
        }
        allAliases.add(additionalAlias);
      }
    }

    // Validate targets
    for (const target of modelAlias.targets) {
      const provider = providerMap.get(target.provider);

      if (!provider) {
        throw new Error(
          `Provider '${target.provider}' not found for alias '${modelAlias.alias}'`
        );
      }

      if (!provider.enabled) {
        logger.warn("Alias references disabled provider", {
          alias: modelAlias.alias,
          provider: target.provider,
        });
      }

      if (!provider.models.includes(target.model)) {
        throw new Error(
          `Model '${target.model}' not found in provider '${target.provider}' (alias '${modelAlias.alias}')`
        );
      }
    }
  }

  logger.debug("Model alias validation passed", {
    aliasCount: config.models?.length || 0,
    totalAliases: allAliases.size,
  });
}

/**
 * Loads and validates the Plexus configuration from YAML file
 * Supports environment variable overrides:
 * - PLEXUS_PORT → server.port
 * - PLEXUS_LOG_LEVEL → logging.level
 * - ${VAR_NAME} syntax in config values for environment variable substitution
 */
export async function loadConfig(configPath?: string): Promise<PlexusConfig> {
  const path = configPath || join(process.cwd(), "config", "plexus.yaml");

  try {
    // Check if file exists first to match previous ENOENT behavior
    const file = Bun.file(path);
    if (!(await file.exists())) {
         const error: any = new Error(`Configuration file not found: ${path}`);
         error.code = "ENOENT";
         throw error;
    }

    // Read and parse YAML file
    const fileContents = await file.text();
    const rawConfig = parse(fileContents);

    if (!rawConfig) {
      throw new Error("Configuration file is empty");
    }

    // Resolve environment variables in config
    const configWithEnvVars = resolveEnvVariables(rawConfig);

    // Apply environment variable overrides
    if (process.env.PLEXUS_PORT) {
      const port = parseInt(process.env.PLEXUS_PORT, 10);
      if (!isNaN(port)) {
        (configWithEnvVars as any).server = (configWithEnvVars as any).server || {};
        (configWithEnvVars as any).server.port = port;
      }
    }

    if (process.env.PLEXUS_LOG_LEVEL) {
      (configWithEnvVars as any).logging = (configWithEnvVars as any).logging || {};
      (configWithEnvVars as any).logging.level = process.env.PLEXUS_LOG_LEVEL;
    }

    // Handle DEBUG_MODE environment variable
    if (process.env.DEBUG_MODE) {
      const logging = ((configWithEnvVars as any).logging = (configWithEnvVars as any).logging || {});
      logging.level = "debug";

      const debug = (logging.debug = logging.debug || {});
      debug.enabled = true;
      debug.captureRequests = true;
      debug.captureResponses = true;
    }

    // Validate configuration with Zod
    const config = PlexusConfigSchema.parse(configWithEnvVars);

    // Validate model aliases
    validateModelAliases(config);

    cachedConfig = config;
    logger.info("Configuration loaded successfully", { path });

    return config;
  } catch (error) {
    if (error instanceof Error) {
      if ("code" in error && error.code === "ENOENT") {
        throw new Error(`Configuration file not found: ${path}`);
      }
      
      // Re-throw with better context
      throw new Error(`Failed to load configuration: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Gets the currently loaded configuration
 * Throws if configuration hasn't been loaded yet
 */
export function getConfig(): PlexusConfig {
  if (!cachedConfig) {
    throw new Error("Configuration not loaded. Call loadConfig() first.");
  }
  return cachedConfig;
}

/**
 * Watches the configuration file for changes and reloads automatically
 */
export function watchConfig(
  configPath: string,
  onChange: (config: PlexusConfig) => void
): () => void {
  const watcher = watch(configPath, async (eventType) => {
    if (eventType === "change") {
      try {
        logger.info("Configuration file changed, reloading...");
        const config = await loadConfig(configPath);
        onChange(config);
      } catch (error) {
        logger.error("Failed to reload configuration", { error });
      }
    }
  });

  return () => {
    watcher.close();
  };
}
