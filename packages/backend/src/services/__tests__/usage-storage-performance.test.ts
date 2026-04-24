import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { registerSpy } from '../../../test/test-utils';
import { UsageStorageService } from '../usage-storage';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { UsageRecord } from '../../types/usage';

const createUsageRecord = (
  requestId: string,
  provider: string,
  incomingModelAlias: string,
  canonicalModelName: string,
  selectedModelName: string
): UsageRecord => ({
  requestId,
  date: new Date().toISOString(),
  sourceIp: '127.0.0.1',
  apiKey: 'test-key',
  attribution: null,
  incomingApiType: 'chat',
  provider,
  attemptCount: 1,
  incomingModelAlias,
  canonicalModelName,
  selectedModelName,
  finalAttemptProvider: provider,
  finalAttemptModel: selectedModelName,
  allAttemptedProviders: JSON.stringify([`${provider}/${selectedModelName}`]),
  outgoingApiType: 'chat',
  tokensInput: 100,
  tokensOutput: 100,
  tokensReasoning: 0,
  tokensCached: 0,
  costInput: 0,
  costOutput: 0,
  costCached: 0,
  costTotal: 0,
  costSource: null,
  costMetadata: null,
  startTime: Date.now() - 1000,
  durationMs: 1000,
  isStreamed: false,
  responseStatus: 'success',
  ttftMs: 120,
  tokensPerSec: 100,
  createdAt: Date.now(),
});

describe('UsageStorageService performance metrics', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    delete process.env.PLEXUS_PROVIDER_PERFORMANCE_RETENTION_LIMIT;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    const db = getDatabase() as any;
    const schema = getSchema() as any;
    await db.delete(schema.providerPerformance);
    await db.delete(schema.requestUsage);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('keeps retention scoped per provider+model', async () => {
    const storage = new UsageStorageService();

    for (let i = 0; i < 3; i++) {
      await storage.updatePerformanceMetrics(
        'provider-b',
        'model-2',
        null,
        100,
        100,
        1000,
        `b-${i}`
      );
    }

    for (let i = 0; i < 103; i++) {
      await storage.updatePerformanceMetrics(
        'provider-a',
        'model-1',
        null,
        100,
        100,
        1000,
        `a-${i}`
      );
    }

    const schema = getSchema() as any;
    const rows = await storage
      .getDb()
      .select({
        provider: schema.providerPerformance.provider,
        model: schema.providerPerformance.model,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.providerPerformance)
      .groupBy(schema.providerPerformance.provider, schema.providerPerformance.model);

    const a = rows.find((r: any) => r.provider === 'provider-a' && r.model === 'model-1');
    const b = rows.find((r: any) => r.provider === 'provider-b' && r.model === 'model-2');

    expect(a?.count).toBe(100);
    expect(b?.count).toBe(3);
  });

  it('returns grouped aggregates for provider/model and supports filters', async () => {
    const storage = new UsageStorageService();

    await storage.updatePerformanceMetrics('provider-a', 'model-x', null, 100, 100, 1000, 'a-1'); // ~111.11 tps (streaming time = 900ms)
    await storage.updatePerformanceMetrics('provider-a', 'model-x', null, 140, 200, 1000, 'a-2'); // ~232.56 tps (streaming time = 860ms)
    await storage.updatePerformanceMetrics('provider-a', 'model-x', null, 120, 300, 1500, 'a-3'); // ~217.39 tps (streaming time = 1380ms)

    await storage.updatePerformanceMetrics('provider-b', 'model-x', null, 80, 50, 1000, 'b-1'); // ~54.35 tps (streaming time = 920ms)
    await storage.updatePerformanceMetrics('provider-b', 'model-x', null, 90, 100, 1000, 'b-2'); // ~109.89 tps (streaming time = 910ms)

    const allForModel = await storage.getProviderPerformance(undefined, 'model-x');
    expect(allForModel.length).toBe(2);

    const rowA = allForModel.find((r: any) => r.provider === 'provider-a');
    const rowB = allForModel.find((r: any) => r.provider === 'provider-b');

    expect(rowA?.sample_count).toBe(3);
    expect(rowB?.sample_count).toBe(2);
    expect(rowA?.avg_ttft_ms).toBeCloseTo(120, 5);
    expect(rowB?.avg_ttft_ms).toBeCloseTo(85, 5);
    expect(rowA?.avg_tokens_per_sec).toBeCloseTo(187.0202, 3);
    expect(rowB?.avg_tokens_per_sec).toBeCloseTo(82.1189, 3);

    const filtered = await storage.getProviderPerformance('provider-a', 'model-x');
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.provider).toBe('provider-a');
    expect(filtered[0]?.model).toBe('model-x');
  });

  it('returns performance data even before any prior storage method initializes schema', async () => {
    const db = getDatabase() as any;
    const schema = getSchema() as any;

    await db.insert(schema.providerPerformance).values({
      provider: 'provider-z',
      model: 'model-z',
      requestId: 'z-1',
      timeToFirstTokenMs: 250,
      totalTokens: 200,
      durationMs: 1000,
      tokensPerSec: 200,
      createdAt: Date.now(),
    });

    const storage = new UsageStorageService();
    const rows = await storage.getProviderPerformance();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.provider === 'provider-z' && row.model === 'model-z')).toBe(true);
  });

  it('groups performance by canonical model name across backend-selected model variants', async () => {
    const storage = new UsageStorageService();

    const fixtures = [
      { provider: 'zai', selected: 'glm-4.7' },
      { provider: 'naga', selected: 'glm-4.7' },
      { provider: 'wisdomgate', selected: 'glm-4.7' },
      { provider: 'synthetic', selected: 'hf:zai-org/GLM-4.7' },
      { provider: 'apertis', selected: 'glm-4.7-thinking' },
    ];

    for (const [index, fixture] of fixtures.entries()) {
      const requestId = `canon-${index}`;
      await storage.saveRequest(
        createUsageRecord(requestId, fixture.provider, 'glm-4.7', 'glm-4.7', fixture.selected)
      );

      await storage.updatePerformanceMetrics(
        fixture.provider,
        fixture.selected,
        null,
        100 + index,
        100,
        1000,
        requestId
      );
    }

    const rows = await storage.getProviderPerformance(undefined, 'glm-4.7');
    const providers = new Set(rows.map((row: any) => row.provider));

    expect(providers.size).toBe(5);
    expect(providers.has('zai')).toBe(true);
    expect(providers.has('naga')).toBe(true);
    expect(providers.has('wisdomgate')).toBe(true);
    expect(providers.has('synthetic')).toBe(true);
    expect(providers.has('apertis')).toBe(true);
  });

  it('includes canonical-model providers from usage logs even if provider_performance has no rows for them', async () => {
    const storage = new UsageStorageService();

    const requestIdA = 'merge-a';
    await storage.saveRequest(
      createUsageRecord(requestIdA, 'zai', 'glm-4.7', 'glm-4.7', 'glm-4.7')
    );
    await storage.updatePerformanceMetrics('zai', 'glm-4.7', null, 100, 100, 1000, requestIdA);

    const requestIdB = 'merge-b';
    await storage.saveRequest({
      ...createUsageRecord(requestIdB, 'apertis', 'glm-4.7', 'glm-4.7', 'glm-4.7-thinking'),
      tokensPerSec: null,
      ttftMs: 240,
    });

    const rows = await storage.getProviderPerformance(undefined, 'glm-4.7');
    const providers = new Set(rows.map((row: any) => row.provider));

    expect(providers.has('zai')).toBe(true);
    expect(providers.has('apertis')).toBe(true);
  });

  it('uses env-configured retention limit for provider performance samples', async () => {
    process.env.PLEXUS_PROVIDER_PERFORMANCE_RETENTION_LIMIT = '5';

    const storage = new UsageStorageService();

    for (let i = 0; i < 8; i++) {
      await storage.updatePerformanceMetrics(
        'provider-c',
        'model-3',
        null,
        100,
        100,
        1000,
        `c-${i}`
      );
    }

    const schema = getSchema() as any;
    const rows = await storage
      .getDb()
      .select({
        provider: schema.providerPerformance.provider,
        model: schema.providerPerformance.model,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.providerPerformance)
      .where(
        and(
          eq(schema.providerPerformance.provider, 'provider-c'),
          eq(schema.providerPerformance.model, 'model-3')
        )
      )
      .groupBy(schema.providerPerformance.provider, schema.providerPerformance.model);

    expect(rows[0]?.count).toBe(5);
  });

  it('tracks success_count and failure_count for provider/model aggregates', async () => {
    const storage = new UsageStorageService();

    await storage.updatePerformanceMetrics(
      'provider-d',
      'model-4',
      null,
      100,
      100,
      1000,
      'd-success-1'
    );
    await storage.updatePerformanceMetrics(
      'provider-d',
      'model-4',
      null,
      120,
      110,
      1000,
      'd-success-2'
    );
    await storage.updatePerformanceMetrics(
      'provider-d',
      'model-4',
      null,
      null,
      null,
      0,
      'd-failure-1',
      false
    );

    const rows = await storage.getProviderPerformance('provider-d', 'model-4');
    expect(rows.length).toBe(1);
    expect(rows[0]?.success_count).toBe(2);
    expect(rows[0]?.failure_count).toBe(1);
    expect(rows[0]?.sample_count).toBe(3);
  });

  it('records failover-style failed and successful attempts via dedicated helpers', async () => {
    const storage = new UsageStorageService();

    await storage.recordFailedAttempt('provider-e', 'model-5', null, 'e-failure-1');
    await storage.recordSuccessfulAttempt('provider-e', 'model-5', null, 'e-success-1');

    const rows = await storage.getProviderPerformance('provider-e', 'model-5');
    expect(rows.length).toBe(1);
    expect(rows[0]?.success_count).toBe(1);
    expect(rows[0]?.failure_count).toBe(1);
    expect(rows[0]?.sample_count).toBe(2);
  });

  it('persists retry history on usage records', async () => {
    const storage = new UsageStorageService();
    const retryHistory = JSON.stringify([
      {
        index: 1,
        provider: 'provider-e',
        model: 'model-5',
        apiType: 'chat',
        status: 'failed',
        reason: 'HTTP 429: rate limited',
        statusCode: 429,
        retryable: true,
      },
      {
        index: 2,
        provider: 'provider-f',
        model: 'model-6',
        apiType: 'chat',
        status: 'success',
        reason: 'Request completed successfully',
        retryable: false,
      },
    ]);

    await storage.saveRequest({
      requestId: 'retry-history-1',
      date: new Date().toISOString(),
      sourceIp: null,
      apiKey: null,
      attribution: null,
      incomingApiType: 'chat',
      provider: 'provider-f',
      attemptCount: 2,
      retryHistory,
      incomingModelAlias: 'alias',
      canonicalModelName: 'canonical-model',
      selectedModelName: 'model-6',
      finalAttemptProvider: 'provider-f',
      finalAttemptModel: 'model-6',
      allAttemptedProviders: JSON.stringify(['provider-e/model-5', 'provider-f/model-6']),
      outgoingApiType: 'chat',
      tokensInput: 10,
      tokensOutput: 20,
      tokensReasoning: 0,
      tokensCached: 0,
      tokensCacheWrite: 0,
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
      costSource: null,
      costMetadata: null,
      startTime: Date.now(),
      durationMs: 100,
      isStreamed: false,
      isPassthrough: false,
      responseStatus: 'success',
      tokensEstimated: 0,
      createdAt: Date.now(),
    });

    const result = await storage.getUsage({}, { limit: 10, offset: 0 });
    const row = result.data.find((item) => item.requestId === 'retry-history-1');

    expect(row?.retryHistory).toBe(retryHistory);
    expect(row?.attemptCount).toBe(2);
  });

  it('emitStartedAsync and emitUpdatedAsync are non-blocking and preserve task order', async () => {
    const storage = new UsageStorageService();
    const calls: string[] = [];

    registerSpy(storage, 'emitStarted').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      calls.push('started');
    });

    registerSpy(storage, 'emitUpdated').mockImplementation(async () => {
      calls.push('updated');
    });

    const t0 = Date.now();
    storage.emitStartedAsync({ requestId: 'async-1' });
    storage.emitUpdatedAsync({ requestId: 'async-1' });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(20);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toEqual(['started', 'updated']);
  });

  it('sorts usage rows by requested field and direction', async () => {
    const storage = new UsageStorageService();

    await storage.saveRequest({
      ...createUsageRecord('sort-a-new', 'provider-a', 'alias-a', 'canonical-a', 'model-a'),
      apiKey: 'alpha',
      costTotal: 0.2,
      durationMs: 300,
      date: '2026-01-02T00:00:00.000Z',
    });
    await storage.saveRequest({
      ...createUsageRecord('sort-z', 'provider-z', 'alias-z', 'canonical-z', 'model-z'),
      apiKey: 'zeta',
      costTotal: 0.5,
      durationMs: 100,
      date: '2026-01-01T00:00:00.000Z',
    });
    await storage.saveRequest({
      ...createUsageRecord('sort-a-old', 'provider-a', 'alias-a2', 'canonical-a', 'model-a2'),
      apiKey: 'alpha',
      costTotal: 0.1,
      durationMs: 200,
      date: '2025-12-31T00:00:00.000Z',
    });

    const byKeyAsc = await storage.getUsage(
      {},
      { limit: 10, offset: 0, sortBy: 'apiKey', sortDir: 'asc' }
    );
    expect(byKeyAsc.data.map((row: any) => row.requestId)).toEqual([
      'sort-a-new',
      'sort-a-old',
      'sort-z',
    ]);

    const byCostDesc = await storage.getUsage(
      {},
      { limit: 10, offset: 0, sortBy: 'costTotal', sortDir: 'desc' }
    );
    expect(byCostDesc.data.map((row: any) => row.requestId)).toEqual([
      'sort-z',
      'sort-a-new',
      'sort-a-old',
    ]);

    const byDurationAsc = await storage.getUsage(
      {},
      { limit: 10, offset: 0, sortBy: 'durationMs', sortDir: 'asc' }
    );
    expect(byDurationAsc.data.map((row: any) => row.requestId)).toEqual([
      'sort-z',
      'sort-a-old',
      'sort-a-new',
    ]);
  });

  it('filters usage rows by apiKey substring', async () => {
    const storage = new UsageStorageService();

    await storage.saveRequest({
      ...createUsageRecord('filter-alpha', 'provider-a', 'alias-a', 'canonical-a', 'model-a'),
      apiKey: 'alpha-key',
    });
    await storage.saveRequest({
      ...createUsageRecord('filter-beta', 'provider-b', 'alias-b', 'canonical-b', 'model-b'),
      apiKey: 'beta-key',
    });

    const filtered = await storage.getUsage({ apiKey: 'alpha' }, { limit: 10, offset: 0 });
    expect(filtered.data.map((row: any) => row.requestId)).toEqual(['filter-alpha']);
  });
});
