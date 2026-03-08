import { pgTable, text, bigint, primaryKey, index } from 'drizzle-orm/pg-core';

export const providerRateLimits = pgTable(
  'provider_rate_limits',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    currentBudget: bigint('current_budget', { mode: 'number' }).notNull(),
    lastRefillAt: bigint('last_refill_at', { mode: 'number' }).notNull(),
    queueDepth: bigint('queue_depth', { mode: 'number' }).notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.model] }),
    lastRefillIdx: index('idx_rate_limits_last_refill').on(table.lastRefillAt),
  })
);
