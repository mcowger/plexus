import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { modelAliases } from './model-aliases';

export const aliasMetadataOverrides = sqliteTable(
  'alias_metadata_overrides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    aliasId: integer('alias_id')
      .notNull()
      .references(() => modelAliases.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    contextLength: integer('context_length'),
    pricingPrompt: text('pricing_prompt'),
    pricingCompletion: text('pricing_completion'),
    pricingInputCacheRead: text('pricing_input_cache_read'),
    pricingInputCacheWrite: text('pricing_input_cache_write'),
    architectureInputModalities: text('architecture_input_modalities'), // JSON: string[]
    architectureOutputModalities: text('architecture_output_modalities'), // JSON: string[]
    architectureTokenizer: text('architecture_tokenizer'),
    supportedParameters: text('supported_parameters'), // JSON: string[]
    topProviderContextLength: integer('top_provider_context_length'),
    topProviderMaxCompletionTokens: integer('top_provider_max_completion_tokens'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    aliasUnique: unique('uq_alias_metadata_overrides').on(table.aliasId),
  })
);
