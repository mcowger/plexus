import { FastifyInstance } from 'fastify';
import { DebugManager } from '../../services/debug-manager';
import { UsageStorageService } from '../../services/usage-storage';

export async function registerDebugRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/debug', (request, reply) => {
        return reply.send({ enabled: DebugManager.getInstance().isEnabled() });
    });

    fastify.post('/v0/management/debug', async (request, reply) => {
        const body = request.body as any;
        if (typeof body.enabled === 'boolean') {
            DebugManager.getInstance().setEnabled(body.enabled);
            return reply.send({ enabled: DebugManager.getInstance().isEnabled() });
        }
        return reply.code(400).send({ error: "Invalid body. Expected { enabled: boolean }" });
    });

    fastify.get('/v0/management/debug/logs', async (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        const logs = await usageStorage.getDebugLogs(limit, offset);
        return reply.send(logs);
    });

    fastify.delete('/v0/management/debug/logs', async (request, reply) => {
        const success = await usageStorage.deleteAllDebugLogs();
        if (!success) return reply.code(500).send({ error: "Failed to delete logs" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/debug/logs/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const log = await usageStorage.getDebugLog(requestId);
        if (!log) return reply.code(404).send({ error: "Log not found" });
        return reply.send(log);
    });

    fastify.delete('/v0/management/debug/logs/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = await usageStorage.deleteDebugLog(requestId);
        if (!success) return reply.code(404).send({ error: "Log not found or could not be deleted" });
        return reply.send({ success: true });
    });
}
