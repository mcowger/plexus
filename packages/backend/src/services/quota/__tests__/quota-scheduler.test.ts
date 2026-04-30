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
import type { MeterCheckResult, Meter } from '../../../types/meter';
import type { QuotaConfig } from '../../../config';

const CHECKER_ID = 'quota-persistence-checker';

const makeConfig = (
  overrides: Partial<{ maxUtilizationPercent: number; disableQuotaCooldown: boolean }> & {
    id?: string;
    provider?: string;
  } = {}
): QuotaConfig => ({
  id: overrides.id ?? CHECKER_ID,
  provider: overrides.provider ?? 'test-provider',
  type: 'synthetic',
  enabled: true,
  intervalMinutes: 60,
  disableQuotaCooldown: overrides.disableQuotaCooldown ?? false,
  options: {
    ...(overrides.maxUtilizationPercent !== undefined
      ? { maxUtilizationPercent: overrides.maxUtilizationPercent }
      : {}),
  },
});

const makeMeter = (
  utilizationPercent: number,
  resetsAtMs: number = Date.now() + 5 * 60 * 60 * 1000
): Meter => ({
  key: 'test_meter',
  label: 'Test meter',
  kind: 'allowance',
  unit: 'requests',
  limit: 1000,
  used: Math.round((utilizationPercent / 100) * 1000),
  remaining: Math.round(((100 - utilizationPercent) / 100) * 1000),
  utilizationPercent,
  status: utilizationPercent >= 99 ? 'exhausted' : utilizationPercent >= 90 ? 'critical' : 'ok',
  periodValue: 5,
  periodUnit: 'hour',
  periodCycle: 'rolling',
  resetsAt: new Date(resetsAtMs).toISOString(),
});

const makeMeterResult = (
  utilizationPercent: number,
  checkerId = CHECKER_ID,
  provider = 'test-provider'
): MeterCheckResult => ({
  checkerId,
  checkerType: 'synthetic',
  provider,
  checkedAt: new Date().toISOString(),
  success: true,
  meters: [makeMeter(utilizationPercent)],
});

describe('QuotaScheduler persistence', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.meterSnapshots);
  });

  afterEach(async () => {
    QuotaScheduler.getInstance().stop();
    await closeDatabase();
  });

  it('persists meter snapshots without timestamp conversion errors', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;

    const result: MeterCheckResult = {
      checkerId: CHECKER_ID,
      checkerType: 'synthetic',
      provider: 'test-provider',
      checkedAt: new Date('2026-02-08T15:08:22.000Z').toISOString(),
      success: true,
      meters: [
        {
          key: 'test_meter',
          label: 'test window',
          kind: 'allowance',
          unit: 'requests',
          limit: 100,
          used: 15,
          remaining: 85,
          utilizationPercent: 15,
          status: 'ok',
          periodValue: 1,
          periodUnit: 'month',
          periodCycle: 'fixed',
          resetsAt: new Date('2026-02-09T00:00:00.000Z').toISOString(),
        },
      ],
    };

    await scheduler.persistResult(result);

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const rows = await db
      .select()
      .from(schema.meterSnapshots)
      .where(eq(schema.meterSnapshots.checkerId, CHECKER_ID));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.meterKey).toBe('test_meter');
    if (getCurrentDialect() === 'sqlite') {
      expect(rows[0]?.checkedAt).toBeInstanceOf(Date);
    } else {
      expect(typeof rows[0]?.checkedAt).toBe('number');
    }
    expect(rows[0]?.success).toBe(true);
    expect(rows[0]?.utilizationState).toBe('reported');
    expect(rows[0]?.utilizationPercent).toBeCloseTo(15);
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
    await db.delete(schema.meterSnapshots);
  });

  afterEach(async () => {
    QuotaScheduler.getInstance().stop();
    const cooldownManager = CooldownManager.getInstance();
    await cooldownManager.markProviderSuccess(PROVIDER, '');
    await closeDatabase();
  });

  it('defaults to 99% threshold — stays healthy at 98%', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER });
    scheduler.configs.set('threshold-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(98, 'threshold-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });

  it('triggers cooldown at 99% with default threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER });
    scheduler.configs.set('threshold-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(99, 'threshold-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);
  });

  it('respects maxUtilizationPercent: 30 — cooldowns at 30%', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, maxUtilizationPercent: 30 });
    scheduler.configs.set('threshold-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(30, 'threshold-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);
  });

  it('respects maxUtilizationPercent: 30 — does not cooldown at 29%', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, maxUtilizationPercent: 30 });
    scheduler.configs.set('threshold-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(29, 'threshold-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });

  it('clears cooldown when utilization drops below threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, maxUtilizationPercent: 30 });
    scheduler.configs.set('threshold-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(30, 'threshold-checker', PROVIDER),
      config
    );
    let isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(20, 'threshold-checker', PROVIDER),
      config
    );
    isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });

  it('handles multiple meters where only one exceeds threshold', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, maxUtilizationPercent: 30 });
    scheduler.configs.set('threshold-checker', config);

    const result: MeterCheckResult = {
      checkerId: 'threshold-checker',
      checkerType: 'synthetic',
      provider: PROVIDER,
      checkedAt: new Date().toISOString(),
      success: true,
      meters: [
        { ...makeMeter(10), key: 'rolling_5h', label: 'Rolling 5-hour limit' },
        { ...makeMeter(31), key: 'weekly_credits', label: 'Weekly token credits' },
      ],
    };

    await scheduler.applyCooldownsFromResult(result, config);

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);
  });

  it('prevents lenient checker from clearing strict checker cooldown', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;

    const strictConfig = makeConfig({
      id: 'strict-checker',
      provider: PROVIDER,
      maxUtilizationPercent: 30,
    });
    const lenientConfig = makeConfig({ id: 'lenient-checker', provider: PROVIDER });

    scheduler.configs.set('strict-checker', strictConfig);
    scheduler.configs.set('lenient-checker', lenientConfig);

    // Strict checker triggers cooldown at 35% >= 30%
    await scheduler.applyCooldownsFromResult(
      makeMeterResult(35, 'strict-checker', PROVIDER),
      strictConfig
    );
    let isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);

    // Lenient checker runs — 35% < 99%, but should NOT clear the cooldown
    await scheduler.applyCooldownsFromResult(
      makeMeterResult(35, 'lenient-checker', PROVIDER),
      lenientConfig
    );
    isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);
  });
});

describe('QuotaScheduler disableQuotaCooldown', () => {
  const PROVIDER = 'disable-quota-cooldown-test-provider';

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.meterSnapshots);
  });

  afterEach(async () => {
    QuotaScheduler.getInstance().stop();
    const cooldownManager = CooldownManager.getInstance();
    await cooldownManager.markProviderSuccess(PROVIDER, '');
    await closeDatabase();
  });

  it('does not inject a quota cooldown when disableQuotaCooldown is true, even at 100% utilization', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, disableQuotaCooldown: true });
    scheduler.configs.set('no-quota-cooldown-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(100, 'no-quota-cooldown-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });

  it('still injects a cooldown when disableQuotaCooldown is false (default)', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, disableQuotaCooldown: false });
    scheduler.configs.set('with-quota-cooldown-checker', config);

    await scheduler.applyCooldownsFromResult(
      makeMeterResult(99, 'with-quota-cooldown-checker', PROVIDER),
      config
    );

    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(false);
  });

  it('disableQuotaCooldown does not affect quota data persistence', async () => {
    const scheduler = QuotaScheduler.getInstance() as any;
    const config = makeConfig({ provider: PROVIDER, disableQuotaCooldown: true });
    scheduler.configs.set('no-quota-cooldown-persist-checker', config);

    const result = makeMeterResult(100, 'no-quota-cooldown-persist-checker', PROVIDER);
    await scheduler.persistResult(result);
    await scheduler.applyCooldownsFromResult(result, config);

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    const rows = await db
      .select()
      .from(schema.meterSnapshots)
      .where(eq(schema.meterSnapshots.checkerId, 'no-quota-cooldown-persist-checker'));

    // Meter data was still persisted
    expect(rows.length).toBeGreaterThan(0);
    // But no cooldown was injected
    const isHealthy = await CooldownManager.getInstance().isProviderHealthy(PROVIDER, '');
    expect(isHealthy).toBe(true);
  });
});
