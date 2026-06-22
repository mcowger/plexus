import { pgTable, serial, text, bigint, jsonb } from 'drizzle-orm/pg-core';

export const piAiCustomModels = pgTable('pi_ai_custom_models', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(), // the pi_ai_model_id referenced by provider-models
  definition: jsonb('definition').notNull(), // { inherits?, api?, contextWindow?, maxTokens?, reasoning?, thinkingLevelMap?, input?, cost?, compat? }
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
