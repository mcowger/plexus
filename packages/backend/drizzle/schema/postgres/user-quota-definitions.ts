import { pgTable, serial, text, integer, bigint, pgEnum } from 'drizzle-orm/pg-core';

export const quotaTypeEnum = pgEnum('quota_type', ['rolling', 'daily', 'weekly']);
export const limitTypeEnum = pgEnum('limit_type', ['requests', 'tokens']);

export const userQuotaDefinitions = pgTable('user_quota_definitions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  quotaType: quotaTypeEnum('quota_type').notNull(),
  limitType: limitTypeEnum('limit_type').notNull(),
  limitValue: integer('limit_value').notNull(),
  duration: text('duration'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
