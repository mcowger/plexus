import { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../../services/usage-storage';

export async function registerErrorRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/errors', async (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        const errors = await usageStorage.getErrors(limit, offset);
        return reply.send(errors);
    });

    fastify.delete('/v0/management/errors', async (request, reply) => {
        const success = await usageStorage.deleteAllErrors();
        if (!success) return reply.code(500).send({ error: "Failed to delete error logs" });
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/errors/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = await usageStorage.deleteError(requestId);
        if (!success) return reply.code(404).send({ error: "Error log not found or could not be deleted" });
        return reply.send({ success: true });
    });
}
