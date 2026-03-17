import { z } from 'zod';
import yaml from 'yaml';
import { logger } from './utils/logger';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from './utils/constants';

// --- Zod Schemas ---

const DEFAULT_RETRYABLE_STATUS_CODES = Array.from(
  { length: 500 },
  (_, index) => index + 100
).filter((code) => !(code >= 200 && code <= 299) && code !== 413 && code !== 422);

const FailoverPolicySchema = z.object({
  enabled: z.boolean().default(true),
  retryableStatusCodes: z
    .array(z.number().int().min(100).max(599))
    .default(DEFAULT_RETRYABLE_STATUS_CODES),
  retryableErrors: z.array(z.string().min(1)).default(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']),
});

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
  cache_write_per_m: z.number().min(0).optional(),
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
    cache_write: z.number().min(0).optional(),
  }),
  z.object({
    source: z.literal('per_request'),
    amount: z.number().min(0),
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
  'google-antigravity',
]);

const NagaQuotaCheckerOptionsSchema = z.object({
  apiKey: z.string().min(1, 'Naga provisioning key is required'),
  max: z.number().positive('Max balance must be a positive number').optional(),
  endpoint: z.string().url().optional(),
});

const SyntheticQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const NanoGPTQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const ZAIQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const MoonshotQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const MiniMaxQuotaCheckerOptionsSchema = z.object({
  groupid: z.string().trim().min(1, 'MiniMax groupid is required'),
  hertzSession: z.string().trim().min(1, 'MiniMax HERTZ-SESSION cookie value is required'),
});

const MiniMaxCodingQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const OpenRouterQuotaCheckerOptionsSchema = z.object({
  apiKey: z.string().min(1, 'OpenRouter management key is required'),
  endpoint: z.string().url().optional(),
});

const KiloQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
  organizationId: z.string().trim().min(1).optional(),
});

const OpenAICodexQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
  userAgent: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const KimiCodeQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const ClaudeCodeQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const CopilotQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
  userAgent: z.string().trim().min(1).optional(),
  editorVersion: z.string().trim().min(1).optional(),
  apiVersion: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const WisdomGateQuotaCheckerOptionsSchema = z.object({
  session: z.string().trim().min(1, 'Session cookie is required'),
  endpoint: z.string().url().optional(),
});

const GeminiCliQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
  userAgent: z.string().trim().min(1).optional(),
  googApiClient: z.string().trim().min(1).optional(),
  clientMetadata: z.string().trim().min(1).optional(),
});

const AntigravityQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const ApertisQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const PoeQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
});

const ProviderQuotaCheckerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('naga'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: NagaQuotaCheckerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('synthetic'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: SyntheticQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('nanogpt'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: NanoGPTQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('zai'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: ZAIQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('moonshot'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: MoonshotQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('minimax'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: MiniMaxQuotaCheckerOptionsSchema,
  }),
  z.object({
    type: z.literal('openrouter'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: OpenRouterQuotaCheckerOptionsSchema,
  }),
  z.object({
    type: z.literal('kilo'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: KiloQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('openai-codex'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: OpenAICodexQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('kimi-code'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: KimiCodeQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('claude-code'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: ClaudeCodeQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('copilot'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: CopilotQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('wisdomgate'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: WisdomGateQuotaCheckerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('apertis'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: ApertisQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('apertis-coding-plan'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: ApertisQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('minimax-coding'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: MiniMaxCodingQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('poe'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: PoeQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('gemini-cli'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: GeminiCliQuotaCheckerOptionsSchema.optional().default({}),
  }),
  z.object({
    type: z.literal('antigravity'),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: AntigravityQuotaCheckerOptionsSchema.optional().default({}),
  }),
]);

export const ProviderConfigSchema = z
  .object({
    display_name: z.string().optional(),
    api_base_url: z.union([
      z.string().refine((value) => isValidUrlOrOAuth(value), {
        message: 'api_base_url must be a valid URL or oauth://',
      }),
      z.record(z.string()),
    ]),
    api_key: z.string().optional(),
    oauth_provider: OAuthProviderSchema.optional(),
    oauth_account: z.string().min(1).optional(),
    enabled: z.boolean().default(true).optional(),
    disable_cooldown: z.boolean().optional().default(false),
    discount: z.number().min(0).max(1).optional(),
    models: z
      .union([z.array(z.string()), z.record(z.string(), ModelProviderConfigSchema)])
      .optional(),
    headers: z.record(z.string()).optional(),
    extraBody: z.record(z.any()).optional(),
    estimateTokens: z.boolean().optional().default(false),
    quota_checker: ProviderQuotaCheckerSchema.optional(),
  })
  .refine((data) => !!data.api_key || isOAuthProviderConfig(data), {
    message: "'api_key' must be specified for provider",
  })
  .refine((data) => !isOAuthProviderConfig(data) || !!data.oauth_provider, {
    message: "'oauth_provider' must be specified when using oauth://",
  })
  .refine((data) => !isOAuthProviderConfig(data) || !!data.oauth_account, {
    message: "'oauth_account' must be specified when using oauth://",
  });

const ModelTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean().default(true).optional(),
});

// Quota definition schemas for user quota enforcement
export const QuotaDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rolling'),
    limitType: z.enum(['requests', 'tokens']),
    limit: z.number().min(1),
    duration: z.string().min(1), // e.g., "1h", "30m", "1d"
  }),
  z.object({
    type: z.literal('daily'),
    limitType: z.enum(['requests', 'tokens']),
    limit: z.number().min(1),
  }),
  z.object({
    type: z.literal('weekly'),
    limitType: z.enum(['requests', 'tokens']),
    limit: z.number().min(1),
  }),
]);

// ─── Model Behaviors ───────────────────────────────────────────────
// Each behavior has a `type` discriminant so new behaviors can be added without
// touching existing ones.  Add new z.object({ type: z.literal('...'), ... })
// entries to the discriminatedUnion array.

const StripAdaptiveThinkingBehaviorSchema = z.object({
  type: z.literal('strip_adaptive_thinking'),
  enabled: z.boolean().default(true),
});

// Union of all known behavior schemas – extend here for future behaviors
const ModelBehaviorSchema = z.discriminatedUnion('type', [StripAdaptiveThinkingBehaviorSchema]);

// ─── Model Metadata ──────────────────────
// Optional reference to an external model catalog entry. When configured,
// Plexus fetches metadata at startup and includes it in GET /v1/models.
const ModelMetadataSchema = z.object({
  source: z.enum(['openrouter', 'models.dev', 'catwalk']),
  // Path within the source catalog:
  //   openrouter:  "openai/gpt-4.1-nano"
  //   models.dev:  "anthropic.claude-3-5-haiku-20241022"
  //   catwalk:     "anthropic.claude-3-5-haiku-20241022"
  source_path: z.string().min(1),
});

export const ModelConfigSchema = z.object({
  selector: z.enum(['random', 'in_order', 'cost', 'latency', 'usage', 'performance']).optional(),
  priority: z.enum(['selector', 'api_match']).default('selector'),
  targets: z.array(ModelTargetSchema),
  additional_aliases: z.array(z.string()).optional(),
  use_image_fallthrough: z.boolean().default(false).optional(),
  type: z.enum(['chat', 'responses', 'embeddings', 'transcriptions', 'speech', 'image']).optional(),
  advanced: z.array(ModelBehaviorSchema).optional(),
  metadata: ModelMetadataSchema.optional(),
});

export type ModelBehavior = z.infer<typeof ModelBehaviorSchema>;
export type StripAdaptiveThinkingBehavior = z.infer<typeof StripAdaptiveThinkingBehaviorSchema>;
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

export const KeyConfigSchema = z.object({
  secret: z.string(),
  comment: z.string().optional(),
  quota: z.string().optional(), // References a quota definition name
});

const QuotaConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  provider: z.string(),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().min(1).default(30),
  options: z.record(z.any()).default({}),
});

export const McpServerConfigSchema = z.object({
  upstream_url: z.string().url(),
  enabled: z.boolean().default(true),
  headers: z.record(z.string()).optional(),
});

const CooldownPolicySchema = z.object({
  initialMinutes: z.number().min(1).default(2),
  maxMinutes: z.number().min(1).default(300),
});

const VisionFallthroughConfigSchema = z.object({
  descriptor_model: z.string().min(1),
  default_prompt: z.string().default(DEFAULT_VISION_DESCRIPTION_PROMPT),
});

const RawPlexusConfigSchema = z
  .object({
    providers: z.record(z.string(), ProviderConfigSchema),
    models: z.record(z.string(), ModelConfigSchema),
    keys: z.record(z.string(), KeyConfigSchema),
    failover: FailoverPolicySchema.optional(),
    cooldown: CooldownPolicySchema.optional(),
    vision_fallthrough: VisionFallthroughConfigSchema.optional(),
    performanceExplorationRate: z.number().min(0).max(1).default(0.05).optional(),
    latencyExplorationRate: z.number().min(0).max(1).default(0.05).optional(),
    mcp_servers: z.record(z.string(), McpServerConfigSchema).optional(),
    user_quotas: z.record(z.string(), QuotaDefinitionSchema).optional(),
  })
  .passthrough();

export type FailoverPolicy = z.infer<typeof FailoverPolicySchema>;
export type CooldownPolicy = z.infer<typeof CooldownPolicySchema>;
export type PlexusConfig = z.infer<typeof RawPlexusConfigSchema> & {
  failover: FailoverPolicy;
  cooldown?: CooldownPolicy;
  quotas: QuotaConfig[];
  mcpServers?: Record<string, McpServerConfig>;
};
export type DatabaseConfig = {
  connectionString: string;
};
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type ModelTarget = z.infer<typeof ModelTargetSchema>;
export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;
export type QuotaDefinition = z.infer<typeof QuotaDefinitionSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

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
    // NOTE: We do NOT infer 'ollama' from string URLs like 'http://localhost:11434/v1'
    // because those OpenAI-compatible endpoints should still use 'chat' type.
    // Native Ollama API must be explicitly configured via object: { ollama: 'http://...' }
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
    return Object.keys(urlMap).filter((key) => {
      const value = urlMap[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
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

function isOAuthProviderConfig(provider: {
  api_base_url: string | Record<string, string>;
}): boolean {
  if (typeof provider.api_base_url === 'string') {
    return provider.api_base_url.startsWith('oauth://');
  }
  return Object.values(provider.api_base_url).some((value) => value.startsWith('oauth://'));
}

// --- Loader ---

let currentConfig: PlexusConfig | null = null;

export function validateConfig(yamlContent: string): PlexusConfig {
  const parsed = yaml.parse(yamlContent);
  const { parsed: migrated } = migrateOAuthAccounts(parsed);
  const rawConfig = RawPlexusConfigSchema.parse(migrated);
  return hydrateConfig(rawConfig);
}

function hydrateConfig(config: z.infer<typeof RawPlexusConfigSchema>): PlexusConfig {
  return {
    ...config,
    failover: FailoverPolicySchema.parse(config.failover ?? {}),
    cooldown: CooldownPolicySchema.parse(config.cooldown ?? {}),
    quotas: buildProviderQuotaConfigs(config),
    mcpServers: config.mcp_servers,
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
    migratedProviders,
  };
}

function buildProviderQuotaConfigs(config: z.infer<typeof RawPlexusConfigSchema>): QuotaConfig[] {
  const quotas: QuotaConfig[] = [];
  const seenIds = new Set<string>();

  // First, process explicitly configured quota checkers
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
      throw new Error(
        `Duplicate quota checker id '${checkerId}' found in provider '${providerId}'`
      );
    }
    seenIds.add(checkerId);

    const checkerType = quotaChecker.type;

    const options: Record<string, unknown> = {
      ...(quotaChecker.options ?? {}),
    };

    // Inject the provider's API key for quota checkers that need it
    // Each quota checker implementation decides whether to use it or use its own option
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

  // Add implicit quota checkers for OAuth providers that don't have explicit quota checkers
  // These are automatically added based on the oauth_provider type
  const oauthQuotaCheckers: Record<string, { type: string; intervalMinutes: number }> = {
    'openai-codex': { type: 'openai-codex', intervalMinutes: 5 },
    'claude-code': { type: 'claude-code', intervalMinutes: 5 },
    'github-copilot': { type: 'copilot', intervalMinutes: 5 },
    'google-gemini-cli': { type: 'gemini-cli', intervalMinutes: 5 },
    'google-antigravity': { type: 'antigravity', intervalMinutes: 5 },
  };

  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.enabled === false) {
      continue;
    }

    // Skip if already has explicit quota checker
    if (providerConfig.quota_checker && providerConfig.quota_checker.enabled !== false) {
      continue;
    }

    // Check if this provider uses an OAuth provider that needs a quota checker
    const oauthProvider = providerConfig.oauth_provider;
    if (oauthProvider && oauthQuotaCheckers[oauthProvider]) {
      const quotaInfo = oauthQuotaCheckers[oauthProvider];
      const checkerId = `${providerId}-${oauthProvider}`;

      if (!seenIds.has(checkerId)) {
        seenIds.add(checkerId);

        const options: Record<string, unknown> = {};
        if (oauthProvider && options.oauthProvider === undefined) {
          options.oauthProvider = oauthProvider;
        }
        if (providerConfig.oauth_account && options.oauthAccountId === undefined) {
          options.oauthAccountId = providerConfig.oauth_account;
        }

        quotas.push({
          id: checkerId,
          provider: providerId,
          type: quotaInfo.type,
          enabled: true,
          intervalMinutes: quotaInfo.intervalMinutes,
          options,
        });

        logger.info(
          `Added implicit quota checker '${quotaInfo.type}' for provider '${providerId}'`
        );
      }
    }
  }

  return quotas;
}

export function getConfig(): PlexusConfig {
  // Try ConfigService first (database-backed config)
  try {
    const { ConfigService } = require('./services/config-service');
    const instance = ConfigService.getInstance();
    return instance.getConfig();
  } catch (e: any) {
    // Fall back for module-load, not-initialized, or test scenarios
    if (
      e instanceof Error &&
      e.message &&
      !e.message.includes('not loaded') &&
      !e.message.includes('not initialized') &&
      !e.message.includes('Cannot find module')
    ) {
      throw e;
    }
  }

  if (!currentConfig) {
    throw new Error('Configuration not loaded. Initialize ConfigService first.');
  }
  return currentConfig;
}

export function setConfigForTesting(config: PlexusConfig) {
  currentConfig = config;
  // Reset ConfigService so getConfig() falls through to currentConfig.
  // This prevents a stale or DB-loaded cache from shadowing the test config.
  try {
    const { ConfigService } = require('./services/config-service');
    ConfigService.resetInstance();
  } catch {
    // ConfigService may not be available in all test environments
  }
}

export function getDatabaseConfig(): DatabaseConfig | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }
  return { connectionString: databaseUrl };
}

// Valid quota checker types - single source of truth
export const VALID_QUOTA_CHECKER_TYPES = [
  'naga',
  'synthetic',
  'nanogpt',
  'zai',
  'moonshot',
  'minimax',
  'minimax-coding',
  'openrouter',
  'kilo',
  'openai-codex',
  'claude-code',
  'kimi-code',
  'copilot',
  'wisdomgate',
  'apertis',
  'apertis-coding-plan',
  'poe',
  'gemini-cli',
  'antigravity',
] as const;

export type QuotaCheckerType = (typeof VALID_QUOTA_CHECKER_TYPES)[number];
