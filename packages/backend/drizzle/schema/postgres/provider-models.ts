import { pgTable, serial, text, integer, jsonb, unique, pgEnum } from 'drizzle-orm/pg-core';
import { providers } from './providers';

export const modelTypeEnum = pgEnum('model_type', [
  'chat',
  'embeddings',
  'transcriptions',
  'speech',
  'image',
  'responses',
]);

export const providerModels = pgTable(
  'provider_models',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    pricingConfig: jsonb('pricing_config'),
    modelType: modelTypeEnum('model_type'),
    accessVia: jsonb('access_via'), // string[]
    extraBody: jsonb('extra_body'), // Record<string, any>
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    providerModelUnique: unique('uq_provider_models').on(table.providerId, table.modelName),
  })
);
