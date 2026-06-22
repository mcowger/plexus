import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const piAiCustomProviders = sqliteTable('pi_ai_custom_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(), // the pi_ai_provider id referenced by providers
  definition: text('definition').notNull(), // JSON: { api, display_name?, compat? }
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
