import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const mcpServers = sqliteTable('mcp_servers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  upstreamUrl: text('upstream_url').notNull(),
  enabled: integer('enabled').notNull().default(1),
  headers: text('headers'), // JSON: Record<string, string>
  mode: text('mode').notNull().default('remote_http'),
  launcher: text('launcher'),
  packageName: text('package_name'),
  args: text('args'), // JSON: string[]
  port: integer('port'),
  path: text('path'),
  startupTimeoutMs: integer('startup_timeout_ms'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
