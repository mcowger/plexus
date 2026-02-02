import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { UsageStorageService } from '../../services/usage-storage';

export async function registerUsageRoutes(fastify: FastifyInstance, usageStorage: UsageStorageService) {
    fastify.get('/v0/management/usage', async (request, reply) => {
        const query = request.query as any;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');

        const filters: any = {
            startDate: query.startDate,
            endDate: query.endDate,
            incomingApiType: query.incomingApiType,
            provider: query.provider,
            incomingModelAlias: query.incomingModelAlias,
            selectedModelName: query.selectedModelName,
            outgoingApiType: query.outgoingApiType,
            responseStatus: query.responseStatus
        };

        if (query.minDurationMs) filters.minDurationMs = parseInt(query.minDurationMs);
        if (query.maxDurationMs) filters.maxDurationMs = parseInt(query.maxDurationMs);

        try {
            const result = await usageStorage.getUsage(filters, { limit, offset });
            return reply.send(result);
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    fastify.delete('/v0/management/usage', async (request, reply) => {
        const query = request.query as any;
        const olderThanDays = query.olderThanDays;
        let beforeDate: Date | undefined;

        if (olderThanDays) {
            const days = parseInt(olderThanDays);
            if (!isNaN(days)) {
                beforeDate = new Date();
                beforeDate.setDate(beforeDate.getDate() - days);
            }
        }

        const success = await usageStorage.deleteAllUsageLogs(beforeDate);
        if (!success) return reply.code(500).send({ error: "Failed to delete usage logs" });
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/usage/:requestId', async (request, reply) => {
        const params = request.params as any;
        const requestId = params.requestId;
        const success = await usageStorage.deleteUsageLog(requestId);
        if (!success) return reply.code(404).send({ error: "Usage log not found or could not be deleted" });
        return reply.send({ success: true });
    });

    fastify.get('/v0/management/events', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const listener = async (record: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(encode({
                data: JSON.stringify(record),
                event: 'log',
                id: String(Date.now()),
            }));
        };

        usageStorage.on('created', listener);

        request.raw.on('close', () => {
            usageStorage.off('created', listener);
        });

        // Keep connection alive with periodic pings
        while (!request.raw.destroyed) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            if (!reply.raw.destroyed) {
                reply.raw.write(encode({
                    event: 'ping',
                    data: 'pong',
                    id: String(Date.now())
                }));
            }
        }
    });
}
