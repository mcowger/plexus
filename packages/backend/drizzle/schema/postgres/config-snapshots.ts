import { pgTable, serial, text, bigint, index } from 'drizzle-orm/pg-core';

export const configSnapshots = pgTable('config_snapshots', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  config: text('config').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  nameIdx: index('idx_config_name').on(table.name),
  createdAtIdx: index('idx_config_created_at').on(table.createdAt),
}));
