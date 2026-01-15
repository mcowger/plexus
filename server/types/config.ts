import { z } from "zod";

// Server configuration schema
export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// Admin configuration (Phase 8)
export const AdminConfigSchema = z.object({
  apiKey: z.string().min(1),
  rateLimit: z.object({
    windowMs: z.number().default(60000),
    maxRequests: z.number().default(100),
  }).default({}),
});

export type AdminConfig = z.infer<typeof AdminConfigSchema>;

// Events configuration (Phase 8)
export const EventsConfigSchema = z.object({
  heartbeatIntervalMs: z.number().min(5000).max(50000).default(30000),
  maxClients: z.number().default(10),
});

export type EventsConfig = z.infer<typeof EventsConfigSchema>;

// Logging configuration schema (Phase 7)
export const LoggingConfigSchema = z.object({
  level: z.enum(["silly", "debug", "info", "warn", "error"]),
  
  // Usage logging settings
  usage: z.object({
    enabled: z.boolean().default(true),
    storagePath: z.string().default("./data/logs/usage"),
    retentionDays: z.number().default(30),
  }).optional().default({
    enabled: true,
    storagePath: "./data/logs/usage",
    retentionDays: 30,
  }),
  
  // Debug mode settings
  debug: z.object({
    enabled: z.boolean().default(false),
    captureRequests: z.boolean().default(true),
    captureResponses: z.boolean().default(true),
    storagePath: z.string().default("./data/logs/debug"),
    retentionDays: z.number().default(7),
    streamTimeoutSeconds: z.number().default(300), // 5 minutes default timeout for streams
  }).optional().default({
    enabled: false,
    captureRequests: true,
    captureResponses: true,
    storagePath: "./data/logs/debug",
    retentionDays: 7,
    streamTimeoutSeconds: 300,
  }),
  
  // Error logging
  errors: z.object({
    storagePath: z.string().default("./data/logs/errors"),
    retentionDays: z.number().default(90),
  }).optional().default({
    storagePath: "./data/logs/errors",
    retentionDays: 90,
  }),
});

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

// Provider authentication configuration
export const ProviderAuthSchema = z.object({
  type: z.enum(["bearer", "x-api-key"]),
  apiKey: z.string(),
});

export type ProviderAuth = z.infer<typeof ProviderAuthSchema>;

// Provider cooldown overrides schema (Phase 6)
export const ProviderCooldownSchema = z.object({
  rate_limit: z.number().optional(),
  auth_error: z.number().optional(),
  timeout: z.number().optional(),
  server_error: z.number().optional(),
  connection_error: z.number().optional(),
}).optional();

export type ProviderCooldown = z.infer<typeof ProviderCooldownSchema>;

// Provider configuration (Phase 2+)
export const ProviderConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  apiTypes: z.array(z.enum(["chat", "messages", "gemini"])),
  baseUrls: z.object({
    chat: z.string().optional(),
    messages: z.string().optional(),
    gemini: z.string().optional(),
  }),
  auth: ProviderAuthSchema,
  models: z.array(z.string()),
  customHeaders: z.record(z.string()).optional(),
  extraBody: z.record(z.unknown()).optional(),
  cooldown: ProviderCooldownSchema,
  discount: z.number().optional(), // Phase 7: Provider-level discount multiplier
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Model target schema (Phase 3)
export const ModelTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
  weight: z.number().positive().optional(),
});

export type ModelTarget = z.infer<typeof ModelTargetSchema>;

// Selector strategy schema (Phase 3)
export const SelectorStrategySchema = z.enum([
  "random",
  "in_order",
  "cost",
  "latency",
  "performance",
]);

export type SelectorStrategy = z.infer<typeof SelectorStrategySchema>;

// Model alias configuration (Phase 3)
export const ModelAliasConfigSchema = z.object({
  alias: z.string(),
  description: z.string().optional(),
  additionalAliases: z.array(z.string()).optional(),
  targets: z.array(ModelTargetSchema).min(1),
  selector: SelectorStrategySchema,
  apiMatch: z.boolean().optional(),
});

export type ModelAliasConfig = z.infer<typeof ModelAliasConfigSchema>;

// API Key configuration (Phase 2+)
export const ApiKeyConfigSchema = z.object({
  name: z.string(),
  secret: z.string(),
  enabled: z.boolean(),
});

export type ApiKeyConfig = z.infer<typeof ApiKeyConfigSchema>;

// Resilience configuration (Phase 6)
export const ResilienceConfigSchema = z.object({
  cooldown: z.object({
    defaults: z.object({
      rate_limit: z.number().default(60),
      auth_error: z.number().default(3600),
      timeout: z.number().default(30),
      server_error: z.number().default(120),
      connection_error: z.number().default(60),
    }).default({
      rate_limit: 60,
      auth_error: 3600,
      timeout: 30,
      server_error: 120,
      connection_error: 60,
    }),
    maxDuration: z.number().default(3600),
    minDuration: z.number().default(5),
    storagePath: z.string().default("./data/cooldowns.json"),
  }).default({
    defaults: {
      rate_limit: 60,
      auth_error: 3600,
      timeout: 30,
      server_error: 120,
      connection_error: 60,
    },
    maxDuration: 3600,
    minDuration: 5,
    storagePath: "./data/cooldowns.json",
  }),
  health: z.object({
    degradedThreshold: z.number().default(0.5),
    unhealthyThreshold: z.number().default(0.9),
  }).default({
    degradedThreshold: 0.5,
    unhealthyThreshold: 0.9,
  }),
}).optional().default({
  cooldown: {
    defaults: {
      rate_limit: 60,
      auth_error: 3600,
      timeout: 30,
      server_error: 120,
      connection_error: 60,
    },
    maxDuration: 3600,
    minDuration: 5,
    storagePath: "./data/cooldowns.json",
  },
  health: {
    degradedThreshold: 0.5,
    unhealthyThreshold: 0.9,
  },
});

export type ResilienceConfig = z.infer<typeof ResilienceConfigSchema>;

// Pricing configuration (Phase 7)
export const SimplePricingSchema = z.object({
  inputPer1M: z.number(),
  outputPer1M: z.number(),
  cachedPer1M: z.number().optional(),
  reasoningPer1M: z.number().optional(),
});

export const TieredPricingSchema = z.object({
  maxInputTokens: z.number(),
  inputPer1M: z.number(),
  outputPer1M: z.number(),
  cachedPer1M: z.number().optional(),
});

export const PricingConfigSchema = z.object({
  models: z.record(SimplePricingSchema),
  tiered: z.record(z.array(TieredPricingSchema)).optional(),
  openrouter: z.object({
    enabled: z.boolean().default(false),
    cacheRefreshMinutes: z.number().default(60),
  }).optional(),
  discounts: z.record(z.number()).optional(),
}).optional();

export type PricingConfigType = z.infer<typeof PricingConfigSchema>;

// Main Plexus configuration schema
export const PlexusConfigSchema = z.object({
  server: ServerConfigSchema,
  admin: AdminConfigSchema.optional(), // Phase 8
  events: EventsConfigSchema.optional(), // Phase 8
  logging: LoggingConfigSchema,
  providers: z.array(ProviderConfigSchema),
  models: z.array(ModelAliasConfigSchema).optional().default([]),
  apiKeys: z.array(ApiKeyConfigSchema),
  resilience: ResilienceConfigSchema,
  pricing: PricingConfigSchema, // Phase 7
});

export type PlexusConfig = z.infer<typeof PlexusConfigSchema>;
