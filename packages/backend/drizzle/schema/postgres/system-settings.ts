import { pgTable, text, bigint, jsonb } from 'drizzle-orm/pg-core';

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
