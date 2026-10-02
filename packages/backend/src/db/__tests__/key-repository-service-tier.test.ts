import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { KeyConfig } from '../../config';

describe('key repository defaultServiceTier persistence', () => {
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;
  let repo: ConfigRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    db = getDatabase();
    schema = getSchema();
    repo = new ConfigRepository();
    await db.delete(schema.apiKeys);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('saveKey stores defaultServiceTier in the generation JSON and getAllKeys reads it back', async () => {
    const config: KeyConfig = { secret: 'sk-tier', defaultServiceTier: 'flex' };
    await repo.saveKey('tier-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'tier-key')!;
    const generation =
      typeof row.generation === 'string' ? JSON.parse(row.generation) : row.generation;
    expect(generation).toEqual({ serviceTier: 'flex' });

    const keys = await repo.getAllKeys();
    expect(keys['tier-key']?.defaultServiceTier).toBe('flex');
  });

  it('getKeyBySecret reads the same defaultServiceTier', async () => {
    const config: KeyConfig = { secret: 'sk-tier-secret', defaultServiceTier: 'priority' };
    await repo.saveKey('tier-secret-key', config);

    const found = await repo.getKeyBySecret('sk-tier-secret');
    expect(found?.name).toBe('tier-secret-key');
    expect(found?.config.defaultServiceTier).toBe('priority');
  });

  it('updating an existing key replaces the stored tier', async () => {
    await repo.saveKey('updatable-tier-key', {
      secret: 'sk-updatable',
      defaultServiceTier: 'flex',
    });
    await repo.saveKey('updatable-tier-key', {
      secret: 'sk-updatable',
      defaultServiceTier: 'ultrafast',
    });

    const keys = await repo.getAllKeys();
    expect(keys['updatable-tier-key']?.defaultServiceTier).toBe('ultrafast');
  });

  it('a save without defaultServiceTier clears the stored tier (generation null)', async () => {
    await repo.saveKey('clear-tier-key', { secret: 'sk-clear', defaultServiceTier: 'fast' });

    await repo.saveKey('clear-tier-key', { secret: 'sk-clear' });

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'clear-tier-key')!;
    expect(row.generation).toBeNull();

    const keys = await repo.getAllKeys();
    expect(keys['clear-tier-key']?.defaultServiceTier).toBeUndefined();
    const found = await repo.getKeyBySecret('sk-clear');
    expect(found?.config.defaultServiceTier).toBeUndefined();
  });

  it('a key never assigned a tier reads back without the field', async () => {
    await repo.saveKey('no-tier-key', { secret: 'sk-no-tier' });

    const keys = await repo.getAllKeys();
    expect(keys['no-tier-key']?.defaultServiceTier).toBeUndefined();
  });
});
