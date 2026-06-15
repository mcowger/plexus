import { FastifyInstance } from 'fastify';
import { encode } from 'eventsource-encoder';
import { getRecentLogCount, getRecentLogs, logEmitter } from '../../utils/logger';

export async function registerSystemLogRoutes(fastify: FastifyInstance) {
  fastify.get('/v0/system/logs/recent', async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(parseInt(query.limit || '100', 10) || 100, 1000));

    return reply.send({
      data: getRecentLogs(limit).map((entry) => serializeRecentLog(entry)),
      total: getRecentLogCount(),
    });
  });

  fastify.get('/v0/system/logs/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    let cleanedUp = false;
    const listener = async (log: any) => {
      if (reply.raw.destroyed) return;
      reply.raw.write(
        encode({
          data: JSON.stringify(log),
          event: 'syslog',
          id: String(Date.now()),
        })
      );
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      logEmitter.off('log', listener);
    };

    logEmitter.on('log', listener);

    // Cleanup on server shutdown (closeAllConnections destroys sockets → 'close' fires)
    // and as a fallback for other disconnect scenarios.
    reply.raw.on('close', cleanup);

    while (!reply.raw.destroyed) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      if (!reply.raw.destroyed) {
        reply.raw.write(
          encode({
            event: 'ping',
            data: 'pong',
            id: String(Date.now()),
          })
        );
      }
    }

    // Cleanup: socket destroyed (client disconnect or server shutdown)
    cleanup();
  });
}

function serializeRecentLog(entry: unknown): unknown {
  const seen = new WeakSet<object>();

  try {
    return JSON.parse(
      JSON.stringify(entry, (_key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }

        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }

        return value;
      })
    );
  } catch {
    const fallback = entry as Record<string, unknown> | null;
    return {
      level: fallback && typeof fallback.level === 'string' ? fallback.level : 'unknown',
      message:
        fallback && typeof fallback.message === 'string'
          ? fallback.message
          : '[unserializable log entry]',
      timestamp:
        fallback && typeof fallback.timestamp === 'string' ? fallback.timestamp : undefined,
      serialization_error: true,
    };
  }
}
