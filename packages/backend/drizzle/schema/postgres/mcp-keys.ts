import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { mcpServers } from './mcp-servers';

export const mcpKeys = pgTable('mcp_keys', {
  id: serial('id').primaryKey(),
  mcpServerId: integer('mcp_server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  cooldownUntil: timestamp('cooldown_until'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});
