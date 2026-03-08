import { sqliteTable, integer, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const providerRateLimits = sqliteTable(
  'provider_rate_limits',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    currentBudget: integer('current_budget').notNull(),
    lastRefillAt: integer('last_refill_at').notNull(),
    queueDepth: integer('queue_depth').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.model] }),
    lastRefillIdx: index('idx_rate_limits_last_refill').on(table.lastRefillAt),
  })
);
