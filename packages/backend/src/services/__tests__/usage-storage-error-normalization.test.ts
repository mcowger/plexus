import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { UsageStorageService } from '../usage-storage';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';

describe('UsageStorageService.saveError', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.inferenceErrors);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('stringifies object providerResponse values before persisting details', async () => {
    const storage = new UsageStorageService();

    await storage.saveError('req-error-normalization', new Error('boom'), {
      apiType: 'chat',
      provider: 'test-provider',
      providerResponse: {
        error: {
          message: 'structured provider error',
          code: 400,
        },
      },
    });

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const rows = await db
      .select({ details: schema.inferenceErrors.details })
      .from(schema.inferenceErrors)
      .where(eq(schema.inferenceErrors.requestId, 'req-error-normalization'));

    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0].details);
    expect(typeof details.providerResponse).toBe('string');
    expect(JSON.parse(details.providerResponse)).toEqual({
      error: {
        message: 'structured provider error',
        code: 400,
      },
    });
  });
});
