import { pgTable, serial, text, real, integer, boolean, bigint, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';

export const oauthProviderTypeEnum = pgEnum('oauth_provider_type', [
  'anthropic',
  'openai-codex',
  'github-copilot',
  'google-gemini-cli',
  'google-antigravity',
]);

export const quotaCheckerTypeEnum = pgEnum('quota_checker_type', [
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
  'poe',
  'gemini-cli',
  'antigravity',
]);

export const providers = pgTable(
  'providers',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name'),
    apiBaseUrl: jsonb('api_base_url'), // String URL or {"chat":"...","messages":"..."}
    apiKey: text('api_key'),
    oauthProviderType: oauthProviderTypeEnum('oauth_provider_type'),
    oauthCredentialId: integer('oauth_credential_id'),
    enabled: boolean('enabled').notNull().default(true),
    disableCooldown: boolean('disable_cooldown').notNull().default(false),
    discount: real('discount'),
    estimateTokens: boolean('estimate_tokens').notNull().default(false),
    headers: jsonb('headers'), // Record<string, string>
    extraBody: jsonb('extra_body'), // Record<string, any>
    quotaCheckerType: quotaCheckerTypeEnum('quota_checker_type'),
    quotaCheckerId: text('quota_checker_id'),
    quotaCheckerEnabled: boolean('quota_checker_enabled').notNull().default(true),
    quotaCheckerInterval: integer('quota_checker_interval').notNull().default(30),
    quotaCheckerOptions: jsonb('quota_checker_options'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    slugIdx: index('idx_providers_slug').on(table.slug),
  })
);
