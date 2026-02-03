import { pgTable, serial, text, real, bigint, integer, index } from 'drizzle-orm/pg-core';

export const quotaSnapshots = pgTable('quota_snapshots', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  checkerId: text('checker_id').notNull(),
  groupId: text('group_id'),
  windowType: text('window_type').notNull(),
  description: text('description'),
  checkedAt: bigint('checked_at', { mode: 'number' }).notNull(),
  limit: real('limit'),
  used: real('used'),
  remaining: real('remaining'),
  utilizationPercent: real('utilization_percent'),
  unit: text('unit'),
  resetsAt: bigint('resets_at', { mode: 'number' }),
  status: text('status'),
  success: integer('success').notNull().default(1),
  errorMessage: text('error_message'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  providerCheckedIdx: index('idx_quota_provider_checked').on(table.provider, table.checkedAt),
  checkerWindowIdx: index('idx_quota_checker_window').on(table.checkerId, table.windowType, table.checkedAt),
  groupWindowIdx: index('idx_quota_group_window').on(table.groupId, table.windowType, table.checkedAt),
  checkedAtIdx: index('idx_quota_checked_at').on(table.checkedAt),
}));