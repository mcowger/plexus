import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const userQuotaDefinitions = sqliteTable('user_quota_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  quotaType: text('quota_type').notNull(), // 'rolling' | 'daily' | 'weekly' | 'monthly'
  limitType: text('limit_type').notNull(), // 'requests' | 'tokens' | 'cost'
  limitValue: integer('limit_value').notNull(),
  duration: text('duration'), // e.g. "1h", required for rolling
  allowedModels: text('allowed_models'),
  allowedProviders: text('allowed_providers'),
  excludedModels: text('excluded_models'),
  excludedProviders: text('excluded_providers'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
  warnAt: real('warn_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
