import { pgTable, serial, text, boolean, bigint, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const selectorStrategyEnum = pgEnum('selector_strategy', [
  'random',
  'in_order',
  'cost',
  'latency',
  'usage',
  'performance',
]);

export const aliasPriorityEnum = pgEnum('alias_priority', ['selector', 'api_match']);

export const metadataSourceEnum = pgEnum('metadata_source', [
  'openrouter',
  'models.dev',
  'catwalk',
  'custom',
]);

export const modelAliases = pgTable('model_aliases', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  selector: selectorStrategyEnum('selector'),
  priority: aliasPriorityEnum('priority').notNull().default('selector'),
  modelType: text('model_type'), // reuse model_type values but as text to avoid enum conflict
  additionalAliases: jsonb('additional_aliases'), // string[]
  advanced: jsonb('advanced'), // behavior objects array
  metadataSource: metadataSourceEnum('metadata_source'),
  metadataSourcePath: text('metadata_source_path'),
  useImageFallthrough: boolean('use_image_fallthrough').notNull().default(false),
  // Model architecture override for inference energy calculation
  modelArchitecture: jsonb('model_architecture'), // override for total_params, active_params, layers, heads, kv_lora_rank, qk_rope_head_dim, context_length, dtype
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
