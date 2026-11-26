import { integer, pgTable, text } from 'drizzle-orm/pg-core';

import { mcpServers } from './mcp-servers';

export const mcpUpstreamOauthClients = pgTable('mcp_upstream_oauth_clients', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  clientId: text('client_id').notNull(),
  clientSecret: text('client_secret'),
  revision: text('revision').notNull(),
});

export const mcpUpstreamOauthGrants = pgTable('mcp_upstream_oauth_grants', {
  serverId: integer('server_id')
    .primaryKey()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  revision: text('revision').notNull(),
  version: text('version').notNull(),
  payload: text('payload').notNull(),
});
