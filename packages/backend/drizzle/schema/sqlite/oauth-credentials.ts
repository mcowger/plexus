import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';

export const oauthCredentials = sqliteTable(
  'oauth_credentials',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    oauthProviderType: text('oauth_provider_type').notNull(), // any pi-ai OAuth provider id except 'radius' (see services/oauth/oauth-providers.ts)
    accountId: text('account_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: integer('expires_at').notNull(), // Epoch seconds
    createdAt: integer('created_at').notNull(), // Epoch milliseconds
    updatedAt: integer('updated_at').notNull(), // Epoch milliseconds
  },
  (table) => ({
    providerAccountUnique: unique('uq_oauth_credentials').on(
      table.oauthProviderType,
      table.accountId
    ),
  })
);
