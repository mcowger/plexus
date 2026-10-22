import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const providerPerformance = sqliteTable(
  'provider_performance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    canonicalModelName: text('canonical_model_name'),
    requestId: text('request_id'),
    timeToFirstTokenMs: real('time_to_first_token_ms'),
    totalTokens: integer('total_tokens'),
    durationMs: real('duration_ms'),
    tokensPerSec: real('tokens_per_sec'),
    e2eTokensPerSec: real('e2e_tokens_per_sec'),
    failureCount: integer('failure_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    lookupIdx: index('idx_provider_performance_lookup').on(
      table.provider,
      table.model,
      table.createdAt
    ),
  })
);
