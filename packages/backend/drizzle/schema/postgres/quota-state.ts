import { pgTable, text, real, bigint, primaryKey } from 'drizzle-orm/pg-core';

export const quotaState = pgTable(
  'quota_state',
  {
    keyName: text('key_name').notNull(),
    quotaName: text('quota_name').notNull(),
    limitType: text('limit_type').notNull(),
    currentUsage: real('current_usage').notNull().default(0),
    lastUpdated: bigint('last_updated', { mode: 'number' }).notNull(),
    windowStart: bigint('window_start', { mode: 'number' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.keyName, table.quotaName] }),
  })
);
