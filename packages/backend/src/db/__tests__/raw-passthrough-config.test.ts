import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';

describe('raw passthrough configuration persistence', () => {
  let repository: ConfigRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    repository = new ConfigRepository();
    await repository.clearAllData();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  test('round-trips provider raw transport configuration', async () => {
    await repository.saveProvider('openrouter', {
      api_base_url: 'https://openrouter.ai/api/v1',
      api_key: 'provider-secret',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      raw_passthrough: {
        enabled: true,
        base_url: 'https://openrouter.ai/api',
        auth: 'bearer',
      },
    });

    const provider = await repository.getProvider('openrouter');
    expect(provider?.raw_passthrough).toEqual({
      enabled: true,
      base_url: 'https://openrouter.ai/api',
      auth: 'bearer',
    });
  });

  test('round-trips the key raw capability with default deny', async () => {
    await repository.saveKey('allowed', {
      secret: 'allowed-secret',
      allowRawPassthrough: true,
    });
    await repository.saveKey('denied', { secret: 'denied-secret' });

    const keys = await repository.getAllKeys();
    expect(keys.allowed?.allowRawPassthrough).toBe(true);
    expect(keys.denied?.allowRawPassthrough).toBe(false);
  });
});
