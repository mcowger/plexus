import { sqliteTable, integer, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const providerCooldowns = sqliteTable('provider_cooldowns', {
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  expiry: integer('expiry').notNull(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.model] }),
  expiryIdx: index('idx_cooldowns_expiry').on(table.expiry),
}));
