import { pgTable, serial, text, bigint } from 'drizzle-orm/pg-core';

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  secret: text('secret').notNull().unique(),
  secretHash: text('secret_hash').unique(),
  comment: text('comment'),
  quotaName: text('quota_name'),
  allowedModels: text('allowed_models'),
  allowedProviders: text('allowed_providers'),
  excludedModels: text('excluded_models'),
  excludedProviders: text('excluded_providers'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
