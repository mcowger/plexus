import { pgTable, serial, text, bigint, unique } from 'drizzle-orm/pg-core';

export const oauthCredentials = pgTable(
  'oauth_credentials',
  {
    id: serial('id').primaryKey(),
    oauthProviderType: text('oauth_provider_type').notNull(), // any pi-ai OAuth provider id except 'radius' (see services/oauth/oauth-providers.ts)
    accountId: text('account_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(), // Epoch seconds
    createdAt: bigint('created_at', { mode: 'number' }).notNull(), // Epoch milliseconds
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(), // Epoch milliseconds
  },
  (table) => ({
    providerAccountUnique: unique('uq_oauth_credentials').on(
      table.oauthProviderType,
      table.accountId
    ),
  })
);
