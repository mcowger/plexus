import { pgTable, serial, text, bigint, jsonb } from 'drizzle-orm/pg-core';

export const piAiCustomProviders = pgTable('pi_ai_custom_providers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(), // the pi_ai_provider id referenced by providers
  definition: jsonb('definition').notNull(), // { api, display_name?, compat? }
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
