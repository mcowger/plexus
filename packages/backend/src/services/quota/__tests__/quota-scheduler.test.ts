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
import { registerSpy } from '../../../../test/test-utils';

const CHECKER_ID = 'quota-persistence-checker';

const makeConfig = (
  overrides: Partial<{ maxUtilizationPercent: number }> & { id?: string; provider?: string } = {}
): QuotaConfig => ({
  id: overrides.id ?? CHECKER_ID,
  provider: overrides.provider ?? 'test-provider',
  type: 'synthetic',
  enabled: true,
  intervalMinutes: 60,
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

const makeRoutingRunMeter = (
  key: 'daily' | 'hourly' | 'minute',
  utilizationPercent: number,
  resetsAtMs: number
): Meter => ({
  ...makeMeter(utilizationPercent, resetsAtMs),
  key,
  label: `Routing.run ${key} quota`,
  periodValue: 1,
  periodUnit: key === 'daily' ? 'day' : key === 'hourly' ? 'hour' : 'minute',
  periodCycle: key === 'daily' ? 'fixed' : 'rolling',
});

const makeRoutingRunMeterResult = (
  meters: Meter[],
  checkerId = 'routing-run-checker',
  provider = 'routing-run-provider'
): MeterCheckResult => ({
  checkerId,
  checkerType: 'routing-run',
  provider,
  checkedAt: new Date().toISOString(),
  success: true,
  meters,
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

  it('marks scheduler initialized when initialize receives no quota configs', async () => {
    const scheduler = QuotaScheduler.getInstance();

    await scheduler.initialize([]);

    expect(scheduler.isInitialized()).toBe(true);
    expect(scheduler.getCheckerIds()).toEqual([]);
  });

  it('updates existing checker options and reschedules interval changes on reload', async () => {
    vi.useFakeTimers();

    try {
      const scheduler = QuotaScheduler.getInstance();
      const runCheckNow = registerSpy(scheduler, 'runCheckNow').mockResolvedValue(null);
      const initialConfig: QuotaConfig = {
        id: 'synthetic-reload-checker',
        provider: 'synthetic-provider',
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: {
          apiKey: 'synthetic-key',
          endpoint: 'https://old.example.com/v2/quotas',
        },
      };

      await scheduler.initialize([initialConfig]);
      runCheckNow.mockClear();

      await scheduler.reload([
        {
          ...initialConfig,
          intervalMinutes: 1,
          options: {
            apiKey: 'synthetic-key',
            endpoint: 'https://new.example.com/v2/quotas',
          },
        },
      ]);

      const configs = Reflect.get(scheduler, 'configs') as Map<string, QuotaConfig>;
      const updatedConfig = configs.get('synthetic-reload-checker');
      expect(updatedConfig?.intervalMinutes).toBe(1);
      expect(updatedConfig?.options.endpoint).toBe('https://new.example.com/v2/quotas');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(runCheckNow).toHaveBeenCalledWith('synthetic-reload-checker');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('QuotaScheduler maxUtilizationPercent', () => {
  const PROVIDER = 'threshold-test-provider';
  const ROUTING_RUN_PROVIDER = 'routing-run-provider';
  const ROUTING_RUN_CHECKER_ID = 'routing-run-checker';

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
    await cooldownManager.markProviderSuccess(ROUTING_RUN_PROVIDER, '');
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

  describe('Routing.run cooldown regression', () => {
    const makeRoutingRunConfig = () =>
      makeConfig({ id: ROUTING_RUN_CHECKER_ID, provider: ROUTING_RUN_PROVIDER });

    it('triggers provider cooldown when the daily meter is exhausted', async () => {
      const scheduler = QuotaScheduler.getInstance() as any;
      const config = makeRoutingRunConfig();
      scheduler.configs.set(ROUTING_RUN_CHECKER_ID, config);

      await scheduler.applyCooldownsFromResult(
        makeRoutingRunMeterResult([
          makeRoutingRunMeter('daily', 100, Date.now() + 24 * 60 * 60 * 1000),
        ]),
        config
      );

      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        ROUTING_RUN_PROVIDER,
        ''
      );
      expect(isHealthy).toBe(false);
    });

    it('triggers provider cooldown when the hourly meter is exhausted', async () => {
      const scheduler = QuotaScheduler.getInstance() as any;
      const config = makeRoutingRunConfig();
      scheduler.configs.set(ROUTING_RUN_CHECKER_ID, config);

      await scheduler.applyCooldownsFromResult(
        makeRoutingRunMeterResult([
          makeRoutingRunMeter('hourly', 100, Date.now() + 60 * 60 * 1000),
        ]),
        config
      );

      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        ROUTING_RUN_PROVIDER,
        ''
      );
      expect(isHealthy).toBe(false);
    });

    it('triggers provider cooldown when the minute meter is exhausted', async () => {
      const scheduler = QuotaScheduler.getInstance() as any;
      const config = makeRoutingRunConfig();
      scheduler.configs.set(ROUTING_RUN_CHECKER_ID, config);

      await scheduler.applyCooldownsFromResult(
        makeRoutingRunMeterResult([makeRoutingRunMeter('minute', 100, Date.now() + 60 * 1000)]),
        config
      );

      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        ROUTING_RUN_PROVIDER,
        ''
      );
      expect(isHealthy).toBe(false);
    });

    it('keeps Lite plan provider healthy when daily and minute meters are below threshold', async () => {
      const scheduler = QuotaScheduler.getInstance() as any;
      const config = makeRoutingRunConfig();
      scheduler.configs.set(ROUTING_RUN_CHECKER_ID, config);

      await scheduler.applyCooldownsFromResult(
        makeRoutingRunMeterResult([
          makeRoutingRunMeter('daily', 30, Date.now() + 24 * 60 * 60 * 1000),
          makeRoutingRunMeter('minute', 30, Date.now() + 60 * 1000),
        ]),
        config
      );

      const isHealthy = await CooldownManager.getInstance().isProviderHealthy(
        ROUTING_RUN_PROVIDER,
        ''
      );
      expect(isHealthy).toBe(true);
    });
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
