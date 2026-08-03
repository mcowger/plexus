import { pgTable, serial, text, bigint, index } from 'drizzle-orm/pg-core';

export const mcpOauthClients = pgTable('mcp_oauth_clients', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientName: text('client_name'),
  redirectUris: text('redirect_uris').notNull(), // JSON string for SQLite parity/encryption compatibility
  grantTypes: text('grant_types'), // JSON: string[]
  responseTypes: text('response_types'), // JSON: string[]
  scope: text('scope'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const mcpOauthAuthorizationCodes = pgTable(
  'mcp_oauth_authorization_codes',
  {
    id: serial('id').primaryKey(),
    codeHash: text('code_hash').notNull().unique(),
    code: text('code').notNull(),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    resource: text('resource').notNull(),
    scope: text('scope'),
    keyName: text('key_name').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    consumedAt: bigint('consumed_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    clientIdIdx: index('idx_mcp_oauth_authorization_codes_client_id').on(table.clientId),
    expiresAtIdx: index('idx_mcp_oauth_authorization_codes_expires_at').on(table.expiresAt),
  })
);

export const mcpOauthTokens = pgTable(
  'mcp_oauth_tokens',
  {
    id: serial('id').primaryKey(),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    accessToken: text('access_token').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    refreshToken: text('refresh_token').notNull(),
    clientId: text('client_id').notNull(),
    keyName: text('key_name').notNull(),
    apiKeySecretHash: text('api_key_secret_hash'),
    resource: text('resource').notNull(),
    scope: text('scope'),
    accessTokenExpiresAt: bigint('access_token_expires_at', { mode: 'number' }).notNull(),
    refreshTokenExpiresAt: bigint('refresh_token_expires_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    clientIdIdx: index('idx_mcp_oauth_tokens_client_id').on(table.clientId),
    keyNameIdx: index('idx_mcp_oauth_tokens_key_name').on(table.keyName),
    accessTokenExpiresAtIdx: index('idx_mcp_oauth_tokens_access_token_expires_at').on(
      table.accessTokenExpiresAt
    ),
  })
);
