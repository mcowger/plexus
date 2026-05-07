import { pgTable, serial, text, real, integer, bigint, boolean, index } from 'drizzle-orm/pg-core';

export const meterSnapshots = pgTable(
  'meter_snapshots',
  {
    id: serial('id').primaryKey(),
    checkerId: text('checker_id').notNull(),
    checkerType: text('checker_type').notNull(),
    provider: text('provider').notNull(),
    meterKey: text('meter_key').notNull(),
    kind: text('kind').notNull(), // 'balance' | 'allowance'
    unit: text('unit').notNull(),
    label: text('label').notNull(),
    group: text('group'),
    scope: text('scope'),
    limit: real('limit'),
    used: real('used'),
    remaining: real('remaining'),
    utilizationState: text('utilization_state').notNull(), // 'reported' | 'unknown' | 'not_applicable'
    utilizationPercent: real('utilization_percent'),
    status: text('status').notNull(),
    periodValue: integer('period_value'),
    periodUnit: text('period_unit'),
    periodCycle: text('period_cycle'),
    resetsAt: bigint('resets_at', { mode: 'number' }),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
    checkedAt: bigint('checked_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    checkerMeterCheckedIdx: index('idx_meter_checker_meter_checked').on(
      table.checkerId,
      table.meterKey,
      table.checkedAt
    ),
    providerCheckedIdx: index('idx_meter_provider_checked').on(table.provider, table.checkedAt),
    checkedAtIdx: index('idx_meter_checked_at').on(table.checkedAt),
  })
);
