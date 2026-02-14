import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const configSnapshots = sqliteTable('config_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  config: text('config', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  nameIdx: index('idx_config_name').on(table.name),
  createdAtIdx: index('idx_config_created_at').on(table.createdAt),
}));
