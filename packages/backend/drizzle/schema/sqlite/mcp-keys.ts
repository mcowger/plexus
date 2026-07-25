import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mcpServers } from './mcp-servers';

export const mcpKeys = sqliteTable('mcp_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mcpServerId: integer('mcp_server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
