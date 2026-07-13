import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  secret: text('secret').notNull().unique(),
  secretHash: text('secret_hash').unique(),
  comment: text('comment'),
  quotaName: text('quota_name'), // deprecated: read-fallback only, superseded by quotaNames
  quotaNames: text('quota_names'),
  allowedModels: text('allowed_models'),
  allowedProviders: text('allowed_providers'),
  excludedModels: text('excluded_models'),
  excludedProviders: text('excluded_providers'),
  allowRawPassthrough: integer('allow_raw_passthrough', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowedIps: text('allowed_ips'),
  beta: integer('beta', { mode: 'boolean' }).notNull().default(false),
  generation: text('generation'), // JSON: { reasoning?, maxTokens?, verbosity?, serviceTier? }
  expiresAt: integer('expires_at'),
  disabledAt: integer('disabled_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
