import { FastifyInstance } from 'fastify';
import { QuotaScheduler } from '../../services/quota/quota-scheduler';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';
import {
  getLegacySnapshotStatus,
  migrateLegacySnapshots,
  truncateLegacySnapshots,
  exportLegacySnapshots,
  type ExportFormat,
} from '../../services/quota/legacy-snapshot-migrator';

function getOAuthMetadata(checkerId: string) {
  const quotaConfig = getConfig().quotas?.find((q) => q.id === checkerId);
  if (!quotaConfig) return {} as { oauthAccountId?: string; oauthProvider?: string };

  const oauthAccountId = (quotaConfig.options?.oauthAccountId as string | undefined)?.trim();
  const oauthProvider = (quotaConfig.options?.oauthProvider as string | undefined)?.trim();

  return {
    oauthAccountId: oauthAccountId?.length ? oauthAccountId : undefined,
    oauthProvider: oauthProvider?.length ? oauthProvider : undefined,
  };
}

function getCheckerType(checkerId: string): string | undefined {
  return getConfig().quotas?.find((q) => q.id === checkerId)?.type;
}

export async function registerQuotaRoutes(
  fastify: FastifyInstance,
  quotaScheduler: QuotaScheduler
) {
  fastify.get('/v0/management/quotas', async (_request, reply) => {
    try {
      const checkerIds = quotaScheduler.getCheckerIds();
      logger.debug(`[Quotas API] getCheckerIds returned: ${JSON.stringify(checkerIds)}`);
      const results = [];

      for (const checkerId of checkerIds) {
        try {
          const latest = await quotaScheduler.getLatestQuota(checkerId);
          results.push({
            ...getOAuthMetadata(checkerId),
            ...(latest ?? { success: false, meters: [] }),
            checkerId,
            checkerType: getCheckerType(checkerId),
          });
        } catch (error) {
          logger.error(`Failed to get latest quota for '${checkerId}': ${error}`);
          results.push({
            ...getOAuthMetadata(checkerId),
            success: false,
            meters: [],
            error: error instanceof Error ? error.message : 'Unknown error',
            checkerId,
            checkerType: getCheckerType(checkerId),
          });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Failed to get quotas: ${error}`);
      return reply.status(500).send({ error: 'Failed to retrieve quotas' });
    }
  });

  fastify.get('/v0/management/quotas/:checkerId', async (request, reply) => {
    try {
      const { checkerId } = request.params as { checkerId: string };
      const latest = await quotaScheduler.getLatestQuota(checkerId);
      return {
        ...getOAuthMetadata(checkerId),
        ...(latest ?? { success: false, meters: [] }),
        checkerId,
        checkerType: getCheckerType(checkerId),
      };
    } catch (error) {
      logger.error(`Failed to get quota for '${(request.params as any).checkerId}': ${error}`);
      return reply.status(500).send({ error: 'Failed to retrieve quota data' });
    }
  });

  fastify.get('/v0/management/quotas/:checkerId/history', async (request, reply) => {
    try {
      const { checkerId } = request.params as { checkerId: string };
      const querystring = request.query as { meterKey?: string; since?: string };
      let since: number | undefined;

      if (querystring.since) {
        if (querystring.since.endsWith('d')) {
          const days = parseFloat(querystring.since.slice(0, -1));
          since = Date.now() - days * 24 * 60 * 60 * 1000;
        } else {
          since = new Date(querystring.since).getTime();
        }
      }

      const history = await quotaScheduler.getQuotaHistory(checkerId, querystring.meterKey, since);
      return {
        checkerId,
        meterKey: querystring.meterKey,
        since: since ? new Date(since).toISOString() : undefined,
        history,
      };
    } catch (error) {
      logger.error(
        `Failed to get quota history for '${(request.params as any).checkerId}': ${error}`
      );
      return reply.status(500).send({ error: 'Failed to retrieve quota history' });
    }
  });

  fastify.get('/v0/management/quotas/backup-legacy-snapshots', async (request, reply) => {
    try {
      const { format = 'csv' } = request.query as { format?: string };
      const fmt: ExportFormat = format === 'sql' ? 'sql' : 'csv';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `quota_snapshots_backup_${timestamp}.${fmt}`;
      const body = await exportLegacySnapshots(fmt);
      reply
        .header(
          'Content-Type',
          fmt === 'sql' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8'
        )
        .header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(body);
    } catch (error) {
      logger.error(`Failed to export legacy snapshots: ${error}`);
      return reply.status(500).send({ error: 'Failed to export legacy snapshots' });
    }
  });

  fastify.get('/v0/management/quotas/legacy-snapshot-status', async (_request, reply) => {
    try {
      return await getLegacySnapshotStatus();
    } catch (error) {
      logger.error(`Failed to get legacy snapshot status: ${error}`);
      return reply.status(500).send({ error: 'Failed to get legacy snapshot status' });
    }
  });

  fastify.post('/v0/management/quotas/migrate-legacy-snapshots', async (_request, reply) => {
    try {
      const result = await migrateLegacySnapshots();
      return result;
    } catch (error) {
      logger.error(`Failed to migrate legacy snapshots: ${error}`);
      return reply.status(500).send({ error: 'Failed to migrate legacy snapshots' });
    }
  });

  fastify.post('/v0/management/quotas/truncate-legacy-snapshots', async (_request, reply) => {
    try {
      await truncateLegacySnapshots();
      return { ok: true };
    } catch (error) {
      logger.error(`Failed to truncate legacy snapshots: ${error}`);
      return reply.status(500).send({ error: 'Failed to truncate legacy snapshots' });
    }
  });

  fastify.post('/v0/management/quotas/:checkerId/check', async (request, reply) => {
    try {
      const { checkerId } = request.params as { checkerId: string };
      const result = await quotaScheduler.runCheckNow(checkerId);
      if (!result) {
        return reply.status(404).send({ error: `Quota checker '${checkerId}' not found` });
      }
      return result;
    } catch (error) {
      logger.error(
        `Failed to run quota check for '${(request.params as any).checkerId}': ${error}`
      );
      return reply.status(500).send({ error: 'Failed to run quota check' });
    }
  });
}
