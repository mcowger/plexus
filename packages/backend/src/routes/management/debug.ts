import { FastifyInstance } from 'fastify';
import { DebugManager } from '../../services/debug-manager';
import { UsageStorageService } from '../../services/usage-storage';

export async function registerDebugRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/debug', (request, reply) => {
        const debugManager = DebugManager.getInstance();
        return reply.send({ 
            enabled: debugManager.isEnabled(),
            providers: debugManager.getProviderFilter()
        });
    });

    fastify.post('/v0/management/debug', async (request, reply) => {
        const body = request.body as any;
        const debugManager = DebugManager.getInstance();
        
        if (typeof body.enabled === 'boolean') {
            debugManager.setEnabled(body.enabled);
        }
        
        if (body.providers !== undefined) {
            if (Array.isArray(body.providers)) {
                debugManager.setProviderFilter(body.providers);
            } else if (body.providers === null) {
                debugManager.setProviderFilter(null);
            }
        }
        
        return reply.send({ 
            enabled: debugManager.isEnabled(),
            providers: debugManager.getProviderFilter()
        });
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
