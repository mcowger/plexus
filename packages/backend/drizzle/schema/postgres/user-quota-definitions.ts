import { pgTable, serial, text, integer, bigint, pgEnum, boolean, real } from 'drizzle-orm/pg-core';

export const quotaTypeEnum = pgEnum('quota_type', ['rolling', 'daily', 'weekly', 'monthly']);
export const limitTypeEnum = pgEnum('limit_type', ['requests', 'tokens', 'cost']);

export const userQuotaDefinitions = pgTable('user_quota_definitions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  quotaType: quotaTypeEnum('quota_type').notNull(),
  limitType: limitTypeEnum('limit_type').notNull(),
  limitValue: integer('limit_value').notNull(),
  duration: text('duration'),
  allowedModels: text('allowed_models'),
  allowedProviders: text('allowed_providers'),
  excludedModels: text('excluded_models'),
  excludedProviders: text('excluded_providers'),
  shared: boolean('shared').notNull().default(false),
  warnAt: real('warn_at'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
