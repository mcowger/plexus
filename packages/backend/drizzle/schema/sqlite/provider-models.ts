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
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    providerModelUnique: unique('uq_provider_models').on(table.providerId, table.modelName),
  })
);
