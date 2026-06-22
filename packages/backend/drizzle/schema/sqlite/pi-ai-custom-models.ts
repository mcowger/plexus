import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const piAiCustomModels = sqliteTable('pi_ai_custom_models', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(), // the pi_ai_model_id referenced by provider-models
  definition: text('definition').notNull(), // JSON: { inherits?, api?, contextWindow?, maxTokens?, reasoning?, thinkingLevelMap?, input?, cost?, compat? }
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
