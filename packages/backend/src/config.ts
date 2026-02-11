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
  type: z.enum(['chat', 'responses', 'embeddings', 'transcriptions', 'speech', 'image']).optional(),
});

const OAuthProviderSchema = z.enum([
  'anthropic',
  'openai-codex',
  'github-copilot',
  'google-gemini-cli',
  'google-antigravity'
]);

const ProviderQuotaCheckerSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().min(1).default(30),
  id: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1),
  options: z.record(z.any()).default({}),
});

const ProviderConfigSchema = z.object({
  display_name: z.string().optional(),
  api_base_url: z.union([
    z.string().refine((value) => isValidUrlOrOAuth(value), {
      message: "api_base_url must be a valid URL or oauth://"
    }),
    z.record(z.string())
  ]),
  api_key: z.string().optional(),
  oauth_provider: OAuthProviderSchema.optional(),
  oauth_account: z.string().min(1).optional(),
  enabled: z.boolean().default(true).optional(),
  discount: z.number().min(0).max(1).optional(),
  models: z.union([
    z.array(z.string()),
    z.record(z.string(), ModelProviderConfigSchema)
  ]).optional(),
  headers: z.record(z.string()).optional(),
  extraBody: z.record(z.any()).optional(),
  estimateTokens: z.boolean().optional().default(false),
  quota_checker: ProviderQuotaCheckerSchema.optional(),
})
  .refine(
    (data) => !!data.api_key || isOAuthProviderConfig(data),
    { message: "'api_key' must be specified for provider" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_provider,
    { message: "'oauth_provider' must be specified when using oauth://" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_account,
    { message: "'oauth_account' must be specified when using oauth://" }
  );

const ModelTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean().default(true).optional(),
});

const ModelConfigSchema = z.object({
  selector: z.enum(['random', 'in_order', 'cost', 'latency', 'usage', 'performance']).optional(),
  priority: z.enum(['selector', 'api_match']).default('selector'),
  targets: z.array(ModelTargetSchema),
  additional_aliases: z.array(z.string()).optional(),
  type: z.enum(['chat', 'responses', 'embeddings', 'transcriptions', 'speech', 'image']).optional(),
});

const KeyConfigSchema = z.object({
  secret: z.string(),
  comment: z.string().optional(),
});

const QuotaConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  provider: z.string(),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().min(1).default(30),
  options: z.record(z.any()).default({}),
});

const RawPlexusConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema),
  models: z.record(z.string(), ModelConfigSchema),
  keys: z.record(z.string(), KeyConfigSchema),
  adminKey: z.string(),
  performanceExplorationRate: z.number().min(0).max(1).default(0.05).optional(),
  latencyExplorationRate: z.number().min(0).max(1).default(0.05).optional(),
});

export type PlexusConfig = z.infer<typeof RawPlexusConfigSchema> & {
  quotas: QuotaConfig[];
};
export type DatabaseConfig = {
  connectionString: string;
};
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type ModelTarget = z.infer<typeof ModelTargetSchema>;
export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;

/**
 * Extract supported API types from the provider configuration.
 * Infers types from api_base_url field: if it's a record/map, the keys are the supported types.
 * If it's a string, we infer the type from the URL pattern.
 * @param provider The provider configuration
 * @returns Array of supported API types (e.g., ["chat"], ["messages"], ["chat", "messages"])
 */
export function getProviderTypes(provider: ProviderConfig): string[] {
  if (typeof provider.api_base_url === 'string') {
    // Single URL - infer type from URL pattern
    const url = provider.api_base_url.toLowerCase();

    if (url.startsWith('oauth://')) {
      return ['oauth'];
    }

    // Check for known patterns
    if (url.includes('anthropic.com')) {
      return ['messages'];
    } else if (url.includes('generativelanguage.googleapis.com')) {
      return ['gemini'];
    } else {
      // Default to 'chat' for OpenAI-compatible APIs
      return ['chat'];
    }
  } else {
    // Record/map format - keys are the supported types
    const urlMap = provider.api_base_url as Record<string, string>;
    return Object.keys(urlMap).filter(key => {
      const value = urlMap[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
}

export function getAuthJsonPath(): string {
  return process.env.AUTH_JSON || './auth.json';
}

function isValidUrlOrOAuth(value: string): boolean {
  if (value.startsWith('oauth://')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isOAuthProviderConfig(provider: { api_base_url: string | Record<string, string> }): boolean {
  if (typeof provider.api_base_url === 'string') {
    return provider.api_base_url.startsWith('oauth://');
  }
  return Object.values(provider.api_base_url).some((value) => value.startsWith('oauth://'));
}

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

    if (config.quotas) {
      const quotaCount = config.quotas.length;
      logger.info(`Loaded ${quotaCount} Quota Checkers:`);
      config.quotas.forEach((quota) => {
        logger.info(`  - ${quota.id}: ${quota.type} (${quota.provider}) every ${quota.intervalMinutes}m`);
      });
    }
}

export function validateConfig(yamlContent: string): PlexusConfig {
  const parsed = yaml.parse(yamlContent);
  const { parsed: migrated } = migrateOAuthAccounts(parsed);
  const rawConfig = RawPlexusConfigSchema.parse(migrated);
  return hydrateConfig(rawConfig);
}

function hydrateConfig(config: z.infer<typeof RawPlexusConfigSchema>): PlexusConfig {
  return {
    ...config,
    quotas: buildProviderQuotaConfigs(config),
  };
}

function migrateOAuthAccounts(parsed: unknown): {
  parsed: unknown;
  migrated: boolean;
  migratedProviders: string[];
} {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { parsed, migrated: false, migratedProviders: [] };
  }

  const root = parsed as Record<string, unknown>;
  const providersValue = root.providers;
  if (!providersValue || typeof providersValue !== 'object' || Array.isArray(providersValue)) {
    return { parsed, migrated: false, migratedProviders: [] };
  }

  const providers = providersValue as Record<string, unknown>;
  const migratedProviders: string[] = [];

  for (const [providerId, providerValue] of Object.entries(providers)) {
    if (!providerValue || typeof providerValue !== 'object' || Array.isArray(providerValue)) {
      continue;
    }

    const providerConfig = providerValue as Record<string, unknown>;
    const baseUrl = providerConfig.api_base_url;
    const isOAuth =
      (typeof baseUrl === 'string' && baseUrl.startsWith('oauth://')) ||
      (typeof baseUrl === 'object' &&
        baseUrl !== null &&
        !Array.isArray(baseUrl) &&
        Object.values(baseUrl as Record<string, unknown>).some(
          (value) => typeof value === 'string' && value.startsWith('oauth://')
        ));

    if (!isOAuth) {
      continue;
    }

    const oauthAccount = providerConfig.oauth_account;
    if (typeof oauthAccount !== 'string' || oauthAccount.trim().length === 0) {
      providerConfig.oauth_account = 'legacy';
      migratedProviders.push(providerId);
    }
  }

  return {
    parsed,
    migrated: migratedProviders.length > 0,
    migratedProviders
  };
}

function buildProviderQuotaConfigs(config: z.infer<typeof RawPlexusConfigSchema>): QuotaConfig[] {
  const quotas: QuotaConfig[] = [];
  const seenIds = new Set<string>();

  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.enabled === false) {
      continue;
    }

    const quotaChecker = providerConfig.quota_checker;
    if (!quotaChecker || quotaChecker.enabled === false) {
      continue;
    }

    const checkerId = (quotaChecker.id ?? providerId).trim();
    if (!checkerId) {
      throw new Error(`Provider '${providerId}' has an invalid quota checker id`);
    }

    if (seenIds.has(checkerId)) {
      throw new Error(`Duplicate quota checker id '${checkerId}' found in provider '${providerId}'`);
    }
    seenIds.add(checkerId);

    const checkerType = quotaChecker.type;

    const options: Record<string, unknown> = {
      ...(quotaChecker.options ?? {}),
    };

    const apiKey = providerConfig.api_key?.trim();
    if (apiKey && apiKey.toLowerCase() !== 'oauth' && options.apiKey === undefined) {
      options.apiKey = apiKey;
    }

    if (providerConfig.oauth_provider && options.oauthProvider === undefined) {
      options.oauthProvider = providerConfig.oauth_provider;
    }

    if (providerConfig.oauth_account && options.oauthAccountId === undefined) {
      options.oauthAccountId = providerConfig.oauth_account;
    }

    quotas.push({
      id: checkerId,
      provider: providerId,
      type: checkerType,
      enabled: true,
      intervalMinutes: quotaChecker.intervalMinutes,
      options,
    });
  }

  return quotas;
}

async function parseConfigFile(filePath: string): Promise<PlexusConfig> {
  const file = Bun.file(filePath);
  const fileContents = await file.text();
  const parsed = yaml.parse(fileContents);
  const { parsed: migratedParsed, migrated, migratedProviders } = migrateOAuthAccounts(parsed);

  if (migrated) {
    const migratedYaml = yaml.stringify(migratedParsed);
    await Bun.write(filePath, migratedYaml);
    logger.warn(
      `Auto-migrated OAuth provider config with oauth_account='legacy' for: ${migratedProviders.join(', ')}`
    );
  }

  const rawConfig = RawPlexusConfigSchema.parse(migratedParsed);
  const finalConfig = hydrateConfig(rawConfig);
  logConfigStats(finalConfig);
  return finalConfig;
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

export function getDatabaseConfig(): DatabaseConfig | null {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        return null;
    }
    return { connectionString: databaseUrl };
}
