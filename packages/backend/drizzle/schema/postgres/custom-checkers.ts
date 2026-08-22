import { pgTable, text, boolean, bigint } from 'drizzle-orm/pg-core';

export const customCheckers = pgTable('custom_checkers', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  code: text('code').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
