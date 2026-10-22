import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const providerCooldowns = sqliteTable(
  'provider_cooldowns',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    expiry: integer('expiry').notNull(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    lastError: text('last_error'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.model] }),
    expiryIdx: index('idx_cooldowns_expiry').on(table.expiry),
  })
);
