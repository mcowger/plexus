import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { mcpServers } from './mcp-servers';

export const mcpUpstreamOauthClients = sqliteTable('mcp_upstream_oauth_clients', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  clientId: text('client_id').notNull(),
  clientSecret: text('client_secret'),
  revision: text('revision').notNull(),
});

export const mcpUpstreamOauthGrants = sqliteTable('mcp_upstream_oauth_grants', {
  serverId: integer('server_id')
    .primaryKey()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  revision: text('revision').notNull(),
  version: text('version').notNull(),
  payload: text('payload').notNull(),
});
