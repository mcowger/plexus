import { FastifyInstance } from 'fastify';
import { McpUsageStorageService } from '../../services/mcp-proxy/mcp-usage-storage';

export async function registerMcpLogRoutes(fastify: FastifyInstance, mcpUsageStorage: McpUsageStorageService) {
    fastify.get('/v0/management/mcp-logs', async (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '20');
        const offset = parseInt(query.offset || '0');
        const serverName = query.serverName || undefined;
        const apiKey = query.apiKey || undefined;

        try {
            const result = await mcpUsageStorage.getLogs({ limit, offset, serverName, apiKey });
            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/mcp-logs', async (request, reply) => {
        const query = request.query as any;
        let beforeDate: Date | undefined;
        if (query.olderThanDays) {
            const days = parseInt(query.olderThanDays);
            beforeDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }

        try {
            const success = await mcpUsageStorage.deleteAllLogs(beforeDate);
            if (!success) return reply.code(500).send({ error: 'Failed to delete MCP logs' });
            return reply.send({ success: true });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/mcp-logs/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;

        try {
            const success = await mcpUsageStorage.deleteLog(requestId);
            if (!success) return reply.code(404).send({ error: 'Log not found or could not be deleted' });
            return reply.send({ success: true });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });
}
