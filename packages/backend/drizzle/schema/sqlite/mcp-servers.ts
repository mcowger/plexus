import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const mcpServers = sqliteTable('mcp_servers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  upstreamUrl: text('upstream_url').notNull(),
  enabled: integer('enabled').notNull().default(1),
  headers: text('headers'), // JSON: Record<string, string>
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
