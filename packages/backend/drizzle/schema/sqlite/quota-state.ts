import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const quotaState = sqliteTable('quota_state', {
  keyName: text('key_name').primaryKey(),
  quotaName: text('quota_name').notNull(),
  limitType: text('limit_type').notNull(),
  currentUsage: real('current_usage').notNull().default(0),
  lastUpdated: integer('last_updated', { mode: 'timestamp_ms' }).notNull(),
  windowStart: integer('window_start', { mode: 'timestamp_ms' }),
});
