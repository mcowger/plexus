import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import { oauthCredentials } from './oauth-credentials';

export const providers = sqliteTable(
  'providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name'),
    apiBaseUrl: text('api_base_url'), // JSON: string URL or {"chat":"...","messages":"..."}
    apiKey: text('api_key'),
    oauthProviderType: text('oauth_provider_type'), // 'anthropic' | 'openai-codex' | 'github-copilot' | 'google-gemini-cli' | 'google-antigravity'
    oauthCredentialId: integer('oauth_credential_id').references(() => oauthCredentials.id, {
      onDelete: 'set null',
    }),
    enabled: integer('enabled').notNull().default(1),
    disableCooldown: integer('disable_cooldown').notNull().default(0),
    disableQuotaCheck: integer('disable_quota_check').notNull().default(0),
    discount: real('discount'),
    estimateTokens: integer('estimate_tokens').notNull().default(0),
    useClaudeMasking: integer('use_claude_masking').notNull().default(0),
    headers: text('headers'), // JSON: Record<string, string>
    extraBody: text('extra_body'), // JSON: Record<string, any>
    quotaCheckerType: text('quota_checker_type'),
    quotaCheckerId: text('quota_checker_id'),
    quotaCheckerEnabled: integer('quota_checker_enabled').notNull().default(1),
    quotaCheckerInterval: integer('quota_checker_interval').notNull().default(30),
    quotaCheckerOptions: text('quota_checker_options'), // JSON
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    slugIdx: index('idx_providers_slug').on(table.slug),
  })
);
