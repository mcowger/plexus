import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const mcpOauthClients = sqliteTable('mcp_oauth_clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull().unique(),
  clientName: text('client_name'),
  redirectUris: text('redirect_uris').notNull(), // JSON: string[]
  grantTypes: text('grant_types'), // JSON: string[]
  responseTypes: text('response_types'), // JSON: string[]
  scope: text('scope'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const mcpOauthAuthorizationCodes = sqliteTable(
  'mcp_oauth_authorization_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    codeHash: text('code_hash').notNull().unique(),
    code: text('code').notNull(),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource').notNull(),
    scope: text('scope'),
    keyName: text('key_name').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    clientIdIdx: index('idx_mcp_oauth_authorization_codes_client_id').on(table.clientId),
    expiresAtIdx: index('idx_mcp_oauth_authorization_codes_expires_at').on(table.expiresAt),
  })
);

export const mcpOauthTokens = sqliteTable(
  'mcp_oauth_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    accessToken: text('access_token').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    refreshToken: text('refresh_token').notNull(),
    clientId: text('client_id').notNull(),
    keyName: text('key_name').notNull(),
    apiKeySecretHash: text('api_key_secret_hash'),
    resource: text('resource').notNull(),
    scope: text('scope'),
    accessTokenExpiresAt: integer('access_token_expires_at').notNull(),
    refreshTokenExpiresAt: integer('refresh_token_expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    clientIdIdx: index('idx_mcp_oauth_tokens_client_id').on(table.clientId),
    keyNameIdx: index('idx_mcp_oauth_tokens_key_name').on(table.keyName),
    accessTokenExpiresAtIdx: index('idx_mcp_oauth_tokens_access_token_expires_at').on(
      table.accessTokenExpiresAt
    ),
  })
);
