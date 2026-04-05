import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOAuthProviderConfig(overrides: Record<string, unknown> = {}) {
  return {
    api_base_url: 'oauth://',
    api_key: 'oauth',
    oauth_provider: 'openai-codex' as const,
    oauth_account: 'test-account',
    enabled: true,
    disable_cooldown: false,
    estimateTokens: false,
    useClaudeMasking: false,
    ...overrides,
  };
}

function makeRegularProviderConfig(overrides: Record<string, unknown> = {}) {
  return {
    api_base_url: 'https://api.openai.com/v1',
    api_key: 'sk-test',
    enabled: true,
    disable_cooldown: false,
    estimateTokens: false,
    useClaudeMasking: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigRepository — disable_quota_check round-trip', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    // Each test gets a clean in-memory database with all migrations applied.
    // This mirrors the pattern in encrypt-migration.test.ts and avoids cross-file
    // contamination when another test file closes the database in its own setup.
    await closeDatabase();
    process.env.DATABASE_URL = 'sqlite://:memory:';
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    repo = new ConfigRepository();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('defaults to false when disable_quota_check is not provided', async () => {
    await repo.saveProvider('my-provider', makeOAuthProviderConfig() as any);
    const config = await repo.getProvider('my-provider');
    expect(config).not.toBeNull();
    expect(config!.disable_quota_check).toBe(false);
  });

  it('persists disable_quota_check: true and reads it back', async () => {
    await repo.saveProvider(
      'opted-out',
      makeOAuthProviderConfig({ disable_quota_check: true }) as any
    );
    const config = await repo.getProvider('opted-out');
    expect(config).not.toBeNull();
    expect(config!.disable_quota_check).toBe(true);
  });

  it('persists disable_quota_check: false explicitly and reads it back', async () => {
    await repo.saveProvider(
      'opted-in',
      makeOAuthProviderConfig({ disable_quota_check: false }) as any
    );
    const config = await repo.getProvider('opted-in');
    expect(config).not.toBeNull();
    expect(config!.disable_quota_check).toBe(false);
  });

  it('round-trips true → false when provider is updated', async () => {
    await repo.saveProvider(
      'toggled-provider',
      makeOAuthProviderConfig({ disable_quota_check: true }) as any
    );
    let config = await repo.getProvider('toggled-provider');
    expect(config!.disable_quota_check).toBe(true);

    await repo.saveProvider(
      'toggled-provider',
      makeOAuthProviderConfig({ disable_quota_check: false }) as any
    );
    config = await repo.getProvider('toggled-provider');
    expect(config!.disable_quota_check).toBe(false);
  });

  it('round-trips false → true when provider is updated', async () => {
    await repo.saveProvider(
      'toggled-provider',
      makeOAuthProviderConfig({ disable_quota_check: false }) as any
    );
    let config = await repo.getProvider('toggled-provider');
    expect(config!.disable_quota_check).toBe(false);

    await repo.saveProvider(
      'toggled-provider',
      makeOAuthProviderConfig({ disable_quota_check: true }) as any
    );
    config = await repo.getProvider('toggled-provider');
    expect(config!.disable_quota_check).toBe(true);
  });

  it('persists correctly for a regular (non-OAuth) provider', async () => {
    await repo.saveProvider(
      'regular-provider',
      makeRegularProviderConfig({ disable_quota_check: true }) as any
    );
    const config = await repo.getProvider('regular-provider');
    expect(config).not.toBeNull();
    expect(config!.disable_quota_check).toBe(true);
  });

  it('includes disable_quota_check in getAllProviders results', async () => {
    await repo.saveProvider(
      'provider-a',
      makeOAuthProviderConfig({ disable_quota_check: true }) as any
    );
    await repo.saveProvider(
      'provider-b',
      makeOAuthProviderConfig({ disable_quota_check: false }) as any
    );

    const all = await repo.getAllProviders();
    expect(all['provider-a']!.disable_quota_check).toBe(true);
    expect(all['provider-b']!.disable_quota_check).toBe(false);
  });
});
