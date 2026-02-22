import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';

export const quotaSnapshots = sqliteTable(
  'quota_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    checkerId: text('checker_id').notNull(),
    groupId: text('group_id'),
    windowType: text('window_type').notNull(),
    description: text('description'),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull(),
    limit: real('limit'),
    used: real('used'),
    remaining: real('remaining'),
    utilizationPercent: real('utilization_percent'),
    unit: text('unit'),
    resetsAt: integer('resets_at', { mode: 'timestamp_ms' }),
    status: text('status'),
    success: integer('success', { mode: 'boolean' }).notNull().default(true),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    providerCheckedIdx: index('idx_quota_provider_checked').on(table.provider, table.checkedAt),
    checkerWindowIdx: index('idx_quota_checker_window').on(
      table.checkerId,
      table.windowType,
      table.checkedAt
    ),
    groupWindowIdx: index('idx_quota_group_window').on(
      table.groupId,
      table.windowType,
      table.checkedAt
    ),
    checkedAtIdx: index('idx_quota_checked_at').on(table.checkedAt),
  })
);
