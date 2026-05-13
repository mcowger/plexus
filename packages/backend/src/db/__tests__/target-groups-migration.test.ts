import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { eq } from 'drizzle-orm';
import { ConfigRepository } from '../config-repository';
import { toDbBoolean } from '../../utils/normalize';

describe('migrateLegacyTargetGroups', () => {
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
    // Clean slate for each test
    await db.delete(schema.modelAliasTargets);
    await db.delete(schema.modelAliases);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('migrates a legacy alias with flat targets to grouped format', async () => {
    const ts = Date.now();

    // Insert legacy alias row (no targetGroups, flat selector)
    const aliasResult = await db
      .insert(schema.modelAliases)
      .values({
        slug: 'legacy-alias',
        selector: 'in_order',
        priority: 'selector',
        modelType: 'chat',
        targetGroups: null, // legacy — no groups
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: schema.modelAliases.id });

    const aliasId = aliasResult[0]!.id;

    // Insert legacy target rows (no groupName)
    await db.insert(schema.modelAliasTargets).values({
      aliasId,
      providerSlug: 'openai',
      modelName: 'gpt-4',
      enabled: toDbBoolean(true),
      sortOrder: 0,
      groupName: null, // legacy
      createdAt: ts,
      updatedAt: ts,
    });

    await db.insert(schema.modelAliasTargets).values({
      aliasId,
      providerSlug: 'anthropic',
      modelName: 'claude-3',
      enabled: toDbBoolean(true),
      sortOrder: 1,
      groupName: null,
      createdAt: ts,
      updatedAt: ts,
    });

    // Run migration
    const migrated = await repo.migrateLegacyTargetGroups();
    expect(migrated).toEqual(['legacy-alias']);

    // Verify alias row now has target_groups JSON
    const aliasRows = await db
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, 'legacy-alias'));
    expect(aliasRows).toHaveLength(1);
    const aliasRow = aliasRows[0]!;
    expect(aliasRow.targetGroups).toBeTruthy();
    const groups = JSON.parse(aliasRow.targetGroups as string);
    expect(groups).toEqual([{ name: 'default', selector: 'in_order' }]);

    // Verify targets now have groupName='default'
    const targetRows = await db
      .select()
      .from(schema.modelAliasTargets)
      .where(eq(schema.modelAliasTargets.aliasId, aliasId));
    expect(targetRows).toHaveLength(2);
    for (const t of targetRows) {
      expect(t.groupName).toBe('default');
    }
  });

  it('does not touch already-migrated aliases', async () => {
    const ts = Date.now();

    await db.insert(schema.modelAliases).values({
      slug: 'modern-alias',
      selector: 'random',
      priority: 'selector',
      targetGroups: JSON.stringify([{ name: 'default', selector: 'random' }]),
      createdAt: ts,
      updatedAt: ts,
    });

    const migrated = await repo.migrateLegacyTargetGroups();
    expect(migrated).toEqual([]);
  });

  it('migrates an alias with no targets', async () => {
    const ts = Date.now();

    await db.insert(schema.modelAliases).values({
      slug: 'empty-alias',
      selector: 'random',
      priority: 'selector',
      targetGroups: null,
      createdAt: ts,
      updatedAt: ts,
    });

    const migrated = await repo.migrateLegacyTargetGroups();
    expect(migrated).toEqual(['empty-alias']);

    const rows = await db
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, 'empty-alias'));
    const groups = JSON.parse(rows[0]!.targetGroups as string);
    expect(groups).toEqual([{ name: 'default', selector: 'random' }]);
  });

  it('migrates multiple legacy aliases in one call', async () => {
    const ts = Date.now();

    for (const slug of ['a', 'b', 'c']) {
      await db.insert(schema.modelAliases).values({
        slug,
        selector: 'random',
        priority: 'selector',
        targetGroups: null,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    const migrated = await repo.migrateLegacyTargetGroups();
    expect(migrated.sort()).toEqual(['a', 'b', 'c']);
  });

  it('rowToModelConfig returns grouped format after migration', async () => {
    const ts = Date.now();

    const aliasResult = await db
      .insert(schema.modelAliases)
      .values({
        slug: 'roundtrip-alias',
        selector: 'in_order',
        priority: 'selector',
        targetGroups: null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: schema.modelAliases.id });

    const aliasId = aliasResult[0]!.id;

    await db.insert(schema.modelAliasTargets).values({
      aliasId,
      providerSlug: 'p1',
      modelName: 'm1',
      enabled: toDbBoolean(true),
      sortOrder: 0,
      groupName: null,
      createdAt: ts,
      updatedAt: ts,
    });

    await repo.migrateLegacyTargetGroups();

    const cfg = await repo.getAlias('roundtrip-alias');
    expect(cfg).toBeDefined();
    expect(cfg!.target_groups).toHaveLength(1);
    expect(cfg!.target_groups![0]).toMatchObject({
      name: 'default',
      selector: 'in_order',
    });
    expect(cfg!.target_groups![0]!.targets).toHaveLength(1);
    expect(cfg!.target_groups![0]!.targets[0]).toMatchObject({
      provider: 'p1',
      model: 'm1',
      enabled: true,
    });
  });

  it('saveAlias writes new grouped format correctly', async () => {
    await repo.saveAlias('new-alias', {
      target_groups: [
        { name: 'primary', selector: 'random', targets: [{ provider: 'p1', model: 'm1' }] },
        { name: 'fallback', selector: 'in_order', targets: [{ provider: 'p2', model: 'm2' }] },
      ],
    } as any);

    const cfg = await repo.getAlias('new-alias');
    expect(cfg).toBeDefined();
    expect(cfg!.target_groups).toHaveLength(2);
    expect(cfg!.target_groups![0]).toMatchObject({
      name: 'primary',
      selector: 'random',
    });
    expect(cfg!.target_groups![1]).toMatchObject({
      name: 'fallback',
      selector: 'in_order',
    });

    // Verify DB row stores only name+selector in JSON
    const rows = await db
      .select()
      .from(schema.modelAliases)
      .where(eq(schema.modelAliases.slug, 'new-alias'));
    const storedGroups = JSON.parse(rows[0]!.targetGroups as string);
    expect(storedGroups).toEqual([
      { name: 'primary', selector: 'random' },
      { name: 'fallback', selector: 'in_order' },
    ]);

    // Verify targets have correct groupName
    const targetRows = await db.select().from(schema.modelAliasTargets);
    expect(targetRows).toHaveLength(2);
    const byGroup = new Map<string, any[]>();
    for (const t of targetRows) {
      const list = byGroup.get(t.groupName) ?? [];
      list.push(t);
      byGroup.set(t.groupName, list);
    }
    expect(byGroup.get('primary')).toHaveLength(1);
    expect(byGroup.get('fallback')).toHaveLength(1);
  });

  it('round-trips sticky_session through saveAlias and getAlias', async () => {
    await repo.saveAlias('sticky-on', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p1', model: 'm1' }] },
      ],
      sticky_session: true,
    } as any);

    await repo.saveAlias('sticky-off', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p2', model: 'm2' }] },
      ],
      sticky_session: false,
    } as any);

    await repo.saveAlias('sticky-unset', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p3', model: 'm3' }] },
      ],
    } as any);

    expect((await repo.getAlias('sticky-on'))!.sticky_session).toBe(true);
    expect((await repo.getAlias('sticky-off'))!.sticky_session).toBe(false);
    // Unset on input defaults to false in the DB column.
    expect((await repo.getAlias('sticky-unset'))!.sticky_session).toBe(false);
  });
});
