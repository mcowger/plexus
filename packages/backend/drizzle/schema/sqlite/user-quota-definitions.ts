import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const userQuotaDefinitions = sqliteTable('user_quota_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  quotaType: text('quota_type').notNull(), // 'rolling' | 'daily' | 'weekly'
  limitType: text('limit_type').notNull(), // 'requests' | 'tokens'
  limitValue: integer('limit_value').notNull(),
  duration: text('duration'), // e.g. "1h", required for rolling
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
