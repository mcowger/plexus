/**
 * Integration test: verify server shuts down promptly with active SSE connections.
 *
 * Before the fix (no forceCloseConnections), the SSE while-loop keeps the route
 * handler alive indefinitely, so fastify.close() never resolves and the process
 * hangs until killed externally.
 *
 * After the fix (forceCloseConnections: true), closeAllConnections() destroys
 * the sockets → reply.raw.destroyed → true → while loops break → fastify.close()
 * resolves → process exits.
 */
import { describe, test, expect } from 'vitest';
import Fastify from 'fastify';
import { encode } from 'eventsource-encoder';
import { EventEmitter } from 'events';

describe('SSE shutdown behavior', () => {
  test('fastify.close() completes promptly when SSE while-loop is active', async () => {
    const emitter = new EventEmitter();

    const fastify = Fastify({
      forceCloseConnections: true,
      logger: false,
    });

    let cleanedUp = false;

    // Replicate the SSE pattern used by /v0/management/events and /v0/system/logs/stream
    fastify.get('/test-sse', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const listener = (data: any) => {
        if (reply.raw.destroyed) return;
        reply.raw.write(
          encode({ data: JSON.stringify(data), event: 'test', id: String(Date.now()) })
        );
      };

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        emitter.off('event', listener);
      };

      emitter.on('event', listener);
      reply.raw.on('close', cleanup);

      // This is the exact while-loop pattern from the real routes
      while (!reply.raw.destroyed) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!reply.raw.destroyed) {
          reply.raw.write(encode({ event: 'ping', data: 'pong', id: String(Date.now()) }));
        }
      }

      // Cleanup after loop exits (client disconnect or server shutdown)
      cleanup();
    });

    const address = await fastify.listen({ port: 0, host: '127.0.0.1' });

    // Open an SSE connection (simulates the browser UI)
    const response = await fetch(`${address}/test-sse`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(response.ok).toBe(true);
    expect(response.body).toBeTruthy();

    // Drain the SSE stream in the background so the connection stays alive
    const reader = response.body!.getReader();
    const drain = async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // Connection closed — expected during shutdown
      }
    };
    drain(); // fire and forget

    // Let it settle
    await new Promise((r) => setTimeout(r, 200));

    // Close fastify — this is what happens during SIGTERM/SIGINT shutdown.
    // With forceCloseConnections: true, it should complete promptly.
    // Without it (or with it set to 'idle'), it would hang forever because
    // the SSE while-loop never breaks.
    const closeStart = Date.now();
    await fastify.close();
    const closeElapsed = Date.now() - closeStart;

    // THE CRITICAL ASSERTION: fastify.close() completed within 3 seconds.
    // Without forceCloseConnections: true, close() never resolves.
    expect(closeElapsed).toBeLessThan(3000);
  });
});
