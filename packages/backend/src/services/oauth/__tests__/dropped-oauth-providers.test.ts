import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../../db/client';
import { runMigrations } from '../../../db/migrate';
import { ConfigRepository } from '../../../db/config-repository';
import { ConfigService } from '../../configuration/config-service';
import { ProviderConfigSchema } from '../../../config';

// Gemini CLI / Antigravity OAuth were removed. The removal
// is now COMPLETE (no retained-but-inert enum values):
//   1. The config schema rejects these provider ids on write.
//   2. Any persisted provider/credential rows are purged on startup by
//      ConfigService.dropRetiredOAuthProviders().

const RETIRED = ['google-gemini-cli', 'google-antigravity'] as const;

describe('dropped OAuth providers — schema rejection', () => {
  it.each(RETIRED)('ProviderConfigSchema rejects oauth_provider=%s on write', (provider) => {
    const result = ProviderConfigSchema.safeParse({
      api_base_url: 'oauth://',
      oauth_provider: provider,
      oauth_account: 'legacy',
    });
    expect(result.success).toBe(false);
  });

  it('still accepts supported OAuth providers', () => {
    for (const provider of ['anthropic', 'openai-codex', 'github-copilot']) {
      const result = ProviderConfigSchema.safeParse({
        api_base_url: 'oauth://',
        oauth_provider: provider,
        oauth_account: 'acct',
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('dropRetiredOAuthProviders — startup purge of persisted rows', () => {
  let repo: ConfigRepository;
  let service: ConfigService;

  beforeEach(async () => {
    await closeDatabase();
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    const schema = getSchema();
    const db = getDatabase();
    await db.delete(schema.providers);
    await db.delete(schema.oauthCredentials);
    repo = new ConfigRepository();
    service = new ConfigService(repo);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('drops persisted Gemini/Antigravity providers + credentials, keeps others', async () => {
    // Seed credentials + providers directly (bypassing the schema, mirroring
    // rows written by an older Plexus build that still allowed these values).
    for (const provider of RETIRED) {
      await repo.setOAuthCredentials(provider, 'legacy', {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      await repo.saveProvider(`old-${provider}`, {
        api_base_url: 'oauth://',
        oauth_provider: provider as any,
        oauth_account: 'legacy',
        models: {},
      } as any);
    }
    // A surviving native OAuth provider.
    await repo.saveProvider('cc', {
      api_base_url: 'oauth://anthropic',
      oauth_provider: 'anthropic',
      oauth_account: 'main',
      models: {},
    } as any);

    const dropped = await service.dropRetiredOAuthProviders();

    expect(dropped.sort()).toEqual(['old-google-antigravity', 'old-google-gemini-cli']);

    const providers = await repo.getAllProviders();
    expect(Object.keys(providers).sort()).toEqual(['cc']);

    const creds = await repo.getAllOAuthProviders();
    expect(creds.some((c) => RETIRED.includes(c.providerType as any))).toBe(false);
  });

  it('is a no-op when there is nothing to drop', async () => {
    await repo.saveProvider('cc', {
      api_base_url: 'oauth://anthropic',
      oauth_provider: 'anthropic',
      oauth_account: 'main',
      models: {},
    } as any);

    const dropped = await service.dropRetiredOAuthProviders();

    expect(dropped).toEqual([]);
    expect(Object.keys(await repo.getAllProviders())).toEqual(['cc']);
  });
});
