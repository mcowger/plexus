import type { ProviderConfig } from '../src/config';
import { closeDatabase, initializeDatabase } from '../src/db/client';
import { ConfigRepository } from '../src/db/config-repository';
import { runMigrations } from '../src/db/migrate';

export const oauthProvider = (account?: string): ProviderConfig =>
  ({
    api_base_url: 'oauth://',
    api_key: 'oauth',
    oauth_provider: 'meta',
    ...(account ? { oauth_account: account } : {}),
    disable_cooldown: false,
    stall_cooldown: false,
    allow_100_percent_utilization: false,
    estimateTokens: false,
    useClaudeMasking: false,
  }) as ProviderConfig;

export const creds = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 2000000000 };
export const rotated = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresAt: 2100000000,
};

export async function resetOAuthDatabase(): Promise<ConfigRepository> {
  await closeDatabase();
  process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
  initializeDatabase(process.env.DATABASE_URL);
  await runMigrations();
  const repo = new ConfigRepository();
  await repo.clearAllData();
  return repo;
}
