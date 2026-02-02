import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../../services/usage-storage';

export async function registerPerformanceRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/performance', async (request, reply) => {
        const query = request.query as any;
        const provider = query.provider;
        const model = query.model;

        const performance = await usageStorage.getProviderPerformance(provider, model);
        return reply.send(performance);
    });
}
