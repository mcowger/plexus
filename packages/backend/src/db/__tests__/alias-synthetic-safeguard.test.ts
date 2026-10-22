import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '../client';
import { ConfigRepository } from '../config-repository';
import { runMigrations } from '../migrate';

describe('alias synthetic_safeguard_approval persistence', () => {
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

  it('round-trips the synthetic safeguard toggle as opt-in', async () => {
    await repo.saveAlias('luna-alias', {
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
      synthetic_safeguard_approval: true,
    } as never);

    const loaded = await repo.getAlias('luna-alias');
    expect(loaded?.synthetic_safeguard_approval).toBe(true);
  });

  it('defaults the toggle to off when unset', async () => {
    await repo.saveAlias('plain-alias', {
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
    } as never);

    const loaded = await repo.getAlias('plain-alias');
    expect(loaded?.synthetic_safeguard_approval ?? false).toBe(false);
  });
});
