import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../../services/usage-storage';
import { logger } from '../../utils/logger';

export async function registerPerformanceRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/performance', async (request, reply) => {
        const query = request.query as any;
        const provider = query.provider;
        const model = query.model;

        logger.debug('Performance route request received', {
            providerFilter: provider ?? null,
            modelFilter: model ?? null
        });

        const performance = await usageStorage.getProviderPerformance(provider, model);

        logger.debug('Performance route response generated', {
            providerFilter: provider ?? null,
            modelFilter: model ?? null,
            rowCount: performance.length
        });

        return reply.send(performance);
    });
}
