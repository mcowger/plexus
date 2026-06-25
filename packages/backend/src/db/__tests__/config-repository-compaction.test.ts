import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';

describe('config-repository compaction round-trips', () => {
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
    // Clean slate
    await db.delete(schema.modelAliasTargets);
    await db.delete(schema.modelAliases);
    await db.delete(schema.providers);
    await db.delete(schema.systemSettings);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  // 1. Provider round-trip
  it('round-trips compaction through saveProvider and getProvider', async () => {
    const compaction = { enabled: true, strategy: 'headroom' as const, triggerRatio: 0.7 };

    await repo.saveProvider('test-provider', {
      api_base_url: 'https://api.example.com',
      compaction,
    } as any);

    const loaded = await repo.getProvider('test-provider');
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toEqual(compaction);
  });

  it('round-trips compaction via getAllProviders', async () => {
    const compaction = { enabled: true, strategy: 'headroom' as const, triggerRatio: 0.7 };

    await repo.saveProvider('all-provider', {
      api_base_url: 'https://api.example.com',
      compaction,
    } as any);

    const all = await repo.getAllProviders();
    const loaded = all['all-provider'];
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toEqual(compaction);
  });

  // 2. Alias round-trip
  it('round-trips compaction through saveAlias and getAlias', async () => {
    const compaction = { enabled: true, strategy: 'native' as const, triggerRatio: 0.8 };

    await repo.saveAlias('test-alias', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p1', model: 'm1' }] },
      ],
      compaction,
    } as any);

    const loaded = await repo.getAlias('test-alias');
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toEqual(compaction);
  });

  it('round-trips compaction via getAllAliases', async () => {
    const compaction = { enabled: false, strategy: 'headroom' as const };

    await repo.saveAlias('all-alias', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p2', model: 'm2' }] },
      ],
      compaction,
    } as any);

    const all = await repo.getAllAliases();
    const loaded = all['all-alias'];
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toEqual(compaction);
  });

  // 3. Null/absent — compaction must not leak through as null
  it('provider saved without compaction reloads with compaction absent (not null)', async () => {
    await repo.saveProvider('no-compaction-provider', {
      api_base_url: 'https://api.example.com',
    } as any);

    const loaded = await repo.getProvider('no-compaction-provider');
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toBeUndefined();
    expect('compaction' in loaded!).toBe(false);
  });

  it('alias saved without compaction reloads with compaction absent (not null)', async () => {
    await repo.saveAlias('no-compaction-alias', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p3', model: 'm3' }] },
      ],
    } as any);

    const loaded = await repo.getAlias('no-compaction-alias');
    expect(loaded).toBeDefined();
    expect(loaded!.compaction).toBeUndefined();
    expect('compaction' in loaded!).toBe(false);
  });

  // 4. Global getter via getCompactionConfig
  it('getCompactionConfig returns default empty object when not set', async () => {
    const cfg = await repo.getCompactionConfig();
    expect(cfg).toEqual({});
  });

  it('getCompactionConfig reflects value after setSetting', async () => {
    await repo.setSetting('compaction', { enabled: true });
    const cfg = await repo.getCompactionConfig();
    expect(cfg).toEqual({ enabled: true });
  });
});
