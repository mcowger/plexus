import { describe, test, expect, beforeEach, afterEach, beforeAll, mock } from 'bun:test';
import { QuotaEnforcer, QuotaCheckResult } from '../src/services/quota/quota-enforcer';
import { setConfigForTesting, getConfig, PlexusConfig } from '../src/config';
import { getDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import * as sqliteSchema from '../drizzle/schema/sqlite';
import { eq } from 'drizzle-orm';

// Test configuration
const createTestConfig = (
  userQuotas: Record<string, any> = {},
  keys: Record<string, any> = {}
): PlexusConfig => ({
  providers: {},
  models: {},
  keys,
  adminKey: 'test-admin-key',
  failover: {
    enabled: true,
    retryableStatusCodes: [500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
  },
  cooldown: {
    initialMinutes: 2,
    maxMinutes: 300,
  },
  performanceExplorationRate: 0.05,
  latencyExplorationRate: 0.05,
  quotas: [],
  user_quotas: userQuotas,
});

describe('QuotaEnforcer', () => {
  let quotaEnforcer: QuotaEnforcer;
  let db: ReturnType<typeof getDatabase>;

  beforeAll(async () => {
    // Ensure migrations are run before tests
    await runMigrations();
  });

  beforeEach(async () => {
    // Reset database state
    db = getDatabase();
    try {
      await db.delete(sqliteSchema.quotaState);
    } catch (e: any) {
      // Table might not exist yet, ignore
      if (!e.message?.includes('no such table')) {
        throw e;
      }
    }

    // Reset config (defensive: verify it took effect to catch stale spies from other tests)
    const config = createTestConfig();
    setConfigForTesting(config);
    const actualConfig = getConfig();
    if (actualConfig.user_quotas !== config.user_quotas || actualConfig.keys !== config.keys) {
      throw new Error(
        '[quota-enforcer] setConfigForTesting did not take effect — possible stale getConfig spy from another test file'
      );
    }

    // Create fresh QuotaEnforcer instance
    quotaEnforcer = new QuotaEnforcer();
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await db.delete(sqliteSchema.quotaState);
    } catch (e: any) {
      // Table might not exist, ignore
      if (!e.message?.includes('no such table')) {
        throw e;
      }
    }
  });

  describe('checkQuota', () => {
    test('should return null when key has no quota assigned', async () => {
      setConfigForTesting(
        createTestConfig({}, { test_key: { secret: 'sk-test', quota: undefined } })
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should return null when key does not exist', async () => {
      const result = await quotaEnforcer.checkQuota('nonexistent_key');
      expect(result).toBeNull();
    });

    test('should allow request when rolling quota is under limit', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_rolling: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
        )
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(true);
      expect(result!.quotaName).toBe('test_rolling');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limit).toBe(10000);
      expect(result!.remaining).toBe(10000);
      expect(result!.limitType).toBe('tokens');
    });

    test('should deny request when rolling quota is exceeded', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_rolling: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 100,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
        )
      );

      // Record usage that exceeds limit
      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: 150,
        tokensOutput: 0,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(false);
      expect(result!.currentUsage).toBeGreaterThanOrEqual(150);
    });

    test('should calculate leak correctly for rolling quotas', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_rolling: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
        )
      );

      // Record initial usage
      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: 5000,
        tokensOutput: 0,
      });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBeGreaterThanOrEqual(5000);

      // Wait a bit (simulated by manually updating the timestamp in a real test)
      // In practice, we'd mock Date.now() or use a longer duration
    });

    test('should reset daily quota at UTC midnight', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_daily: {
              type: 'daily',
              limitType: 'requests',
              limit: 100,
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_daily' } }
        )
      );

      // Record usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 1, tokensOutput: 0 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();

      // Check that resetsAt is at or after midnight UTC
      const now = new Date();
      const tomorrow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      );
      tomorrow.setUTCHours(0, 0, 0, 0);

      expect(result!.resetsAt!.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
    });

    test('should reset weekly quota at UTC Sunday midnight', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_weekly: {
              type: 'weekly',
              limitType: 'requests',
              limit: 1000,
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_weekly' } }
        )
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();

      // Check that resetsAt is a Sunday
      expect(result!.resetsAt!.getUTCDay()).toBe(0); // Sunday = 0
    });

    test('should handle request-based quotas correctly', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_requests: {
              type: 'rolling',
              limitType: 'requests',
              limit: 10,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_requests' } }
        )
      );

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await quotaEnforcer.recordUsage('test_key', {});
      }

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.currentUsage).toBe(5);
      expect(result!.remaining).toBe(5);
    });

    test('should allow request when cost quota is under limit', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_cost' } }
        )
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(true);
      expect(result!.quotaName).toBe('test_cost');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limit).toBe(10);
      expect(result!.remaining).toBe(10);
      expect(result!.limitType).toBe('cost');
    });

    test('should deny request when cost quota is exceeded', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 1.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_cost' } }
        )
      );

      // Record usage that exceeds limit ($1.00)
      await quotaEnforcer.recordUsage('test_key', {
        costTotal: 1.5,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(false);
      expect(result!.currentUsage).toBeGreaterThanOrEqual(1.5);
    });

    test('should reset cost quota at UTC midnight', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_daily_cost: {
              type: 'daily',
              limitType: 'cost',
              limit: 100.0,
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_daily_cost' } }
        )
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();

      // Check that resetsAt is at or after midnight UTC
      const now = new Date();
      const tomorrow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      );
      tomorrow.setUTCHours(0, 0, 0, 0);

      expect(result!.resetsAt!.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
    });

    test('should reset weekly cost quota at UTC Sunday midnight', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_weekly_cost: {
              type: 'weekly',
              limitType: 'cost',
              limit: 1000.0,
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_weekly_cost' } }
        )
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();
      expect(result!.resetsAt!.getUTCDay()).toBe(0); // Sunday = 0
    });
  });

  describe('recordUsage', () => {
    test('should record token usage correctly', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: 100,
        tokensOutput: 50,
        tokensCached: 25,
        tokensReasoning: 10,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(185); // 100 + 50 + 25 + 10
    });

    test('should not record usage for key without quota', async () => {
      setConfigForTesting(createTestConfig({}, { test_key: { secret: 'sk-test' } }));

      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: 100,
        tokensOutput: 50,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should accumulate usage across multiple calls', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      await quotaEnforcer.recordUsage('test_key', { tokensInput: 100 });
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 200 });
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 300 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(600);
    });

    test('should record cost usage correctly using costTotal', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost_quota: {
              type: 'rolling',
              limitType: 'cost',
              limit: 100.0,
              duration: '1h',
            },
          },
          { test_key_cost: { secret: 'sk-test', quota: 'test_cost_quota' } }
        )
      );

      // Create fresh enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('test_key_cost', {
        costTotal: 0.5,
      });

      const result = await quotaEnforcer.checkQuota('test_key_cost');
      expect(result!.currentUsage).toBe(0.5);
    });

    test('should accumulate cost usage across multiple calls', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost_accum: {
              type: 'rolling',
              limitType: 'cost',
              limit: 100.0,
              duration: '1h',
            },
          },
          { test_key_cost_accum: { secret: 'sk-test', quota: 'test_cost_accum' } }
        )
      );

      // Create fresh enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('test_key_cost_accum', { costTotal: 0.25 });
      await quotaEnforcer.recordUsage('test_key_cost_accum', { costTotal: 0.75 });
      await quotaEnforcer.recordUsage('test_key_cost_accum', { costTotal: 1.5 });

      const result = await quotaEnforcer.checkQuota('test_key_cost_accum');
      expect(result!.currentUsage).toBe(2.5);
    });

    test('should handle costTotal of 0 correctly', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_cost' } }
        )
      );

      await quotaEnforcer.recordUsage('test_key', { costTotal: 0 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
    });

    test('should handle missing costTotal as 0', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_cost' } }
        )
      );

      // Record without costTotal - should use 0
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 100 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
    });

    test('should not leak cost in rolling quotas - cumulative spending only', async () => {
      // Setup: rolling cost quota with $5 limit over 1 hour
      setConfigForTesting(
        createTestConfig(
          {
            test_cost_cumulative: {
              type: 'rolling',
              limitType: 'cost',
              limit: 5.0,
              duration: '1h',
            },
          },
          { test_key_cost_cum: { secret: 'sk-test', quota: 'test_cost_cumulative' } }
        )
      );

      // Create fresh enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Record $2.50 usage
      await quotaEnforcer.recordUsage('test_key_cost_cum', { costTotal: 2.5 });

      const result1 = await quotaEnforcer.checkQuota('test_key_cost_cum');
      expect(result1!.currentUsage).toBe(2.5);
      expect(result1!.remaining).toBe(2.5);
      expect(result1!.allowed).toBe(true);

      // Record another $1.50 - should accumulate to $4.00, NOT leak
      await quotaEnforcer.recordUsage('test_key_cost_cum', { costTotal: 1.5 });

      const result2 = await quotaEnforcer.checkQuota('test_key_cost_cum');
      expect(result2!.currentUsage).toBe(4.0);
      expect(result2!.remaining).toBe(1.0);
      expect(result2!.allowed).toBe(true);

      // Verify quota denies when cost limit is exceeded
      await quotaEnforcer.recordUsage('test_key_cost_cum', { costTotal: 2.0 }); // Would be $6 total

      const result3 = await quotaEnforcer.checkQuota('test_key_cost_cum');
      expect(result3!.currentUsage).toBe(6.0);
      expect(result3!.remaining).toBe(0);
      expect(result3!.allowed).toBe(false);
    });

    test('should set resetsAt to window start + duration for rolling cost quotas using math-based alignment', async () => {
      // Setup: rolling cost quota with $10 limit over 1 month
      setConfigForTesting(
        createTestConfig(
          {
            monthly_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1mo',
            },
          },
          { test_key_monthly: { secret: 'sk-test', quota: 'monthly_cost' } }
        )
      );

      // Create fresh enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check quota for the first time (initializes windowStartDate)
      const result = await quotaEnforcer.checkQuota('test_key_monthly');

      expect(result!.allowed).toBe(true);
      expect(result!.resetsAt).not.toBeNull();

      // Verify reset date is window start + duration (math-based alignment)
      // With math-based floor division: resetsAt = alignedWindowStart + ~30.44 days
      // The aligned window start is floor(now / 30.44 days) * 30.44 days
      const resetsAt = result!.resetsAt!;
      const now = new Date();

      // parse-duration returns ~2,629,800,000 ms for "1mo"
      const oneMonthMs = 2629800000;

      // Calculate what the aligned window start should be
      const alignedWindowStart = Math.floor(now.getTime() / oneMonthMs) * oneMonthMs;

      // resetsAt should be alignedWindowStart + duration
      const expectedResetMs = alignedWindowStart + oneMonthMs;
      const tolerance = 1000; // 1 second tolerance

      expect(Math.abs(resetsAt.getTime() - expectedResetMs)).toBeLessThan(tolerance);
    });

    test('should set resetsAt to window start + duration for non-month rolling cost quotas', async () => {
      // Setup: rolling cost quota with $10 limit over 1 hour
      setConfigForTesting(
        createTestConfig(
          {
            hourly_cost: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key_hourly: { secret: 'sk-test', quota: 'hourly_cost' } }
        )
      );

      // Create fresh enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      const now = new Date();
      const result = await quotaEnforcer.checkQuota('test_key_hourly');

      expect(result!.allowed).toBe(true);
      expect(result!.resetsAt).not.toBeNull();

      // Window is aligned to the top of the current hour
      // Reset should be at the top of the next hour
      const resetsAt = result!.resetsAt!;
      expect(resetsAt.getUTCMinutes()).toBe(0);
      expect(resetsAt.getUTCSeconds()).toBe(0);
      expect(resetsAt.getUTCMilliseconds()).toBe(0);

      // Should be in the future
      expect(resetsAt.getTime()).toBeGreaterThan(now.getTime());

      // Should be within 1 hour from now (since window is aligned to hour boundary)
      const oneHour = 60 * 60 * 1000;
      expect(resetsAt.getTime()).toBeLessThanOrEqual(now.getTime() + oneHour);
    });
  });

  describe('clearQuota', () => {
    test('should reset quota usage to zero', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Record some usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 5000 });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5000);

      // Clear quota
      await quotaEnforcer.clearQuota('test_key');

      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('should handle missing quota definition gracefully', async () => {
      setConfigForTesting(
        createTestConfig({}, { test_key: { secret: 'sk-test', quota: 'nonexistent_quota' } })
      );

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should handle null/undefined token values', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: null as any,
        tokensOutput: undefined,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
    });

    test('should handle concurrent quota checks gracefully', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'requests',
              limit: 100,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Simulate concurrent checks
      const promises = Array(10)
        .fill(null)
        .map(() => quotaEnforcer.checkQuota('test_key'));
      const results = await Promise.all(promises);

      // All should succeed and return valid results
      results.forEach((result) => {
        expect(result).not.toBeNull();
        expect(result!.allowed).toBe(true);
      });
    });

    test('should reset usage when quota type changes from requests to tokens', async () => {
      // Start with requests quota
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'requests',
              limit: 10,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await quotaEnforcer.recordUsage('test_key', {});
      }

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5);
      expect(result!.limitType).toBe('requests');

      // Change quota to tokens with limit of 1000
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 1000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('tokens');
      expect(result!.limit).toBe(1000);

      // Record token usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 500, tokensOutput: 200 });

      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(700); // 500 + 200
    });

    test('should reset usage when quota type changes from tokens to requests', async () => {
      // Start with tokens quota
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Use 5000 tokens
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 3000, tokensOutput: 2000 });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5000);
      expect(result!.limitType).toBe('tokens');

      // Change quota to requests
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'requests',
              limit: 100,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('requests');
      expect(result!.limit).toBe(100);
    });

    test('should reset usage when quota type changes from tokens to cost', async () => {
      // Start with tokens quota
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Use 5000 tokens
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 3000, tokensOutput: 2000 });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5000);
      expect(result!.limitType).toBe('tokens');

      // Change quota to cost
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('cost');
      expect(result!.limit).toBe(10);
    });

    test('should reset usage when quota type changes from cost to tokens', async () => {
      // Start with cost quota
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'cost',
              limit: 10.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Use $5.00
      await quotaEnforcer.recordUsage('test_key', { costTotal: 5.0 });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5.0);
      expect(result!.limitType).toBe('cost');

      // Change quota to tokens
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 1000,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('tokens');
      expect(result!.limit).toBe(1000);
    });

    test('should reset usage when quota type changes from requests to cost', async () => {
      // Start with requests quota
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'requests',
              limit: 100,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Make 50 requests
      for (let i = 0; i < 50; i++) {
        await quotaEnforcer.recordUsage('test_key', {});
      }

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(50);
      expect(result!.limitType).toBe('requests');

      // Change quota to cost
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'cost',
              limit: 5.0,
              duration: '1h',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('cost');
      expect(result!.limit).toBe(5);
    });

    test('should handle invalid duration gracefully', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: 'invalid_duration_string',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // First check works (no existing state, no leak calc needed yet)
      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(true);
      expect(result!.resetsAt).toBeNull(); // Can't calculate resetsAt with invalid duration

      // Record some usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 100 });

      // Subsequent check should return null because it can't calculate leak
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should handle empty duration string', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            test_quota: {
              type: 'rolling',
              limitType: 'tokens',
              limit: 10000,
              duration: '',
            },
          },
          { test_key: { secret: 'sk-test', quota: 'test_quota' } }
        )
      );

      // First check works
      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();

      // Record usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 100 });

      // Subsequent check fails due to empty duration
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });
  });
});
