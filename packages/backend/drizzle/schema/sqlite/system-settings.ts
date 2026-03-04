import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value'), // JSON serialized value
  updatedAt: integer('updated_at').notNull(),
});
