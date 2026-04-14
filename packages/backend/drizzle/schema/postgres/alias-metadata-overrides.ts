import { pgTable, serial, text, integer, bigint, jsonb, unique } from 'drizzle-orm/pg-core';
import { modelAliases } from './model-aliases';

export const aliasMetadataOverrides = pgTable(
  'alias_metadata_overrides',
  {
    id: serial('id').primaryKey(),
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
    architectureInputModalities: jsonb('architecture_input_modalities'), // string[]
    architectureOutputModalities: jsonb('architecture_output_modalities'), // string[]
    architectureTokenizer: text('architecture_tokenizer'),
    supportedParameters: jsonb('supported_parameters'), // string[]
    topProviderContextLength: integer('top_provider_context_length'),
    topProviderMaxCompletionTokens: integer('top_provider_max_completion_tokens'),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    aliasUnique: unique('uq_alias_metadata_overrides').on(table.aliasId),
  })
);
