import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerUsageRoutes } from '../usage';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../../../db/client';
import { runMigrations } from '../../../db/migrate';

describe('Usage summary route', () => {
  let fastify: ReturnType<typeof Fastify>;
  let db: ReturnType<typeof getDatabase>;
  let schema: any;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    db = getDatabase();
    schema = getSchema();

    fastify = Fastify();
    const usageStorage = new UsageStorageService();
    await registerUsageRoutes(fastify, usageStorage);
    await db.delete(schema.requestUsage);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fastify.close();
    await closeDatabase();
  });

  it('aggregates tokens and requests in summary series buckets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));

    const now = new Date();
    now.setSeconds(0, 0);

    const bucketOneA = now.getTime() - 2 * 60 * 1000;
    const bucketOneB = bucketOneA + 15 * 1000;
    const bucketTwo = now.getTime() - 60 * 1000;

    await db.insert(schema.requestUsage).values([
      {
        requestId: 'usage-summary-1',
        date: new Date(bucketOneA).toISOString(),
        startTime: bucketOneA,
        durationMs: 120,
        isStreamed: 0,
        isPassthrough: 0,
        tokensEstimated: 0,
        tokensInput: 20,
        tokensOutput: 10,
        createdAt: bucketOneA,
      },
      {
        requestId: 'usage-summary-2',
        date: new Date(bucketOneB).toISOString(),
        startTime: bucketOneB,
        durationMs: 100,
        isStreamed: 0,
        isPassthrough: 0,
        tokensEstimated: 0,
        tokensInput: 30,
        tokensOutput: 15,
        createdAt: bucketOneB,
      },
      {
        requestId: 'usage-summary-3',
        date: new Date(bucketTwo).toISOString(),
        startTime: bucketTwo,
        durationMs: 90,
        isStreamed: 0,
        isPassthrough: 0,
        tokensEstimated: 0,
        tokensInput: 10,
        tokensOutput: 5,
        createdAt: bucketTwo,
      },
    ]);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/usage/summary?range=hour',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      series: Array<{
        bucketStartMs: number;
        requests: number;
        tokens: number;
        inputTokens: number;
        outputTokens: number;
      }>;
      stats: { totalRequests: number; totalTokens: number };
      today: { requests: number; inputTokens: number; outputTokens: number };
    };

    const expectedBucketOneStartMs = Math.floor(bucketOneA / 60_000) * 60_000;
    const expectedBucketTwoStartMs = Math.floor(bucketTwo / 60_000) * 60_000;

    const bucketOne = body.series.find((point) => point.bucketStartMs === expectedBucketOneStartMs);
    const bucketTwoPoint = body.series.find(
      (point) => point.bucketStartMs === expectedBucketTwoStartMs
    );

    expect(bucketOne).toBeDefined();
    expect(bucketTwoPoint).toBeDefined();
    expect(bucketOne?.requests).toBe(2);
    expect(bucketOne?.tokens).toBe(75);
    expect(bucketTwoPoint?.requests).toBe(1);
    expect(bucketTwoPoint?.tokens).toBe(15);

    expect(body.stats.totalRequests).toBe(3);
    expect(body.stats.totalTokens).toBe(90);
    expect(body.today.requests).toBe(3);
    expect(body.today.inputTokens).toBe(60);
    expect(body.today.outputTokens).toBe(30);
  });
});
