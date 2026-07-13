import { pgTable, serial, text, bigint, boolean, jsonb } from 'drizzle-orm/pg-core';

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
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
  allowRawPassthrough: boolean('allow_raw_passthrough').notNull().default(false),
  allowedIps: text('allowed_ips'),
  beta: boolean('beta').notNull().default(false),
  generation: jsonb('generation'), // { reasoning?, maxTokens?, verbosity?, serviceTier? }
  expiresAt: bigint('expires_at', { mode: 'number' }),
  disabledAt: bigint('disabled_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
