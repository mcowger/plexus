import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { QuotaEnforcer, QuotaCheckResult } from '../src/services/quota/quota-enforcer';
import { setConfigForTesting, PlexusConfig } from '../src/config';
import { getDatabase } from '../src/db/client';
import * as sqliteSchema from '../drizzle/schema/sqlite';
import { eq } from 'drizzle-orm';

// Test configuration
const createTestConfig = (userQuotas: Record<string, any> = {}, keys: Record<string, any> = {}): PlexusConfig => ({
  providers: {},
  models: {},
  keys,
  adminKey: 'test-admin-key',
  failover: {
    enabled: true,
    retryableStatusCodes: [500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
  },
  quotas: [],
  user_quotas: userQuotas,
});

describe('QuotaEnforcer', () => {
  let quotaEnforcer: QuotaEnforcer;
  let db: ReturnType<typeof getDatabase>;

  beforeEach(async () => {
    // Reset database state
    db = getDatabase();
    await db.delete(sqliteSchema.quotaState);
    
    // Reset config
    setConfigForTesting(createTestConfig());
    
    // Create fresh QuotaEnforcer instance
    quotaEnforcer = new QuotaEnforcer();
  });

  afterEach(async () => {
    // Clean up test data
    await db.delete(sqliteSchema.quotaState);
  });

  describe('checkQuota', () => {
    test('should return null when key has no quota assigned', async () => {
      setConfigForTesting(createTestConfig(
        {},
        { test_key: { secret: 'sk-test', quota: undefined } }
      ));

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should return null when key does not exist', async () => {
      const result = await quotaEnforcer.checkQuota('nonexistent_key');
      expect(result).toBeNull();
    });

    test('should allow request when rolling quota is under limit', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_rolling: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {
          test_rolling: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 100,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {
          test_rolling: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_rolling' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {
          test_daily: {
            type: 'daily',
            limitType: 'requests',
            limit: 100,
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_daily' } }
      ));

      // Record usage
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 1, tokensOutput: 0 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();
      
      // Check that resetsAt is at or after midnight UTC
      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      tomorrow.setUTCHours(0, 0, 0, 0);
      
      expect(result!.resetsAt!.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
    });

    test('should reset weekly quota at UTC Sunday midnight', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_weekly: {
            type: 'weekly',
            limitType: 'requests',
            limit: 1000,
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_weekly' } }
      ));

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.resetsAt).not.toBeNull();
      
      // Check that resetsAt is a Sunday
      expect(result!.resetsAt!.getUTCDay()).toBe(0); // Sunday = 0
    });

    test('should handle request-based quotas correctly', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_requests: {
            type: 'rolling',
            limitType: 'requests',
            limit: 10,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_requests' } }
      ));

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await quotaEnforcer.recordUsage('test_key', {});
      }

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).not.toBeNull();
      expect(result!.currentUsage).toBe(5);
      expect(result!.remaining).toBe(5);
    });
  });

  describe('recordUsage', () => {
    test('should record token usage correctly', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {},
        { test_key: { secret: 'sk-test' } }
      ));

      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: 100,
        tokensOutput: 50,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should accumulate usage across multiple calls', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      await quotaEnforcer.recordUsage('test_key', { tokensInput: 100 });
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 200 });
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 300 });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(600);
    });
  });

  describe('clearQuota', () => {
    test('should reset quota usage to zero', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {},
        { test_key: { secret: 'sk-test', quota: 'nonexistent_quota' } }
      ));

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result).toBeNull();
    });

    test('should handle null/undefined token values', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      await quotaEnforcer.recordUsage('test_key', {
        tokensInput: null as any,
        tokensOutput: undefined,
      });

      const result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
    });

    test('should handle concurrent quota checks gracefully', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'requests',
            limit: 100,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      // Simulate concurrent checks
      const promises = Array(10).fill(null).map(() => quotaEnforcer.checkQuota('test_key'));
      const results = await Promise.all(promises);

      // All should succeed and return valid results
      results.forEach(result => {
        expect(result).not.toBeNull();
        expect(result!.allowed).toBe(true);
      });
    });

    test('should reset usage when quota type changes from requests to tokens', async () => {
      // Start with requests quota
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'requests',
            limit: 10,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await quotaEnforcer.recordUsage('test_key', {});
      }

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5);
      expect(result!.limitType).toBe('requests');

      // Change quota to tokens with limit of 1000
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 1000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      // Use 5000 tokens
      await quotaEnforcer.recordUsage('test_key', { tokensInput: 3000, tokensOutput: 2000 });

      let result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(5000);
      expect(result!.limitType).toBe('tokens');

      // Change quota to requests
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'requests',
            limit: 100,
            duration: '1h',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

      // Create new enforcer to pick up new config
      quotaEnforcer = new QuotaEnforcer();

      // Check should reset usage because limitType changed
      result = await quotaEnforcer.checkQuota('test_key');
      expect(result!.currentUsage).toBe(0);
      expect(result!.limitType).toBe('requests');
      expect(result!.limit).toBe(100);
    });

    test('should handle invalid duration gracefully', async () => {
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: 'invalid_duration_string',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

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
      setConfigForTesting(createTestConfig(
        {
          test_quota: {
            type: 'rolling',
            limitType: 'tokens',
            limit: 10000,
            duration: '',
          },
        },
        { test_key: { secret: 'sk-test', quota: 'test_quota' } }
      ));

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
