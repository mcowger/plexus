import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';

export const responses = sqliteTable('responses', {
  id: text('id').primaryKey(),                    // resp_xxx format
  object: text('object').notNull(),               // Always 'response'
  createdAt: integer('created_at').notNull(),     // Unix timestamp
  completedAt: integer('completed_at'),           // Unix timestamp when completed
  status: text('status').notNull(),               // 'completed', 'failed', 'in_progress', etc.
  model: text('model').notNull(),
  outputItems: text('output_items').notNull(),    // JSON array of output items
  instructions: text('instructions'),
  temperature: real('temperature'),
  topP: real('top_p'),
  maxOutputTokens: integer('max_output_tokens'),
  topLogprobs: integer('top_logprobs'),
  parallelToolCalls: integer('parallel_tool_calls'),  // Boolean as integer
  toolChoice: text('tool_choice'),                    // JSON string
  tools: text('tools'),                               // JSON array
  textConfig: text('text_config'),                    // JSON object
  reasoningConfig: text('reasoning_config'),          // JSON object
  usageInputTokens: integer('usage_input_tokens'),
  usageOutputTokens: integer('usage_output_tokens'),
  usageReasoningTokens: integer('usage_reasoning_tokens'),
  usageCachedTokens: integer('usage_cached_tokens'),
  usageTotalTokens: integer('usage_total_tokens'),
  previousResponseId: text('previous_response_id'),
  conversationId: text('conversation_id'),
  store: integer('store').notNull().default(1),      // Boolean as integer
  background: integer('background').notNull().default(0),
  truncation: text('truncation'),
  incompleteDetails: text('incomplete_details'),      // JSON object
  error: text('error'),                               // JSON object
  safetyIdentifier: text('safety_identifier'),
  serviceTier: text('service_tier'),
  promptCacheKey: text('prompt_cache_key'),
  promptCacheRetention: text('prompt_cache_retention'),
  metadata: text('metadata'),                         // JSON object
  
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

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),                    // conv_xxx format
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  items: text('items').notNull(),                 // JSON array of all conversation items
  metadata: text('metadata'),                     // JSON object
  
  // Plexus-specific
  plexusAccountId: text('plexus_account_id'),
}, (table) => ({
  updatedIdx: index('idx_conversations_updated').on(table.updatedAt),
}));

export const responseItems = sqliteTable('response_items', {
  id: text('id').primaryKey(),                    // msg_xxx, fc_xxx, reason_xxx, etc.
  responseId: text('response_id').notNull(),
  itemIndex: integer('item_index').notNull(),
  itemType: text('item_type').notNull(),          // 'message', 'function_call', 'reasoning', etc.
  itemData: text('item_data').notNull(),          // JSON object
}, (table) => ({
  responseIdx: index('idx_response_items_response').on(table.responseId, table.itemIndex),
  typeIdx: index('idx_response_items_type').on(table.itemType),
}));
