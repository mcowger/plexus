import { FastifyInstance } from 'fastify';
import { QuotaScheduler } from '../../services/quota/quota-scheduler';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';
import { toBoolean, toIsoString } from '../../utils/normalize';

function normalizeQuotaSnapshot(snapshot: any) {
  return {
    ...snapshot,
    checkedAt: toIsoString(snapshot.checkedAt),
    resetsAt: toIsoString(snapshot.resetsAt),
    createdAt: toIsoString(snapshot.createdAt),
    success: toBoolean(snapshot.success),
  };
}

export async function registerQuotaRoutes(fastify: FastifyInstance, quotaScheduler: QuotaScheduler) {
  const config = getConfig();
  const quotaConfigs = config.quotas ?? [];
  const quotaConfigById = new Map(quotaConfigs.map((quotaConfig) => [quotaConfig.id, quotaConfig]));

  const getOAuthMetadata = (checkerId: string) => {
    const quotaConfig = quotaConfigById.get(checkerId);
    if (!quotaConfig) {
      return {} as { oauthAccountId?: string; oauthProvider?: string };
    }

    const oauthAccountId = (quotaConfig.options?.oauthAccountId as string | undefined)?.trim();
    const oauthProvider = (quotaConfig.options?.oauthProvider as string | undefined)?.trim();

    return {
      oauthAccountId: oauthAccountId && oauthAccountId.length > 0 ? oauthAccountId : undefined,
      oauthProvider: oauthProvider && oauthProvider.length > 0 ? oauthProvider : undefined,
    };
  };

  const getCheckerType = (checkerId: string): string | undefined => {
    const quotaConfig = quotaConfigById.get(checkerId);
    return quotaConfig?.type;
  };

  fastify.get('/v0/management/quotas', async (request, reply) => {
    try {
      const checkerIds = quotaScheduler.getCheckerIds();
      logger.debug(`[Quotas API] getCheckerIds returned: ${JSON.stringify(checkerIds)}`);
      const results = [];

      for (const checkerId of checkerIds) {
        try {
          const latest = await quotaScheduler.getLatestQuota(checkerId);
          results.push({ checkerId, checkerType: getCheckerType(checkerId), latest, ...getOAuthMetadata(checkerId) });
        } catch (error) {
          logger.error(`Failed to get latest quota for '${checkerId}': ${error}`);
          results.push({
            checkerId,
            checkerType: getCheckerType(checkerId),
            latest: [],
            error: error instanceof Error ? error.message : 'Unknown error',
            ...getOAuthMetadata(checkerId),
          });
        }
      }

      return results.map((result) => ({
        ...result,
        latest: Array.isArray(result.latest) ? result.latest.map(normalizeQuotaSnapshot) : [],
      }));
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
        checkerId,
        checkerType: getCheckerType(checkerId),
        latest: latest.map(normalizeQuotaSnapshot),
        ...getOAuthMetadata(checkerId),
      };
    } catch (error) {
      logger.error(`Failed to get quota for '${(request.params as any).checkerId}': ${error}`);
      return reply.status(500).send({ error: 'Failed to retrieve quota data' });
    }
  });

  fastify.get('/v0/management/quotas/:checkerId/history', async (request, reply) => {
    try {
      const { checkerId } = request.params as { checkerId: string };
      const querystring = request.query as { windowType?: string; since?: string };
      let since: number | undefined;

      if (querystring.since) {
        if (querystring.since.endsWith('d')) {
          const days = parseFloat(querystring.since.slice(0, -1));
          since = Date.now() - days * 24 * 60 * 60 * 1000;
        } else {
          since = new Date(querystring.since).getTime();
        }
      }

      const history = await quotaScheduler.getQuotaHistory(checkerId, querystring.windowType, since);
      return {
        checkerId,
        windowType: querystring.windowType,
        since: since ? new Date(since).toISOString() : undefined,
        history: history.map(normalizeQuotaSnapshot),
      };
    } catch (error) {
      logger.error(`Failed to get quota history for '${(request.params as any).checkerId}': ${error}`);
      return reply.status(500).send({ error: 'Failed to retrieve quota history' });
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
      logger.error(`Failed to run quota check for '${(request.params as any).checkerId}': ${error}`);
      return reply.status(500).send({ error: 'Failed to run quota check' });
    }
  });
}
