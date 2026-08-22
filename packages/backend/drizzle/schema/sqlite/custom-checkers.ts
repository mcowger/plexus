import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const customCheckers = sqliteTable('custom_checkers', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  code: text('code').notNull(),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
