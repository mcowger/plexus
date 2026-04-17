import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  getCurrentDialect,
  getDatabase,
  getSchema,
  initializeDatabase,
} from '../../../db/client';
import { runMigrations } from '../../../db/migrate';
import { QuotaScheduler } from '../quota-scheduler';
import type { QuotaChecker } from '../../../types/quota';

const CHECKER_ID = 'quota-persistence-checker';

const makeChecker = (): QuotaChecker => ({
  config: {
    id: CHECKER_ID,
    provider: 'test-provider',
    type: 'test',
    enabled: true,
    intervalMinutes: 60,
    options: {},
  },
  async checkQuota() {
    return {
      provider: 'test-provider',
      checkerId: CHECKER_ID,
      checkedAt: new Date('2026-02-08T15:08:22.000Z'),
      success: true,
      windows: [
        {
          windowType: 'subscription',
          limit: 100,
          used: 15,
          remaining: 85,
          utilizationPercent: 15,
          unit: 'requests',
          resetsAt: new Date('2026-02-09T00:00:00.000Z'),
          status: 'ok',
          description: 'test window',
        },
      ],
    };
  },
});

describe('QuotaScheduler persistence', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.quotaSnapshots);
  });

  afterEach(async () => {
    QuotaScheduler.getInstance().stop();
    await closeDatabase();
  });

  it('persists quota windows with resetsAt without timestamp conversion errors', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    scheduler.checkers.set(CHECKER_ID, makeChecker());

    await QuotaScheduler.getInstance().runCheckNow(CHECKER_ID);

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const rows = await db
      .select()
      .from(schema.quotaSnapshots)
      .where(eq(schema.quotaSnapshots.checkerId, CHECKER_ID));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowType).toBe('subscription');
    if (getCurrentDialect() === 'sqlite') {
      expect(rows[0]?.resetsAt).toBeInstanceOf(Date);
    } else {
      expect(typeof rows[0]?.resetsAt).toBe('number');
    }
    expect(rows[0]?.success).toBe(true);
  });
});
