import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { ProviderConfig } from '../../config';

describe('provider model autosync persistence', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    repo = new ConfigRepository();
    await repo.clearAllData();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('persists model_autosync and additively inserts missing provider models', async () => {
    const provider: ProviderConfig = {
      api_base_url: 'https://api.example.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      model_autosync: { enabled: true, intervalMinutes: 15 },
      models: {
        existing: {
          pricing: { source: 'simple', input: 1, output: 2 },
          access_via: ['legacy-existing'],
        },
      },
    };

    await repo.saveProvider('autosync-provider', provider);

    const loaded = await repo.getProvider('autosync-provider');
    expect(loaded?.model_autosync).toEqual({ enabled: true, intervalMinutes: 15 });

    const added = await repo.addMissingProviderModels('autosync-provider', [
      'existing',
      'new-b',
      'new-a',
      'new-a',
      '',
    ]);

    expect(added).toBe(2);

    const updated = await repo.getProvider('autosync-provider');
    expect(updated?.models).toEqual({
      existing: {
        pricing: { source: 'simple', input: 1, output: 2 },
        access_via: ['legacy-existing'],
      },
      'new-b': {
        pricing: { source: 'simple', input: 0, output: 0 },
        access_via: [],
      },
      'new-a': {
        pricing: { source: 'simple', input: 0, output: 0 },
        access_via: [],
      },
    });
  });
});
