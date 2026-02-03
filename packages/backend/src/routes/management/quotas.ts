import { FastifyInstance } from 'fastify';
import { QuotaScheduler } from '../../services/quota/quota-scheduler';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';

export async function registerQuotaRoutes(fastify: FastifyInstance, quotaScheduler: QuotaScheduler) {
  fastify.get('/v0/management/quotas', async (request, reply) => {
    const checkerIds = quotaScheduler.getCheckerIds();
    logger.debug(`[Quotas API] getCheckerIds returned: ${JSON.stringify(checkerIds)}`);
    const results = [];

    for (const checkerId of checkerIds) {
      const latest = await quotaScheduler.getLatestQuota(checkerId);
      results.push({ checkerId, latest });
    }

    return results;
  });

  fastify.get('/v0/management/quotas/:checkerId', async (request, reply) => {
    const { checkerId } = request.params as { checkerId: string };
    const latest = await quotaScheduler.getLatestQuota(checkerId);
    return { checkerId, latest };
  });

  fastify.get('/v0/management/quotas/:checkerId/history', async (request, reply) => {
    const { checkerId } = request.params as { checkerId: string };
    const querystring = request.query as { windowType?: string; since?: string };
    let since: number | undefined;

    if (querystring.since) {
      if (querystring.since.endsWith('d')) {
        const days = parseInt(querystring.since.slice(0, -1), 10);
        since = Date.now() - days * 24 * 60 * 60 * 1000;
      } else {
        since = new Date(querystring.since).getTime();
      }
    }

    const history = await quotaScheduler.getQuotaHistory(checkerId, querystring.windowType, since);
    return { checkerId, windowType: querystring.windowType, since: since ? new Date(since).toISOString() : undefined, history };
  });

  fastify.post('/v0/management/quotas/:checkerId/check', async (request, reply) => {
    const { checkerId } = request.params as { checkerId: string };
    const result = await quotaScheduler.runCheckNow(checkerId);
    if (!result) {
      return reply.status(404).send({ error: `Quota checker '${checkerId}' not found` });
    }
    return result;
  });
}