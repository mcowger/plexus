import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { providers } from './providers';

export const providerModels = sqliteTable(
  'provider_models',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: integer('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    pricingConfig: text('pricing_config'), // JSON: pricing object
    modelType: text('model_type'), // 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses'
    accessVia: text('access_via'), // JSON: string[]
    extraBody: text('extra_body'), // JSON: Record<string, any>
    adapter: text('adapter'), // JSON: string[] — model-level adapter names
    maxConcurrency: integer('max_concurrency'), // Max concurrent requests for this model (NULL = no limit)
    piAiModelId: text('pi_ai_model_id'), // pi-ai model ID within the pi-ai provider (e.g. 'claude-opus-4-6')
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    providerModelUnique: unique('uq_provider_models').on(table.providerId, table.modelName),
  })
);
