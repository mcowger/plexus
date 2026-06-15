import { FastifyInstance } from 'fastify';
import { ConcurrencyTracker } from '../../services/concurrency-tracker';
import { UsageStorageService } from '../../services/usage-storage';
import { getCurrentDialect, getSchema } from '../../db/client';
import { and, isNotNull, gte, lte, sql } from 'drizzle-orm';

export async function registerConcurrencyRoutes(
  fastify: FastifyInstance,
  usageStorage?: UsageStorageService
) {
  /**
   * GET /v0/management/concurrency
   *
   * Dual-mode concurrency endpoint:
   *   - mode=live (default): Returns the ConcurrencyTracker in-memory snapshot
   *     with current in-flight counts per-provider and per-target.
   *   - mode=timeline: Returns bucketed historical counts from the DB
   *     for Usage Analytics charts.
   *
   * Query parameters:
   *   - mode: 'live' | 'timeline' (default: 'live')
   *   - timeRange: 'hour' | 'day' | 'week' | 'month' (default: 'hour', timeline mode only)
   *   - groupBy: 'provider' | 'model' (default: 'provider', timeline mode only)
   */
  fastify.get('/v0/management/concurrency', async (request, reply) => {
    const query = request.query as any;
    const mode = query.mode || 'live';

    // Live mode: return in-memory concurrency tracker snapshot
    if (mode === 'live') {
      const snapshot = ConcurrencyTracker.getInstance().getSnapshot();
      const now = Date.now();
      const data: Array<{ provider: string; model: string; count: number; timestamp: number }> = [];

      for (const [key, count] of Object.entries(snapshot.targets)) {
        const sep = key.indexOf('/');
        if (sep > 0) {
          data.push({
            provider: key.slice(0, sep),
            model: key.slice(sep + 1),
            count,
            timestamp: now,
          });
        }
      }

      // Also add provider-level aggregates for providers with no per-target entries
      for (const [provider, count] of Object.entries(snapshot.providers)) {
        const hasTargets = data.some((d) => d.provider === provider);
        if (!hasTargets) {
          data.push({ provider, model: '', count, timestamp: now });
        }
      }

      return reply.send({ data });
    }

    // Timeline mode: bucketed historical counts from DB
    if (!usageStorage) {
      return reply.send({ data: [] });
    }

    try {
      const db = usageStorage.getDb();
      const schema = getSchema();
      const dialect = getCurrentDialect();

      const timeRange = query.timeRange || 'hour';
      const groupBy = query.groupBy || 'provider';
      const startDateStr = query.startDate;
      const endDateStr = query.endDate;
      const now = Date.now();

      let startTime: number;
      let endTime: number = now;

      if (timeRange === 'custom' && startDateStr && endDateStr) {
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          startTime = startDate.getTime();
          endTime = endDate.getTime();
        } else {
          return reply.code(400).send({ error: 'Invalid date format' });
        }
      } else {
        const ranges: Record<string, number> = {
          hour: 60 * 60 * 1000,
          day: 24 * 60 * 60 * 1000,
          week: 7 * 24 * 60 * 60 * 1000,
          month: 30 * 24 * 60 * 60 * 1000,
        };
        const windowMs = ranges[timeRange] ?? ranges.hour ?? 60 * 60 * 1000;
        startTime = now - windowMs;
      }

      // Adaptive bucketing based on duration
      const durationMs = endTime - startTime;
      const durationMinutes = durationMs / (1000 * 60);

      const useMinuteBuckets = durationMinutes <= 30;
      const use5MinuteBuckets = durationMinutes <= 24 * 60;
      const useHourlyBuckets = durationMinutes <= 7 * 24 * 60;

      let bucketSizeMs: number;
      if (useMinuteBuckets) {
        bucketSizeMs = 60000;
      } else if (use5MinuteBuckets) {
        bucketSizeMs = 300000;
      } else if (useHourlyBuckets) {
        bucketSizeMs = 3600000;
      } else {
        bucketSizeMs = 21600000;
      }

      const maxBuckets = 100;
      const calculatedBuckets = Math.ceil(durationMs / bucketSizeMs);
      if (calculatedBuckets > maxBuckets) {
        bucketSizeMs = Math.ceil(durationMs / maxBuckets);
      }

      const bucketSizeMsLiteral = sql.raw(String(bucketSizeMs));
      const bucketSql =
        dialect === 'sqlite'
          ? sql<number>`(CAST(${schema.requestUsage.startTime} AS INTEGER) / ${bucketSizeMsLiteral}) * ${bucketSizeMsLiteral}`
          : sql<number>`(FLOOR(${schema.requestUsage.startTime}::double precision / ${bucketSizeMsLiteral}) * ${bucketSizeMsLiteral})`;

      const groupField =
        groupBy === 'model' ? schema.requestUsage.canonicalModelName : schema.requestUsage.provider;

      const results = await db
        .select({
          timestamp: bucketSql,
          key: groupField,
          count: sql<number>`count(*)`,
        })
        .from(schema.requestUsage)
        .where(
          and(
            isNotNull(groupField),
            gte(schema.requestUsage.startTime, startTime),
            lte(schema.requestUsage.startTime, endTime)
          )
        )
        .groupBy(groupField, bucketSql)
        .orderBy(bucketSql);

      const mappedResults = results.map((row: any) => ({
        timestamp: row.timestamp,
        [groupBy]: row.key,
        count: row.count,
      }));

      return reply.send({ data: mappedResults });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
