import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { KeyConfig, QuotaDefinition } from '../../config';

describe('config-repository multi-quota round-trips', () => {
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
    await db.delete(schema.apiKeys);
    await db.delete(schema.userQuotaDefinitions);
    await db.delete(schema.systemSettings);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  // ─── API keys: quota_names / quota_name compat ──────────────────────

  it('a row with only legacy quota_name set reads back as quotas: [name]', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'legacy-key',
      secret: 'sk-legacy',
      secretHash: 'hash-legacy',
      quotaName: 'legacy-quota',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const keys = await repo.getAllKeys();
    expect(keys['legacy-key']?.quotas).toEqual(['legacy-quota']);
  });

  it('a row with quota_names set reads back the parsed array, ignoring quota_name', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'multi-key',
      secret: 'sk-multi',
      secretHash: 'hash-multi',
      quotaName: 'stale-legacy-quota',
      quotaNames: JSON.stringify(['quota-a', 'quota-b']),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const keys = await repo.getAllKeys();
    expect(keys['multi-key']?.quotas).toEqual(['quota-a', 'quota-b']);
  });

  it('a row with neither quota_name nor quota_names has quotas undefined', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'no-quota-key',
      secret: 'sk-none',
      secretHash: 'hash-none',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const keys = await repo.getAllKeys();
    expect(keys['no-quota-key']?.quotas).toBeUndefined();
  });

  it('getKeyBySecret applies the same quota_names/quota_name fallback', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'secret-lookup-key',
      secret: 'sk-secret-lookup',
      secretHash: 'hash-secret-lookup',
      quotaName: 'legacy-only',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const found = await repo.getKeyBySecret('sk-secret-lookup');
    expect(found?.config.quotas).toEqual(['legacy-only']);
  });

  it('saveKey writes quota_names only and never touches quota_name', async () => {
    const config: KeyConfig = { secret: 'sk-new', quotas: ['q1', 'q2'] };
    await repo.saveKey('new-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'new-key')!;
    expect(JSON.parse(row.quotaNames as string)).toEqual(['q1', 'q2']);
    expect(row.quotaName).toBeNull();
  });

  it('saveKey on an existing row leaves a pre-existing quota_name column value untouched', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'preexisting-key',
      secret: 'sk-old-secret',
      secretHash: 'hash-old-secret',
      quotaName: 'do-not-touch',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const config: KeyConfig = { secret: 'sk-old-secret', quotas: ['new-quota'] };
    await repo.saveKey('preexisting-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'preexisting-key')!;
    expect(row.quotaName).toBe('do-not-touch');
    expect(JSON.parse(row.quotaNames as string)).toEqual(['new-quota']);
  });

  it('saveKey with no quotas clears quota_names (stores null) without touching quota_name', async () => {
    const config: KeyConfig = { secret: 'sk-bare' };
    await repo.saveKey('bare-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'bare-key')!;
    expect(row.quotaNames).toBeNull();
    expect(row.quotaName).toBeNull();
  });

  it('saveKey with quotas: [] on a row with legacy quota_name set writes "[]" (not NULL) so nothing resurrects', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'clearing-key',
      secret: 'sk-clearing',
      secretHash: 'hash-clearing',
      quotaName: 'stale-legacy-quota',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const config: KeyConfig = { secret: 'sk-clearing', quotas: [] };
    await repo.saveKey('clearing-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'clearing-key')!;
    expect(row.quotaNames).toBe('[]');
    expect(row.quotaName).toBe('stale-legacy-quota');

    // The read path must NOT fall back to the stale legacy column now that
    // quota_names is non-NULL and authoritative.
    const keys = await repo.getAllKeys();
    expect(keys['clearing-key']?.quotas).toEqual([]);
  });

  it('saveKey with quotas absent (undefined) writes NULL, preserving the legacy quota_name fallback on read', async () => {
    await db.insert(schema.apiKeys).values({
      name: 'untouched-legacy-key',
      secret: 'sk-untouched',
      secretHash: 'hash-untouched',
      quotaName: 'still-legacy',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // `quotas` is absent (undefined), not an empty array — quota_names is
    // written as NULL, so the legacy quota_name fallback still applies.
    const config: KeyConfig = { secret: 'sk-untouched', comment: 'updated' };
    await repo.saveKey('untouched-legacy-key', config);

    const rows = await db.select().from(schema.apiKeys);
    const row = rows.find((r: any) => r.name === 'untouched-legacy-key')!;
    expect(row.quotaNames).toBeNull();
    expect(row.quotaName).toBe('still-legacy');

    const keys = await repo.getAllKeys();
    expect(keys['untouched-legacy-key']?.quotas).toEqual(['still-legacy']);
  });

  // ─── User quota definitions: scope fields / shared / warnAt ─────────

  it('round-trips scope fields, shared, and warnAt through saveUserQuota/getAllUserQuotas', async () => {
    const quota: QuotaDefinition = {
      type: 'daily',
      limitType: 'requests',
      limit: 100,
      allowedProviders: ['openai'],
      excludedProviders: ['anthropic'],
      allowedModels: ['gpt-4'],
      excludedModels: ['gpt-3.5'],
      shared: true,
      warnAt: 0.8,
    } as QuotaDefinition;

    await repo.saveUserQuota('scoped-quota', quota);

    const all = await repo.getAllUserQuotas();
    const loaded = all['scoped-quota'];
    expect(loaded).toMatchObject({
      type: 'daily',
      limitType: 'requests',
      limit: 100,
      allowedProviders: ['openai'],
      excludedProviders: ['anthropic'],
      allowedModels: ['gpt-4'],
      excludedModels: ['gpt-3.5'],
      shared: true,
      warnAt: 0.8,
    });
  });

  it('a quota saved without scope fields reloads with them absent (not empty arrays)', async () => {
    const quota: QuotaDefinition = { type: 'daily', limitType: 'requests', limit: 100 };
    await repo.saveUserQuota('unscoped-quota', quota);

    const all = await repo.getAllUserQuotas();
    const loaded = all['unscoped-quota'];
    expect(loaded).toBeDefined();
    expect(loaded!.allowedModels).toBeUndefined();
    expect(loaded!.allowedProviders).toBeUndefined();
    expect(loaded!.excludedModels).toBeUndefined();
    expect(loaded!.excludedProviders).toBeUndefined();
    expect(loaded!.shared).toBeUndefined();
    expect(loaded!.warnAt).toBeUndefined();
  });

  it('updating an existing quota definition persists new scope fields', async () => {
    await repo.saveUserQuota('updatable-quota', {
      type: 'daily',
      limitType: 'requests',
      limit: 100,
    } as QuotaDefinition);

    await repo.saveUserQuota('updatable-quota', {
      type: 'daily',
      limitType: 'requests',
      limit: 200,
      allowedModels: ['gpt-4'],
      shared: true,
      warnAt: 0.9,
    } as QuotaDefinition);

    const all = await repo.getAllUserQuotas();
    expect(all['updatable-quota']).toMatchObject({
      limit: 200,
      allowedModels: ['gpt-4'],
      shared: true,
      warnAt: 0.9,
    });
  });
});
