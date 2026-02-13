import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const providerPerformance = sqliteTable('provider_performance', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  canonicalModelName: text('canonical_model_name'),
  requestId: text('request_id'),
  timeToFirstTokenMs: real('time_to_first_token_ms'),
  totalTokens: integer('total_tokens'),
  durationMs: real('duration_ms'),
  tokensPerSec: real('tokens_per_sec'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  lookupIdx: index('idx_provider_performance_lookup')
    .on(table.provider, table.model, table.createdAt),
}));
