import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { logEmitter } from '../../utils/logger';

export async function registerSystemLogRoutes(fastify: FastifyInstance) {
    fastify.get('/v0/system/logs/stream', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const listener = async (log: any) => {
            if (reply.raw.destroyed) return;
            reply.raw.write(encode({
                data: JSON.stringify(log),
                event: 'syslog',
                id: String(Date.now()),
            }));
        };

        logEmitter.on('log', listener);

        request.raw.on('close', () => {
            logEmitter.off('log', listener);
        });

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
