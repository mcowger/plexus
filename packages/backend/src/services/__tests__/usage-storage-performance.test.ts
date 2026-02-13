import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { UsageStorageService } from '../usage-storage';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { UsageRecord } from '../../types/usage';

const createUsageRecord = (requestId: string, provider: string, incomingModelAlias: string, canonicalModelName: string, selectedModelName: string): UsageRecord => ({
  requestId,
  date: new Date().toISOString(),
  sourceIp: '127.0.0.1',
  apiKey: 'test-key',
  attribution: null,
  incomingApiType: 'chat',
  provider,
  incomingModelAlias,
  canonicalModelName,
  selectedModelName,
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
  createdAt: Date.now()
});

describe('UsageStorageService performance metrics', () => {
  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = 'sqlite://:memory:';
    delete process.env.PLEXUS_PROVIDER_PERFORMANCE_RETENTION_LIMIT;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('keeps retention scoped per provider+model', async () => {
    const storage = new UsageStorageService();

    for (let i = 0; i < 3; i++) {
      await storage.updatePerformanceMetrics('provider-b', 'model-2', null, 100, 100, 1000, `b-${i}`);
    }

    for (let i = 0; i < 103; i++) {
      await storage.updatePerformanceMetrics('provider-a', 'model-1', null, 100, 100, 1000, `a-${i}`);
    }

    const rows = storage
      .getDb()
      .$client
      .query('SELECT provider, model, COUNT(*) as count FROM provider_performance GROUP BY provider, model')
      .all() as Array<{ provider: string; model: string; count: number }>;

    const a = rows.find((r) => r.provider === 'provider-a' && r.model === 'model-1');
    const b = rows.find((r) => r.provider === 'provider-b' && r.model === 'model-2');

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

    const rowA = allForModel.find((r) => r.provider === 'provider-a');
    const rowB = allForModel.find((r) => r.provider === 'provider-b');

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
      createdAt: Date.now()
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
      { provider: 'apertis', selected: 'glm-4.7-thinking' }
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
    const providers = new Set(rows.map((row) => row.provider));

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
      ttftMs: 240
    });

    const rows = await storage.getProviderPerformance(undefined, 'glm-4.7');
    const providers = new Set(rows.map((row) => row.provider));

    expect(providers.has('zai')).toBe(true);
    expect(providers.has('apertis')).toBe(true);
  });

  it('uses env-configured retention limit for provider performance samples', async () => {
    process.env.PLEXUS_PROVIDER_PERFORMANCE_RETENTION_LIMIT = '5';

    const storage = new UsageStorageService();

    for (let i = 0; i < 8; i++) {
      await storage.updatePerformanceMetrics('provider-c', 'model-3', null, 100, 100, 1000, `c-${i}`);
    }

    const rows = storage
      .getDb()
      .$client
      .query('SELECT provider, model, COUNT(*) as count FROM provider_performance WHERE provider = ? AND model = ? GROUP BY provider, model')
      .all('provider-c', 'model-3') as Array<{ provider: string; model: string; count: number }>;

    expect(rows[0]?.count).toBe(5);
  });
});
