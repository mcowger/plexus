import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const modelAliases = sqliteTable('model_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  selector: text('selector'), // 'random' | 'in_order' | 'cost' | 'latency' | 'usage' | 'performance'
  priority: text('priority').notNull().default('selector'), // 'selector' | 'api_match'
  modelType: text('model_type'), // 'chat' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'responses'
  additionalAliases: text('additional_aliases'), // JSON: string[]
  advanced: text('advanced'), // JSON: behavior objects array
  metadataSource: text('metadata_source'), // 'openrouter' | 'models.dev' | 'catwalk'
  metadataSourcePath: text('metadata_source_path'),
  useImageFallthrough: integer('use_image_fallthrough').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
