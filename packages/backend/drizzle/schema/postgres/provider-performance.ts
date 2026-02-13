import { pgTable, serial, text, real, bigint, integer, index } from 'drizzle-orm/pg-core';

export const providerPerformance = pgTable('provider_performance', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  canonicalModelName: text('canonical_model_name'),
  requestId: text('request_id'),
  timeToFirstTokenMs: real('time_to_first_token_ms'),
  totalTokens: integer('total_tokens'),
  durationMs: real('duration_ms'),
  tokensPerSec: real('tokens_per_sec'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  lookupIdx: index('idx_provider_performance_lookup')
    .on(table.provider, table.model, table.createdAt),
}));