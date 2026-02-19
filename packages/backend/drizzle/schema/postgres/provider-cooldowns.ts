import { pgTable, text, bigint, primaryKey, index } from 'drizzle-orm/pg-core';

export const providerCooldowns = pgTable('provider_cooldowns', {
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  expiry: bigint('expiry', { mode: 'number' }).notNull(),
  consecutiveFailures: bigint('consecutive_failures', { mode: 'number' }).notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.model] }),
  expiryIdx: index('idx_cooldowns_expiry').on(table.expiry),
}));