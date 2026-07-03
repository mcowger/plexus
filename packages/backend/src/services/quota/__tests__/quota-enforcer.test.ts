import { describe, test, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { QuotaEnforcer, SHARED_OWNER } from '../quota-enforcer';
import { setConfigForTesting, PlexusConfig } from '../../../config';
import { getDatabase, getSchema, getCurrentDialect } from '../../../db/client';
import { runMigrations } from '../../../db/migrate';
import { toDbTimestampMs } from '../../../utils/normalize';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createTestConfig = (
  userQuotas: Record<string, any> = {},
  keys: Record<string, any> = {},
  defaultQuotas: string[] = []
): PlexusConfig =>
  ({
    providers: {},
    models: {},
    keys,
    adminKey: 'test-admin-key',
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    cooldown: { initialMinutes: 2, maxMinutes: 300 },
    performanceExplorationRate: 0.05,
    latencyExplorationRate: 0.05,
    quotas: [],
    user_quotas: userQuotas,
    default_quotas: defaultQuotas,
  }) as unknown as PlexusConfig;

let idCounter = 0;

async function seedRequestUsage(
  db: ReturnType<typeof getDatabase>,
  schema: ReturnType<typeof getSchema>,
  overrides: Record<string, unknown>
) {
  const startTime = (overrides.startTime as number) ?? Date.now();
  idCounter += 1;
  await db.insert(schema.requestUsage).values({
    requestId: `req-${idCounter}-${Math.random().toString(36).slice(2)}`,
    date: new Date(startTime).toISOString().slice(0, 10),
    apiKey: null,
    finalAttemptProvider: null,
    finalAttemptModel: null,
    responseStatus: 'success',
    costTotal: null,
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCached: null,
    tokensCacheWrite: null,
    startTime,
    createdAt: startTime,
    ...overrides,
  } as any);
}

async function seedQuotaState(
  db: ReturnType<typeof getDatabase>,
  schema: ReturnType<typeof getSchema>,
  row: {
    keyName: string;
    quotaName: string;
    limitType: string;
    currentUsage: number;
    lastUpdated: number;
    windowStart?: number | null;
  }
) {
  const dialect = getCurrentDialect() === 'postgres' ? 'postgres' : 'sqlite';
  await db.insert(schema.quotaState).values({
    keyName: row.keyName,
    quotaName: row.quotaName,
    limitType: row.limitType,
    currentUsage: row.currentUsage,
    lastUpdated: toDbTimestampMs(row.lastUpdated, dialect)!,
    windowStart: toDbTimestampMs(row.windowStart ?? null, dialect),
  } as any);
}

describe('QuotaEnforcer', () => {
  let quotaEnforcer: QuotaEnforcer;
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    db = getDatabase();
    schema = getSchema();
    await db.delete(schema.quotaState);
    await db.delete(schema.requestUsage);

    setConfigForTesting(createTestConfig());
    quotaEnforcer = new QuotaEnforcer();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete(schema.quotaState);
    await db.delete(schema.requestUsage);
  });

  // ─── loadQuotaContext ────────────────────────────────────────────────

  describe('loadQuotaContext', () => {
    test('returns null for an unknown key', async () => {
      const ctx = await quotaEnforcer.loadQuotaContext('nonexistent');
      expect(ctx).toBeNull();
    });

    test('returns null when key has no quotas and no default_quotas', async () => {
      setConfigForTesting(createTestConfig({}, { k: { secret: 'sk-test' } }));
      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx).toBeNull();
    });

    test('multi-quota AND: all matching quotas must have headroom', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            reqs: { type: 'daily', limitType: 'requests', limit: 100 },
            toks: { type: 'daily', limitType: 'tokens', limit: 1000 },
          },
          { k: { secret: 'sk-test', quotas: ['reqs', 'toks'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx).not.toBeNull();
      expect(ctx!.checks).toHaveLength(2);
      expect(ctx!.checks.every((c) => c.allowed)).toBe(true);
      expect(ctx!.blockedGlobal).toBeNull();
    });

    test('one exhausted global quota sets blockedGlobal', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            reqs: { type: 'daily', limitType: 'requests', limit: 5 },
            toks: { type: 'daily', limitType: 'tokens', limit: 1000 },
          },
          { k: { secret: 'sk-test', quotas: ['reqs', 'toks'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      // Exhaust the requests quota directly.
      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'reqs',
        limitType: 'requests',
        currentUsage: 10,
        lastUpdated: Date.now(),
        windowStart: quotaEnforcerWindowStart('daily'),
      });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.blockedGlobal).not.toBeNull();
      expect(ctx!.blockedGlobal!.quotaName).toBe('reqs');
      expect(ctx!.checks.find((c) => c.quotaName === 'toks')!.allowed).toBe(true);
    });

    test('default_quotas substitution: key with no quotas gets defaults', async () => {
      setConfigForTesting(
        createTestConfig(
          { def1: { type: 'daily', limitType: 'requests', limit: 100 } },
          { k: { secret: 'sk-test' } },
          ['def1']
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks).toHaveLength(1);
      expect(ctx!.checks[0]!.quotaName).toBe('def1');
      expect(ctx!.checks[0]!.source).toBe('default');
    });

    test('default_quotas substitution: key with its own quotas ignores defaults (non-stacking)', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            own1: { type: 'daily', limitType: 'requests', limit: 100 },
            def1: { type: 'daily', limitType: 'requests', limit: 50 },
          },
          { k: { secret: 'sk-test', quotas: ['own1'] } },
          ['def1']
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks).toHaveLength(1);
      expect(ctx!.checks[0]!.quotaName).toBe('own1');
      expect(ctx!.checks[0]!.source).toBe('assigned');
    });

    test('limitType change resets usage even though window_start matches', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'daily', limitType: 'requests', limit: 100 } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'q',
        limitType: 'tokens', // stale limitType — config now says 'requests'
        currentUsage: 500,
        lastUpdated: Date.now(),
        windowStart: quotaEnforcerWindowStart('daily'),
      });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(0);
      expect(ctx!.checks[0]!.limitType).toBe('requests');
    });

    test('leak math: elapsed time decays a leaky rolling bucket', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const now = new Date('2026-03-15T12:00:00.000Z');
      vi.setSystemTime(now);

      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'tokens', limit: 1000, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      // Full 30 minutes ago; leak rate is 1000/3600000 tokens/ms → 500 leaked.
      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'q',
        limitType: 'tokens',
        currentUsage: 1000,
        lastUpdated: now.getTime() - 30 * 60 * 1000,
        windowStart: null,
      });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(500);
      expect(ctx!.checks[0]!.allowed).toBe(true);
    });

    test('ISO-Monday weekly window: window start anchors to Monday, not Sunday', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // 2024-01-01 is a Monday. Wednesday of the same week:
      const now = new Date('2024-01-03T15:00:00.000Z');
      vi.setSystemTime(now);

      setConfigForTesting(
        createTestConfig(
          { q: { type: 'weekly', limitType: 'requests', limit: 100 } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      const expectedWindowStart = new Date('2024-01-01T00:00:00.000Z').getTime();
      const expectedResetsAt = expectedWindowStart + 7 * 24 * 60 * 60 * 1000;
      expect(ctx!.checks[0]!.resetsAtMs).toBe(expectedResetsAt);

      // A row persisted with the OLD Sunday-anchored window_start (the
      // Sunday before this week, i.e. 2023-12-31) is treated as stale and
      // lazily resets rather than being trusted.
      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'q',
        limitType: 'requests',
        currentUsage: 42,
        lastUpdated: now.getTime(),
        windowStart: new Date('2023-12-31T00:00:00.000Z').getTime(),
      });

      const ctx2 = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx2!.checks[0]!.currentUsage).toBe(0);
    });
  });

  // ─── filterCandidates ────────────────────────────────────────────────

  describe('filterCandidates', () => {
    test('scoped exhausted quota blocks only the matching candidate', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            scoped: {
              type: 'daily',
              limitType: 'requests',
              limit: 1,
              allowedProviders: ['openai'],
            },
          },
          { k: { secret: 'sk-test', quotas: ['scoped'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'scoped',
        limitType: 'requests',
        currentUsage: 5,
        lastUpdated: Date.now(),
        windowStart: quotaEnforcerWindowStart('daily'),
      });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      const { allowed, blocked } = QuotaEnforcer.filterCandidates(ctx, [
        { provider: 'openai', model: 'gpt-4' },
        { provider: 'anthropic', model: 'claude' },
      ]);

      expect(allowed).toEqual([{ provider: 'anthropic', model: 'claude' }]);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.candidate).toEqual({ provider: 'openai', model: 'gpt-4' });
      expect(blocked[0]!.quota.quotaName).toBe('scoped');
    });

    test('null context allows everything', () => {
      const { allowed, blocked } = QuotaEnforcer.filterCandidates(null, [
        { provider: 'openai', model: 'gpt-4' },
      ]);
      expect(allowed).toHaveLength(1);
      expect(blocked).toHaveLength(0);
    });
  });

  // ─── selectHeaderQuota ───────────────────────────────────────────────

  describe('selectHeaderQuota', () => {
    test('picks the most-constrained applicable quota and passes warnAt through', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            loose: { type: 'daily', limitType: 'requests', limit: 1000 },
            tight: { type: 'daily', limitType: 'requests', limit: 10, warnAt: 0.8 },
          },
          { k: { secret: 'sk-test', quotas: ['loose', 'tight'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'loose',
        limitType: 'requests',
        currentUsage: 100, // 10% used
        lastUpdated: Date.now(),
        windowStart: quotaEnforcerWindowStart('daily'),
      });
      await seedQuotaState(db, schema, {
        keyName: 'k',
        quotaName: 'tight',
        limitType: 'requests',
        currentUsage: 9, // 90% used — most constrained
        lastUpdated: Date.now(),
        windowStart: quotaEnforcerWindowStart('daily'),
      });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      const header = QuotaEnforcer.selectHeaderQuota(ctx, 'openai', 'gpt-4');
      expect(header!.quotaName).toBe('tight');
      expect(header!.warnAt).toBe(0.8);
    });

    test('returns null for a null context', () => {
      expect(QuotaEnforcer.selectHeaderQuota(null, 'openai', 'gpt-4')).toBeNull();
    });
  });

  // ─── recordUsage ─────────────────────────────────────────────────────

  describe('recordUsage', () => {
    test('shared quota accrues into one "*" bucket across two keys', async () => {
      setConfigForTesting(
        createTestConfig(
          { pool: { type: 'daily', limitType: 'requests', limit: 100, shared: true } },
          {
            k1: { secret: 'sk-1', quotas: ['pool'] },
            k2: { secret: 'sk-2', quotas: ['pool'] },
          }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k1', 'openai', 'gpt-4', {});
      await quotaEnforcer.recordUsage('k2', 'openai', 'gpt-4', {});
      await quotaEnforcer.recordUsage('k1', 'openai', 'gpt-4', {});

      const rows = await db.select().from(schema.quotaState);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.keyName).toBe(SHARED_OWNER);
      expect(rows[0]!.currentUsage).toBe(3);

      const ctx1 = await quotaEnforcer.loadQuotaContext('k1');
      const ctx2 = await quotaEnforcer.loadQuotaContext('k2');
      expect(ctx1!.checks[0]!.currentUsage).toBe(3);
      expect(ctx2!.checks[0]!.currentUsage).toBe(3);
    });

    test('only records against quotas whose scope matches the final provider/model', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            openaiOnly: {
              type: 'daily',
              limitType: 'requests',
              limit: 100,
              allowedProviders: ['openai'],
            },
            everything: { type: 'daily', limitType: 'requests', limit: 100 },
          },
          { k: { secret: 'sk-test', quotas: ['openaiOnly', 'everything'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'anthropic', 'claude', {});

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks.find((c) => c.quotaName === 'openaiOnly')!.currentUsage).toBe(0);
      expect(ctx!.checks.find((c) => c.quotaName === 'everything')!.currentUsage).toBe(1);
    });

    test('limitType change resets the bucket instead of leaking stale usage', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'tokens', limit: 10000, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', { tokensInput: 5000 });
      let ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(5000);

      // Change the quota's limitType.
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'requests', limit: 100, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {});
      ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(1);
      expect(ctx!.checks[0]!.limitType).toBe('requests');
    });

    test('SQL-side leak: recordUsage decays the persisted bucket before adding new usage', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = new Date('2026-03-15T12:00:00.000Z');
      vi.setSystemTime(start);

      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'tokens', limit: 1000, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', { tokensInput: 800 });

      // 30 minutes later; leak rate is 1000/3600000 tokens/ms → 500 leaked.
      // Unlike the loadQuotaContext leak test above (in-memory computeSnapshot
      // math over a seeded row), this exercises upsertQuotaState's SQL CASE
      // expression: the DB row itself must decay from lastUpdated before the
      // new usage is added.
      vi.setSystemTime(new Date(start.getTime() + 30 * 60 * 1000));
      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', { tokensInput: 100 });

      const rows = await db.select().from(schema.quotaState);
      expect(rows).toHaveLength(1);
      // max(0, 800 - 500) + 100
      expect(rows[0]!.currentUsage).toBeCloseTo(400, 6);

      // lastUpdated advanced to the second write, so a fresh read decays
      // nothing further and reports the same value.
      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBeCloseTo(400, 6);
    });

    test('rolling-cost accumulates cumulatively within a window (no leak)', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'cost', limit: 10, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', { costTotal: 2.5 });
      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', { costTotal: 1.5 });

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(4);
    });

    test('concurrency: N parallel recordUsage calls sum exactly (atomic upsert)', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'daily', limitType: 'requests', limit: 1000 } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const N = 20;
      await Promise.all(
        Array.from({ length: N }, () => quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {}))
      );

      const rows = await db
        .select()
        .from(schema.quotaState)
        .where(eq(schema.quotaState.keyName, 'k'));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.currentUsage).toBe(N);
    });

    test('concurrency: N parallel recordUsage calls into a shared bucket from different keys sum exactly', async () => {
      setConfigForTesting(
        createTestConfig(
          { pool: { type: 'daily', limitType: 'requests', limit: 1000, shared: true } },
          {
            k1: { secret: 'sk-1', quotas: ['pool'] },
            k2: { secret: 'sk-2', quotas: ['pool'] },
          }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const N = 10;
      const calls = [
        ...Array.from({ length: N }, () => quotaEnforcer.recordUsage('k1', 'openai', 'gpt-4', {})),
        ...Array.from({ length: N }, () => quotaEnforcer.recordUsage('k2', 'openai', 'gpt-4', {})),
      ];
      await Promise.all(calls);

      const rows = await db
        .select()
        .from(schema.quotaState)
        .where(eq(schema.quotaState.keyName, SHARED_OWNER));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.currentUsage).toBe(N * 2);
    });
  });

  // ─── clearQuota ──────────────────────────────────────────────────────

  describe('clearQuota', () => {
    test('with no quotaName clears every quota attached to the key', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            a: { type: 'daily', limitType: 'requests', limit: 100 },
            b: { type: 'daily', limitType: 'requests', limit: 100 },
          },
          { k: { secret: 'sk-test', quotas: ['a', 'b'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {});
      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {});

      await quotaEnforcer.clearQuota('k');

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks.every((c) => c.currentUsage === 0)).toBe(true);
    });

    test('with a quotaName clears only that bucket', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            a: { type: 'daily', limitType: 'requests', limit: 100 },
            b: { type: 'daily', limitType: 'requests', limit: 100 },
          },
          { k: { secret: 'sk-test', quotas: ['a', 'b'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {});
      await quotaEnforcer.recordUsage('k', 'openai', 'gpt-4', {});

      await quotaEnforcer.clearQuota('k', 'a');

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks.find((c) => c.quotaName === 'a')!.currentUsage).toBe(0);
      // 'b' was untouched by clearQuota('k', 'a') — both calls recorded
      // against it (recordUsage hits every matching quota), so it's 2.
      expect(ctx!.checks.find((c) => c.quotaName === 'b')!.currentUsage).toBe(2);
    });

    test('shared quota clear resets the "*" row, not a per-key row', async () => {
      setConfigForTesting(
        createTestConfig(
          { pool: { type: 'daily', limitType: 'requests', limit: 100, shared: true } },
          {
            k1: { secret: 'sk-1', quotas: ['pool'] },
            k2: { secret: 'sk-2', quotas: ['pool'] },
          }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      await quotaEnforcer.recordUsage('k1', 'openai', 'gpt-4', {});
      await quotaEnforcer.recordUsage('k2', 'openai', 'gpt-4', {});

      await quotaEnforcer.clearQuota('k1');

      const rows = await db.select().from(schema.quotaState);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.keyName).toBe(SHARED_OWNER);
      expect(rows[0]!.currentUsage).toBe(0);

      // k2's view of the pool is also cleared, since it's the same bucket.
      const ctx2 = await quotaEnforcer.loadQuotaContext('k2');
      expect(ctx2!.checks[0]!.currentUsage).toBe(0);
    });
  });

  // ─── recomputeQuota ──────────────────────────────────────────────────

  describe('recomputeQuota', () => {
    test('recomputes an exact count for a daily requests quota, applying scope filters', async () => {
      setConfigForTesting(
        createTestConfig(
          {
            q: {
              type: 'daily',
              limitType: 'requests',
              limit: 100,
              allowedProviders: ['openai'],
            },
          },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const now = Date.now();
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });
      // Wrong provider — excluded by scope.
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'anthropic',
        finalAttemptModel: 'claude',
        startTime: now,
      });
      // Failed request — excluded by response_status filter.
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
        responseStatus: 'error',
      });

      const result = await quotaEnforcer.recomputeQuota('k', 'q');
      expect(result.recomputed).toBe(true);
      expect(result.usage).toBe(2);

      const ctx = await quotaEnforcer.loadQuotaContext('k');
      expect(ctx!.checks[0]!.currentUsage).toBe(2);
    });

    test('recomputes an exact sum for a rolling-cost quota', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'cost', limit: 100, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const now = Date.now();
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        costTotal: 1.5,
        startTime: now,
      });
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        costTotal: 2.25,
        startTime: now,
      });

      const result = await quotaEnforcer.recomputeQuota('k', 'q');
      expect(result.recomputed).toBe(true);
      expect(result.usage).toBe(3.75);
    });

    test('refuses to recompute a leaky rolling requests/tokens quota', async () => {
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'rolling', limitType: 'tokens', limit: 1000, duration: '1h' } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const result = await quotaEnforcer.recomputeQuota('k', 'q');
      expect(result.recomputed).toBe(false);
      expect(result.reason).toBe('unsupported_quota_type');
    });

    test('recomputes a shared quota across every key that attaches it', async () => {
      setConfigForTesting(
        createTestConfig(
          { pool: { type: 'daily', limitType: 'requests', limit: 1000, shared: true } },
          {
            k1: { secret: 'sk-1', quotas: ['pool'] },
            k2: { secret: 'sk-2', quotas: ['pool'] },
          }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const now = Date.now();
      await seedRequestUsage(db, schema, {
        apiKey: 'k1',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });
      await seedRequestUsage(db, schema, {
        apiKey: 'k2',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });
      await seedRequestUsage(db, schema, {
        apiKey: 'k2',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });

      const result = await quotaEnforcer.recomputeQuota('k1', 'pool');
      expect(result.recomputed).toBe(true);
      expect(result.usage).toBe(3);

      const rows = await db.select().from(schema.quotaState);
      expect(rows[0]!.keyName).toBe(SHARED_OWNER);
    });

    test('excludes non-chat request_usage rows (NULL final_attempt_provider) from a global quota recompute', async () => {
      // Non-chat routes (embeddings/images/speech/transcriptions) write
      // request_usage rows with responseStatus 'success' but NULL
      // final_attempt_provider/model, and never record quota usage on the
      // live path. A global quota (no provider/model scope filters) must
      // exclude these rows on recompute, or repair inflates the counter
      // with traffic live recording never counted.
      setConfigForTesting(
        createTestConfig(
          { q: { type: 'daily', limitType: 'requests', limit: 100 } },
          { k: { secret: 'sk-test', quotas: ['q'] } }
        )
      );
      quotaEnforcer = new QuotaEnforcer();

      const now = Date.now();
      // Non-chat usage row: NULL final_attempt_provider/model.
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: null,
        finalAttemptModel: null,
        startTime: now,
      });
      // Chat usage row: real provider/model set.
      await seedRequestUsage(db, schema, {
        apiKey: 'k',
        finalAttemptProvider: 'openai',
        finalAttemptModel: 'gpt-4',
        startTime: now,
      });

      const result = await quotaEnforcer.recomputeQuota('k', 'q');
      expect(result.recomputed).toBe(true);
      expect(result.usage).toBe(1);
    });
  });
});

/** Matches QuotaEnforcer's private getWindowStart('daily'/'weekly'/'monthly')
 * for seeding rows with an already-current window_start in tests that don't
 * need to control the clock. */
function quotaEnforcerWindowStart(type: 'daily' | 'weekly' | 'monthly'): number {
  const now = new Date();
  if (type === 'daily') {
    now.setUTCHours(0, 0, 0, 0);
    return now.getTime();
  }
  if (type === 'weekly') {
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    now.setUTCDate(now.getUTCDate() - daysSinceMonday);
    now.setUTCHours(0, 0, 0, 0);
    return now.getTime();
  }
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}
