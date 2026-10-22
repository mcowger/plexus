import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '../client';
import { ConfigRepository } from '../config-repository';
import { runMigrations } from '../migrate';

describe('alias short_name override persistence', () => {
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

  it('round-trips an explicit short_name override', async () => {
    await repo.saveAlias('short-alias', {
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
      metadata: {
        source: 'custom',
        overrides: { name: 'Anthropic: Claude Sonnet 5.5', short_name: 'Custom Short' },
      },
    } as never);

    const loaded = await repo.getAlias('short-alias');
    const overrides =
      loaded?.metadata && 'overrides' in loaded.metadata ? loaded.metadata.overrides : undefined;
    expect(overrides?.short_name).toBe('Custom Short');
  });

  it('omits short_name when no override is set (derived at resolve time)', async () => {
    await repo.saveAlias('auto-alias', {
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
      metadata: {
        source: 'custom',
        overrides: { name: 'Anthropic: Claude Sonnet 5.5' },
      },
    } as never);

    const loaded = await repo.getAlias('auto-alias');
    const overrides =
      loaded?.metadata && 'overrides' in loaded.metadata ? loaded.metadata.overrides : undefined;
    expect(overrides?.short_name).toBeUndefined();
  });
});
