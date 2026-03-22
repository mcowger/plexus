import { pgTable, serial, text, boolean, bigint } from 'drizzle-orm/pg-core';

export const mcpServers = pgTable('mcp_servers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  upstreamUrl: text('upstream_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  headers: text('headers'), // JSON or encrypted string — text for encryption compatibility
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
