import { pgTable, text, bigint, integer, real, index } from 'drizzle-orm/pg-core';

export const responses = pgTable('responses', {
  id: text('id').primaryKey(),                    // resp_xxx format
  object: text('object').notNull(),               // Always 'response'
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
  status: text('status').notNull(),
  model: text('model').notNull(),
  outputItems: text('output_items').notNull(),    // JSON array of output items
  instructions: text('instructions'),
  temperature: real('temperature'),
  topP: real('top_p'),
  maxOutputTokens: integer('max_output_tokens'),
  topLogprobs: integer('top_logprobs'),
  parallelToolCalls: integer('parallel_tool_calls'),
  toolChoice: text('tool_choice'),
  tools: text('tools'),
  textConfig: text('text_config'),
  reasoningConfig: text('reasoning_config'),
  usageInputTokens: integer('usage_input_tokens'),
  usageOutputTokens: integer('usage_output_tokens'),
  usageReasoningTokens: integer('usage_reasoning_tokens'),
  usageCachedTokens: integer('usage_cached_tokens'),
  usageTotalTokens: integer('usage_total_tokens'),
  previousResponseId: text('previous_response_id'),
  conversationId: text('conversation_id'),
  store: integer('store').notNull().default(1),
  background: integer('background').notNull().default(0),
  truncation: text('truncation'),
  incompleteDetails: text('incomplete_details'),
  error: text('error'),
  safetyIdentifier: text('safety_identifier'),
  serviceTier: text('service_tier'),
  promptCacheKey: text('prompt_cache_key'),
  promptCacheRetention: text('prompt_cache_retention'),
  metadata: text('metadata'),
  
  // Plexus-specific fields
  plexusProvider: text('plexus_provider'),
  plexusTargetModel: text('plexus_target_model'),
  plexusApiType: text('plexus_api_type'),
  plexusCanonicalModel: text('plexus_canonical_model'),
}, (table) => ({
  conversationIdx: index('idx_responses_conversation').on(table.conversationId),
  createdAtIdx: index('idx_responses_created_at').on(table.createdAt),
  statusIdx: index('idx_responses_status').on(table.status),
  previousIdx: index('idx_responses_previous').on(table.previousResponseId),
}));

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  items: text('items').notNull(),
  metadata: text('metadata'),
  plexusAccountId: text('plexus_account_id'),
}, (table) => ({
  updatedIdx: index('idx_conversations_updated').on(table.updatedAt),
}));

export const responseItems = pgTable('response_items', {
  id: text('id').primaryKey(),
  responseId: text('response_id').notNull(),
  itemIndex: integer('item_index').notNull(),
  itemType: text('item_type').notNull(),
  itemData: text('item_data').notNull(),
}, (table) => ({
  responseIdx: index('idx_response_items_response').on(table.responseId, table.itemIndex),
  typeIdx: index('idx_response_items_type').on(table.itemType),
}));
