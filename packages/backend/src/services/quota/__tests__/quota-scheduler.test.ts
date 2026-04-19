import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { CooldownManager } from '../../cooldown-manager';
import type { QuotaChecker, QuotaCheckResult } from '../../../types/quota';

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

describe('QuotaScheduler maxUtilizationPercent', () => {
  const PROVIDER = 'threshold-test-provider';

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
    // Clean up any cooldowns we injected
    const cooldownManager = CooldownManager.getInstance();
    await cooldownManager.markProviderSuccess(PROVIDER, '');
    await closeDatabase();
  });

  const makeResult = (utilizationPercent: number): QuotaCheckResult => ({
    provider: PROVIDER,
    checkerId: 'threshold-checker',
    checkedAt: new Date(),
    success: true,
    windows: [
      {
        windowType: 'rolling_five_hour',
        limit: 1000,
        used: Math.round((utilizationPercent / 100) * 1000),
        remaining: Math.round(((100 - utilizationPercent) / 100) * 1000),
        utilizationPercent,
        unit: 'requests',
        resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000), // 5 hours from now
        status: utilizationPercent >= 99 ? 'exhausted' : 'ok',
        description: 'Rolling 5-hour limit',
      },
    ],
  });

  it('defaults to 99% threshold when no maxUtilizationPercent set', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: {}, // no maxUtilizationPercent
      },
      async checkQuota() {
        return makeResult(98);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    await scheduler.applyCooldownsFromResult(makeResult(98));

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true); // 98% < 99% default — should stay healthy
  });

  it('triggers cooldown at 99% with default threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: {},
      },
      async checkQuota() {
        return makeResult(99);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    await scheduler.applyCooldownsFromResult(makeResult(99));

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false); // 99% >= 99% — should cooldown
  });

  it('respects maxUtilizationPercent: 30 — cooldowns at 30%', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: { maxUtilizationPercent: 30 },
      },
      get exhaustionThreshold() {
        return 30;
      },
      async checkQuota() {
        return makeResult(30);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    await scheduler.applyCooldownsFromResult(makeResult(30));

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false); // 30% >= 30% threshold — should cooldown
  });

  it('respects maxUtilizationPercent: 30 — does not cooldown at 29%', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: { maxUtilizationPercent: 30 },
      },
      get exhaustionThreshold() {
        return 30;
      },
      async checkQuota() {
        return makeResult(29);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    await scheduler.applyCooldownsFromResult(makeResult(29));

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true); // 29% < 30% threshold — should stay healthy
  });

  it('clears cooldown when utilization drops below threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: { maxUtilizationPercent: 30 },
      },
      get exhaustionThreshold() {
        return 30;
      },
      async checkQuota() {
        return makeResult(30);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    // First: trigger cooldown at 30%
    await scheduler.applyCooldownsFromResult(makeResult(30));
    let isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);

    // Then: utilization drops to 20% — cooldown should be cleared
    await scheduler.applyCooldownsFromResult(makeResult(20));
    isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });

  it('handles multiple windows where only one exceeds threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const checker: QuotaChecker = {
      config: {
        id: 'threshold-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: { maxUtilizationPercent: 30 },
      },
      get exhaustionThreshold() {
        return 30;
      },
      async checkQuota() {
        return makeResult(30);
      },
    };
    scheduler.checkers.set('threshold-checker', checker);

    const result: QuotaCheckResult = {
      provider: PROVIDER,
      checkerId: 'threshold-checker',
      checkedAt: new Date(),
      success: true,
      windows: [
        {
          windowType: 'rolling_five_hour',
          limit: 1000,
          used: 100,
          remaining: 900,
          utilizationPercent: 10,
          unit: 'requests',
          resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
          status: 'ok',
          description: 'Rolling 5-hour limit',
        },
        {
          windowType: 'rolling_weekly',
          limit: 48,
          used: 15,
          remaining: 33,
          utilizationPercent: 31,
          unit: 'dollars',
          resetsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          status: 'ok',
          description: 'Weekly token credits',
        },
      ],
    };

    await scheduler.applyCooldownsFromResult(result);

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false); // weekly window at 31% >= 30% threshold
  });

  it('prevents lenient checker from clearing strict checker cooldown', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;

    // Strict checker (threshold=30)
    const strictChecker: QuotaChecker = {
      config: {
        id: 'strict-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 5,
        options: { maxUtilizationPercent: 30 },
      },
      get exhaustionThreshold() {
        return 30;
      },
      async checkQuota() {
        return makeResult(35);
      },
    };

    // Lenient checker (default threshold=99)
    const lenientChecker: QuotaChecker = {
      config: {
        id: 'lenient-checker',
        provider: PROVIDER,
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 30,
        options: {},
      },
      async checkQuota() {
        return makeResult(35);
      },
    };

    scheduler.checkers.set('strict-checker', strictChecker);
    scheduler.checkers.set('lenient-checker', lenientChecker);

    // Strict checker triggers cooldown at 35% >= 30%
    await scheduler.applyCooldownsFromResult({
      provider: PROVIDER,
      checkerId: 'strict-checker',
      checkedAt: new Date(),
      success: true,
      windows: [
        {
          windowType: 'rolling_five_hour',
          limit: 1000,
          used: 350,
          remaining: 650,
          utilizationPercent: 35,
          unit: 'requests',
          resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
          status: 'ok',
          description: 'Rolling 5-hour limit',
        },
      ],
    });

    let isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);

    // Lenient checker runs — 35% < 99%, but should NOT clear the cooldown
    await scheduler.applyCooldownsFromResult({
      provider: PROVIDER,
      checkerId: 'lenient-checker',
      checkedAt: new Date(),
      success: true,
      windows: [
        {
          windowType: 'rolling_five_hour',
          limit: 1000,
          used: 350,
          remaining: 650,
          utilizationPercent: 35,
          unit: 'requests',
          resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
          status: 'ok',
          description: 'Rolling 5-hour limit',
        },
      ],
    });

    isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false); // Still cooled down — lenient checker didn't clear it
  });
});
