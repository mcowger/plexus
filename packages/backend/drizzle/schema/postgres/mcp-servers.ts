import { pgTable, serial, text, boolean, bigint, integer } from 'drizzle-orm/pg-core';

export const mcpServers = pgTable('mcp_servers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  upstreamUrl: text('upstream_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  headers: text('headers'), // JSON or encrypted string — text for encryption compatibility
  mode: text('mode').notNull().default('remote_http'),
  launcher: text('launcher'),
  packageName: text('package_name'),
  args: text('args'), // JSON or encrypted string — text for encryption compatibility
  env: text('env'), // JSON or encrypted string — text for encryption compatibility
  port: bigint('port', { mode: 'number' }),
  path: text('path'),
  startupTimeoutMs: bigint('startup_timeout_ms', { mode: 'number' }),
  rateLimitCooldownMs: integer('rate_limit_cooldown_ms').notNull().default(60000),
  quotaCooldownMs: integer('quota_cooldown_ms').notNull().default(86400000),
  authScheme: text('auth_scheme'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
