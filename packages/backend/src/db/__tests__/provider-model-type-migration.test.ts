import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ProviderRepository } from '../provider-repository';

describe('ProviderRepository.migrateModelTypes', () => {
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    db = getDatabase();
    schema = getSchema();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it("rewrites legacy provider-model 'chat' and 'responses' types to 'text'", async () => {
    const provider = await db
      .insert(schema.providers)
      .values({
        slug: 'legacy-provider',
        name: 'Legacy Provider',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning({ id: schema.providers.id });
    const providerId = provider[0]!.id;

    await db.insert(schema.providerModels).values([
      { providerId, modelName: 'gpt-chat', modelType: 'chat', sortOrder: 0 },
      { providerId, modelName: 'gpt-responses', modelType: 'responses', sortOrder: 1 },
      { providerId, modelName: 'gpt-text', modelType: 'text', sortOrder: 2 },
      { providerId, modelName: 'gpt-untyped', modelType: null, sortOrder: 3 },
    ]);

    const repo = new ProviderRepository();
    const affected = await repo.migrateModelTypes();
    expect(affected).toBe(2);

    const rows = await db
      .select()
      .from(schema.providerModels)
      .where(eq(schema.providerModels.providerId, providerId));
    const byName = Object.fromEntries(
      rows.map((r: { modelName: string; modelType: string | null }) => [r.modelName, r.modelType])
    );
    expect(byName['gpt-chat']).toBe('text');
    expect(byName['gpt-responses']).toBe('text');
    expect(byName['gpt-text']).toBe('text');
    expect(byName['gpt-untyped']).toBeNull();
  });

  it('is idempotent — a second run touches nothing', async () => {
    const provider = await db
      .insert(schema.providers)
      .values({
        slug: 'legacy-provider-2',
        name: 'Legacy Provider 2',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning({ id: schema.providers.id });

    await db.insert(schema.providerModels).values({
      providerId: provider[0]!.id,
      modelName: 'gpt-chat',
      modelType: 'chat',
      sortOrder: 0,
    });

    const repo = new ProviderRepository();
    expect(await repo.migrateModelTypes()).toBeGreaterThanOrEqual(1);
    expect(await repo.migrateModelTypes()).toBe(0);
  });
});
