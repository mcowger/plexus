import { pgTable, serial, text, boolean, bigint, jsonb } from 'drizzle-orm/pg-core';

export const mcpServers = pgTable('mcp_servers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  upstreamUrl: text('upstream_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  headers: jsonb('headers'), // Record<string, string>
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
